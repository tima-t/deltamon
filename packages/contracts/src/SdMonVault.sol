// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626, IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISpotVenue} from "./interfaces/ISpotVenue.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

/// @title SdMonVault — sdMON
/// @notice Deposit USDC. The vault swaps `targetMonBps` (60 %) of every deposit into MON on Kuru and keeps
///         both the USDC and the MON. Depositors receive sdMON, an ERC-4626 share of everything the vault
///         holds, valued in USDC through the price oracle.
/// @dev Deposits mint shares from the value actually added after the swap, so slippage is paid by the
///      depositor, not socialised. `redeem` sells the MON slice back to USDC; `redeemInKind` returns
///      USDC + MON without a swap. `mint` and `withdraw` are disabled because their exact-output
///      semantics cannot be honoured across a swap.
contract SdMonVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_SLIPPAGE_BPS = 500;
    /// @dev 6-decimal USDC → 18-decimal sdMON, and virtual-share inflation protection.
    uint8 private constant SHARE_DECIMALS_OFFSET = 12;

    IERC20 public immutable mon; // WMON
    uint8 private immutable _assetDecimals;
    uint8 private immutable _monDecimals;

    ISpotVenue public spotVenue;
    IPriceOracle public oracle;

    uint16 public targetMonBps; // share of each deposit (and of the book) held as MON
    uint16 public rebalanceThresholdBps; // |actual − target| that triggers a rebalance
    uint16 public maxSlippageBps; // swap tolerance vs oracle price
    uint256 public depositCap; // in asset units
    uint256 public minDeposit; // in asset units
    uint256 public minSwapMon; // smallest MON amount a venue can fill (Kuru minSize), MON units
    uint256 public lastRebalanceAt;

    event Allocated(
        address indexed receiver, uint256 assetsIn, uint256 assetsSwapped, uint256 monReceived, uint256 shares
    );
    event RedeemedSwapped(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 shares,
        uint256 monSold,
        uint256 assetsOut
    );
    event RedeemedInKind(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 shares,
        uint256 assetsOut,
        uint256 monOut
    );
    event Rebalanced(int256 driftBpsBefore, uint256 assetsSwapped, uint256 monSwapped);
    event AllocationUpdated(uint16 targetMonBps, uint16 rebalanceThresholdBps);
    event MaxSlippageUpdated(uint16 maxSlippageBps);
    event SpotVenueUpdated(address venue);
    event OracleUpdated(address oracle);
    event DepositCapUpdated(uint256 cap);
    event MinDepositUpdated(uint256 minDeposit);
    event MinSwapMonUpdated(uint256 minSwapMon);

    error ZeroAddress();
    error InvalidBps();
    error MintNotSupported();
    error WithdrawNotSupported();
    error BelowMinDeposit(uint256 assets, uint256 minimum);
    error SwapBelowVenueMinimum(uint256 monAmount, uint256 minimum);
    error NothingToRebalance(int256 driftBps, uint16 thresholdBps);

    constructor(
        IERC20 asset_,
        IERC20 mon_,
        ISpotVenue spotVenue_,
        IPriceOracle oracle_,
        address admin,
        uint256 depositCap_
    ) ERC20("Staked Delta MON", "sdMON") ERC4626(asset_) {
        if (
            address(mon_) == address(0) || address(spotVenue_) == address(0) || address(oracle_) == address(0)
                || admin == address(0)
        ) revert ZeroAddress();
        mon = mon_;
        spotVenue = spotVenue_;
        oracle = oracle_;
        _assetDecimals = IERC20Metadata(address(asset_)).decimals();
        _monDecimals = IERC20Metadata(address(mon_)).decimals();

        targetMonBps = 6000;
        rebalanceThresholdBps = 500;
        maxSlippageBps = 50;
        depositCap = depositCap_;
        minDeposit = 10 * 10 ** _assetDecimals;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    // ───────────────────────────── views ─────────────────────────────

    function usdcBalance() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function monBalance() public view returns (uint256) {
        return mon.balanceOf(address(this));
    }

    /// @notice USD per whole MON, 1e18.
    function monPrice() public view returns (uint256) {
        return oracle.price(address(mon));
    }

    /// @notice MON amount → asset units at the oracle price (USDC treated as 1 USD).
    function monToAssets(uint256 monAmount) public view returns (uint256) {
        if (monAmount == 0) return 0;
        return monAmount.mulDiv(monPrice(), 10 ** _monDecimals).mulDiv(10 ** _assetDecimals, 1e18);
    }

    function assetsToMon(uint256 assets) public view returns (uint256) {
        if (assets == 0) return 0;
        return assets.mulDiv(1e18, 10 ** _assetDecimals).mulDiv(10 ** _monDecimals, monPrice());
    }

    function totalAssets() public view override returns (uint256) {
        return usdcBalance() + monToAssets(monBalance());
    }

    /// @notice Share of the book held as MON, in bps.
    function monShareBps() public view returns (uint256) {
        uint256 total = totalAssets();
        return total == 0 ? 0 : monToAssets(monBalance()).mulDiv(BPS, total);
    }

    /// @notice monShareBps − targetMonBps. Positive = too much MON.
    function allocationDriftBps() public view returns (int256) {
        return int256(monShareBps()) - int256(uint256(targetMonBps));
    }

    /// @notice Asset units per whole share.
    function pricePerShare() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 total = totalAssets();
        return total >= depositCap ? 0 : depositCap - total;
    }

    function maxMint(address) public pure override returns (uint256) {
        return 0;
    }

    function maxWithdraw(address) public pure override returns (uint256) {
        return 0;
    }

    // ───────────────────────────── deposit ─────────────────────────────

    /// @inheritdoc ERC4626
    /// @dev Swaps `targetMonBps` of `assets` into MON, then mints shares for the value actually added.
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        if (assets < minDeposit) revert BelowMinDeposit(assets, minDeposit);

        uint256 previewShares = previewDeposit(assets);
        uint256 totalBefore = totalAssets();
        uint256 supplyBefore = totalSupply();

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);

        uint256 toSwap = assets.mulDiv(targetMonBps, BPS);
        uint256 monOut = _buyMon(toSwap);

        uint256 valueAdded = (assets - toSwap) + monToAssets(monOut);
        shares = valueAdded.mulDiv(supplyBefore + 10 ** _decimalsOffset(), totalBefore + 1, Math.Rounding.Floor);
        if (shares > previewShares) shares = previewShares;

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
        emit Allocated(receiver, assets, toSwap, monOut, shares);
    }

    function mint(uint256, address) public pure override returns (uint256) {
        revert MintNotSupported();
    }

    // ───────────────────────────── redeem ─────────────────────────────

    /// @inheritdoc ERC4626
    /// @dev Burns shares, sells the MON slice back to USDC on the venue, pays out USDC.
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 assetsOut)
    {
        (uint256 usdcOut, uint256 monOut) = _burnProRata(shares, owner);
        uint256 swapped = _sellMon(monOut);
        assetsOut = usdcOut + swapped;
        IERC20(asset()).safeTransfer(receiver, assetsOut);
        emit Withdraw(msg.sender, receiver, owner, assetsOut, shares);
        emit RedeemedSwapped(msg.sender, receiver, owner, shares, monOut, assetsOut);
    }

    /// @notice Burn shares for the pro-rata USDC and MON without swapping.
    function redeemInKind(uint256 shares, address receiver, address owner)
        external
        nonReentrant
        returns (uint256 assetsOut, uint256 monOut)
    {
        (assetsOut, monOut) = _burnProRata(shares, owner);
        if (assetsOut > 0) IERC20(asset()).safeTransfer(receiver, assetsOut);
        if (monOut > 0) mon.safeTransfer(receiver, monOut);
        emit Withdraw(msg.sender, receiver, owner, assetsOut + monToAssets(monOut), shares);
        emit RedeemedInKind(msg.sender, receiver, owner, shares, assetsOut, monOut);
    }

    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert WithdrawNotSupported();
    }

    // ───────────────────────────── keeper ─────────────────────────────

    /// @notice Bring the MON share of the book back to `targetMonBps` when it drifted past the threshold.
    function rebalance() external nonReentrant onlyRole(KEEPER_ROLE) whenNotPaused {
        int256 drift = allocationDriftBps();
        uint256 total = totalAssets();
        uint256 assetsSwapped;
        uint256 monSwapped;

        if (drift > int256(uint256(rebalanceThresholdBps))) {
            uint256 excessValue = total.mulDiv(uint256(drift), BPS);
            monSwapped = Math.min(assetsToMon(excessValue), monBalance());
            assetsSwapped = _sellMon(monSwapped);
        } else if (drift < -int256(uint256(rebalanceThresholdBps))) {
            uint256 shortfall = total.mulDiv(uint256(-drift), BPS);
            assetsSwapped = Math.min(shortfall, usdcBalance());
            monSwapped = _buyMon(assetsSwapped);
        } else {
            revert NothingToRebalance(drift, rebalanceThresholdBps);
        }

        lastRebalanceAt = block.timestamp;
        emit Rebalanced(drift, assetsSwapped, monSwapped);
    }

    // ───────────────────────────── admin ─────────────────────────────

    function setAllocation(uint16 targetMonBps_, uint16 rebalanceThresholdBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (targetMonBps_ > BPS || rebalanceThresholdBps_ > BPS) revert InvalidBps();
        targetMonBps = targetMonBps_;
        rebalanceThresholdBps = rebalanceThresholdBps_;
        emit AllocationUpdated(targetMonBps_, rebalanceThresholdBps_);
    }

    function setMaxSlippage(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_SLIPPAGE_BPS) revert InvalidBps();
        maxSlippageBps = bps;
        emit MaxSlippageUpdated(bps);
    }

    function setSpotVenue(ISpotVenue venue) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(venue) == address(0)) revert ZeroAddress();
        spotVenue = venue;
        emit SpotVenueUpdated(address(venue));
    }

    function setOracle(IPriceOracle oracle_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(oracle_) == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleUpdated(address(oracle_));
    }

    function setDepositCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositCap = cap;
        emit DepositCapUpdated(cap);
    }

    function setMinDeposit(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minDeposit = amount;
        emit MinDepositUpdated(amount);
    }

    function setMinSwapMon(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minSwapMon = amount;
        emit MinSwapMonUpdated(amount);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _burnProRata(uint256 shares, address owner) internal returns (uint256 usdcOut, uint256 monOut) {
        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);

        uint256 total = totalAssets();
        uint256 value = previewRedeem(shares); // ≤ pro-rata thanks to virtual shares
        if (total > 0) {
            usdcOut = usdcBalance().mulDiv(value, total);
            monOut = monBalance().mulDiv(value, total);
        }

        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
    }

    function _buyMon(uint256 assetsIn) internal returns (uint256 monOut) {
        if (assetsIn == 0) return 0;
        uint256 expected = assetsToMon(assetsIn);
        if (expected < minSwapMon) revert SwapBelowVenueMinimum(expected, minSwapMon);
        uint256 minOut = expected.mulDiv(BPS - maxSlippageBps, BPS);
        IERC20(asset()).forceApprove(address(spotVenue), assetsIn);
        monOut = spotVenue.swapExactIn(asset(), address(mon), assetsIn, minOut, address(this));
    }

    function _sellMon(uint256 monIn) internal returns (uint256 assetsOut) {
        if (monIn == 0) return 0;
        if (monIn < minSwapMon) revert SwapBelowVenueMinimum(monIn, minSwapMon);
        uint256 minOut = monToAssets(monIn).mulDiv(BPS - maxSlippageBps, BPS);
        mon.forceApprove(address(spotVenue), monIn);
        assetsOut = spotVenue.swapExactIn(address(mon), asset(), monIn, minOut, address(this));
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return SHARE_DECIMALS_OFFSET;
    }
}
