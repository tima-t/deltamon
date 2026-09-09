// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626, IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ISpotVenue} from "./interfaces/ISpotVenue.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IWMON} from "./interfaces/external/IWMON.sol";
import {IMonadStaking} from "./interfaces/external/IMonadStaking.sol";
import {IPerplExchange} from "./interfaces/external/IPerplExchange.sol";

/// @title DeltaMonVault
/// @notice A USDC vault with two roles. Depositors put USDC in and receive sdMON, an ERC-4626 share
///         of the whole book. The admin, who is the deployer, allocates that book across exactly
///         three places and nowhere else: Kuru for spot swaps, Monad's staking precompile for MON,
///         and Perpl for the short leg.
///
/// @dev What the admin can NOT do, enforced by this contract rather than by policy:
///      - There is no generic call or delegatecall. Every external interaction is a named function
///        with a fixed target, so no other protocol is reachable.
///      - Swaps are floored against the Chainlink MON/USD feed, so the admin cannot pick a bad
///        minimum output and trade the vault's money away to themselves on the order book.
///      - Staking only reaches validators whose commission is under a configured cap.
///      - The only asset the admin can ever transfer out is the accrued performance fee.
///      - While a redemption request is past its deadline, every allocation function is frozen.
contract DeltaMonVault is ERC4626, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;
    using SafeCast for uint256;

    // ───────────────────────────── constants ─────────────────────────────

    IMonadStaking public constant STAKING = IMonadStaking(0x0000000000000000000000000000000000001000);

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 1000; // 10 %
    uint256 public constant MAX_SWAP_SLIPPAGE_BPS = 500;
    /// @notice A queued redemption must be funded within this window.
    uint256 public constant REDEMPTION_DEADLINE = 36 hours;
    /// @notice Fee increases wait this long. Decreases apply at once.
    uint256 public constant FEE_TIMELOCK = 1 days;
    uint8 private constant SHARE_DECIMALS_OFFSET = 12;
    uint256 private constant WAD = 1e18;

    // ───────────────────────────── wiring ─────────────────────────────

    IWMON public immutable wmon;
    IERC20 public immutable ausd;
    IPerplExchange public immutable perpl;
    uint8 private immutable _assetDecimals;

    ISpotVenue public spotVenue;
    IPriceOracle public oracle;

    // ───────────────────────────── config ─────────────────────────────

    uint16 public performanceFeeBps;
    uint16 public pendingPerformanceFeeBps;
    uint64 public pendingFeeEffectiveAt;

    uint16 public maxSwapSlippageBps = 50;
    /// @notice How far a USDC and AUSD swap may stray from parity. Both are dollar stablecoins.
    uint16 public stableParityBandBps = 100;
    /// @notice Validator commission ceiling, 1e18 scaled. 1e17 is ten percent.
    uint256 public maxValidatorCommission = 2e17;

    uint256 public depositCap;
    uint256 public minDeposit;

    bool public whitelistEnabled;
    mapping(address => bool) public isDepositor;

    // ───────────────────────────── accounting ─────────────────────────────

    /// @notice What each holder paid in, in USDC. The basis for the profit-only performance fee.
    mapping(address => uint256) public costBasis;

    uint256 public stakedMon;
    uint256 public unstakingMon;
    mapping(uint64 => mapping(uint8 => uint256)) public pendingUnstake;
    mapping(uint64 => uint8) public nextWithdrawId;

    /// @notice AUSD sent to Perpl minus AUSD taken back. Exact, tracked on-chain.
    uint256 public perplPrincipal;
    /// @notice Unrealised profit and funding on the Perpl account, reported by the admin.
    int256 public perplReportedPnl;
    uint64 public perplReportedAt;
    uint16 public perplPnlBandBps = 5000;
    uint32 public perplReportMaxAge = 6 hours;
    bool public perplAccountOpened;

    uint256 public accruedFees;

    struct Redemption {
        address owner;
        uint256 shares;
        uint256 basis;
        uint64 requestedAt;
        bool settled;
    }

    Redemption[] public redemptions;
    uint256 public queueHead;
    uint256 public queuedShares;

    // ───────────────────────────── events ─────────────────────────────

    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event Staked(uint64 indexed validatorId, uint256 monAmount);
    event Unstaked(uint64 indexed validatorId, uint8 withdrawId, uint256 monAmount);
    event UnstakeClaimed(uint64 indexed validatorId, uint8 withdrawId, uint256 monReceived);
    event StakingRewardsClaimed(uint64 indexed validatorId, uint256 monReceived);
    event PerplAccountOpened(uint256 ausdAmount);
    event PerplCollateralDeposited(uint256 ausdAmount);
    event PerplCollateralWithdrawn(uint256 ausdAmount);
    event PerplOrderForwardingSet(bool allowed);
    event PerplPnlReported(int256 pnl, uint256 principal);
    event RedemptionRequested(uint256 indexed id, address indexed owner, uint256 shares);
    event RedemptionClaimed(uint256 indexed id, address indexed owner, uint256 assetsOut, uint256 fee);
    event RedemptionCancelled(uint256 indexed id, address indexed owner, uint256 shares);
    event PerformanceFeeCharged(address indexed owner, uint256 profit, uint256 fee);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event FeeProposed(uint16 bps, uint64 effectiveAt);
    event FeeUpdated(uint16 bps);
    event WhitelistModeSet(bool enabled);
    event DepositorSet(address indexed account, bool allowed);
    event ConfigUpdated();

    // ───────────────────────────── errors ─────────────────────────────

    error ZeroAddress();
    error InvalidBps();
    error NotWhitelisted(address account);
    error BelowMinDeposit(uint256 assets, uint256 minimum);
    error InsufficientLiquidity(uint256 needed, uint256 available);
    error NothingToClaim();
    error NotRequestOwner();
    error AlreadySettled();
    error RedemptionsOverdue();
    error StalePerplReport();
    error PnlOutOfBand();
    error ValidatorCommissionTooHigh(uint256 commission, uint256 maximum);
    error WithdrawSlotBusy(uint64 validatorId, uint8 withdrawId);
    error StakingCallFailed();
    error NoFeeTimelockPending();
    error FeeTimelockActive(uint64 effectiveAt);
    error AmountExceedsPrincipal(uint256 amount, uint256 principal);
    error AccountAlreadyOpen();

    constructor(
        IERC20 usdc_,
        IWMON wmon_,
        IERC20 ausd_,
        ISpotVenue spotVenue_,
        IPriceOracle oracle_,
        IPerplExchange perpl_,
        uint256 depositCap_,
        uint16 performanceFeeBps_
    ) ERC20("DeltaMon Vault Share", "sdMON") ERC4626(usdc_) Ownable(msg.sender) {
        if (
            address(wmon_) == address(0) || address(ausd_) == address(0) || address(spotVenue_) == address(0)
                || address(oracle_) == address(0) || address(perpl_) == address(0)
        ) revert ZeroAddress();
        if (performanceFeeBps_ > MAX_PERFORMANCE_FEE_BPS) revert InvalidBps();

        wmon = wmon_;
        ausd = ausd_;
        spotVenue = spotVenue_;
        oracle = oracle_;
        perpl = perpl_;
        _assetDecimals = IERC20Metadata(address(usdc_)).decimals();

        depositCap = depositCap_;
        minDeposit = 10 * 10 ** _assetDecimals;
        performanceFeeBps = performanceFeeBps_;
    }

    // ───────────────────────────── valuation ─────────────────────────────

    function usdcBalance() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @notice USDC that is free to pay redemptions right now. Fees owed to the admin are excluded.
    function availableLiquidity() public view returns (uint256) {
        uint256 bal = usdcBalance();
        return bal > accruedFees ? bal - accruedFees : 0;
    }

    /// @notice Every MON the vault controls: wrapped, native, delegated, and unbonding.
    function totalMon() public view returns (uint256) {
        return wmon.balanceOf(address(this)) + address(this).balance + stakedMon + unstakingMon;
    }

    /// @notice Collateral on Perpl plus the reported unrealised result, floored at zero.
    function perplEquity() public view returns (uint256) {
        int256 equity = perplPrincipal.toInt256() + perplReportedPnl;
        return equity > 0 ? uint256(equity) : 0;
    }

    function monPrice() public view returns (uint256) {
        return oracle.price(address(wmon));
    }

    function monToAssets(uint256 monAmount) public view returns (uint256) {
        if (monAmount == 0) return 0;
        return monAmount.mulDiv(monPrice(), WAD).mulDiv(10 ** _assetDecimals, WAD);
    }

    function assetsToMon(uint256 assets) public view returns (uint256) {
        if (assets == 0) return 0;
        return assets.mulDiv(WAD, 10 ** _assetDecimals).mulDiv(WAD, monPrice());
    }

    /// @dev AUSD and USDC are both dollar stablecoins with the same decimals, so parity is used.
    function ausdToAssets(uint256 ausdAmount) public pure returns (uint256) {
        return ausdAmount;
    }

    function totalAssets() public view override returns (uint256) {
        return
            availableLiquidity() + monToAssets(totalMon()) + ausdToAssets(ausd.balanceOf(address(this)) + perplEquity());
    }

    function pricePerShare() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    /// @notice True once the oldest unsettled request has passed its deadline. Freezes the admin.
    function hasOverdueRedemptions() public view returns (bool) {
        uint256 i = queueHead;
        uint256 n = redemptions.length;
        while (i < n && redemptions[i].settled) {
            i++;
        }
        if (i >= n) return false;
        return block.timestamp > uint256(redemptions[i].requestedAt) + REDEMPTION_DEADLINE;
    }

    function redemptionCount() external view returns (uint256) {
        return redemptions.length;
    }

    // ───────────────────────────── ERC-4626 limits ─────────────────────────────

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (paused()) return 0;
        if (whitelistEnabled && !isDepositor[receiver]) return 0;
        uint256 total = totalAssets();
        return total >= depositCap ? 0 : depositCap - total;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assets = maxDeposit(receiver);
        return assets == 0 ? 0 : _convertToShares(assets, Math.Rounding.Floor);
    }

    /// @notice Only what the idle USDC can actually pay. Anything more has to go through the queue.
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 bal = balanceOf(owner);
        uint256 liquidity = availableLiquidity();
        // Compare in asset terms so virtual-share rounding never strands the last wei of a position.
        if (_convertToAssets(bal, Math.Rounding.Floor) <= liquidity) return bal;
        return _convertToShares(liquidity, Math.Rounding.Floor);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return _convertToAssets(maxRedeem(owner), Math.Rounding.Floor);
    }

    // ───────────────────────────── depositor: in ─────────────────────────────

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256 shares) {
        _requireFreshPerplReport();
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        if (assets < minDeposit) revert BelowMinDeposit(assets, minDeposit);
        shares = previewDeposit(assets);
        _pullAndMint(assets, shares, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256 assets) {
        _requireFreshPerplReport();
        uint256 maxShares = maxMint(receiver);
        if (shares > maxShares) revert ERC4626ExceededMaxMint(receiver, shares, maxShares);
        assets = previewMint(shares);
        if (assets < minDeposit) revert BelowMinDeposit(assets, minDeposit);
        _pullAndMint(assets, shares, receiver);
    }

    function _pullAndMint(uint256 assets, uint256 shares, address receiver) internal {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
        costBasis[receiver] += assets;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    // ───────────────────────────── depositor: out ─────────────────────────────

    /// @notice Redeem immediately. Reverts when the vault has no free USDC, use `requestRedeem` then.
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 assetsOut)
    {
        _requireFreshPerplReport();
        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);

        uint256 gross = previewRedeem(shares);
        uint256 basis = _takeBasis(owner, shares);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        (assetsOut,) = _settle(shares, gross, basis, owner, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        _requireFreshPerplReport();
        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) revert ERC4626ExceededMaxWithdraw(owner, assets, maxAssets);
        shares = previewWithdraw(assets);

        uint256 gross = previewRedeem(shares);
        uint256 basis = _takeBasis(owner, shares);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        _settle(shares, gross, basis, owner, receiver);
    }

    /// @notice Queue a redemption. The admin has 36 hours to make the USDC available, after which
    ///         every allocation function on this vault freezes until the queue is cleared.
    function requestRedeem(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0 || shares > balanceOf(msg.sender)) {
            revert ERC4626ExceededMaxRedeem(msg.sender, shares, balanceOf(msg.sender));
        }
        uint256 basis = _takeBasis(msg.sender, shares);
        _transfer(msg.sender, address(this), shares);
        queuedShares += shares;

        id = redemptions.length;
        redemptions.push(
            Redemption({
                owner: msg.sender, shares: shares, basis: basis, requestedAt: uint64(block.timestamp), settled: false
            })
        );
        emit RedemptionRequested(id, msg.sender, shares);
    }

    /// @notice Settle a queued redemption once the USDC is there. Anyone may trigger it.
    function claimRedemption(uint256 id) external nonReentrant returns (uint256 assetsOut) {
        _requireFreshPerplReport();
        Redemption storage r = redemptions[id];
        if (r.settled) revert AlreadySettled();

        uint256 gross = previewRedeem(r.shares);
        uint256 available = availableLiquidity();
        if (gross > available) revert InsufficientLiquidity(gross, available);

        r.settled = true;
        queuedShares -= r.shares;
        _burn(address(this), r.shares);
        uint256 fee;
        (assetsOut, fee) = _settle(r.shares, gross, r.basis, r.owner, r.owner);
        _advanceQueue();
        emit RedemptionClaimed(id, r.owner, assetsOut, fee);
    }

    /// @notice Take a queued request back. Shares and cost basis return to the owner.
    function cancelRedemption(uint256 id) external nonReentrant {
        Redemption storage r = redemptions[id];
        if (r.settled) revert AlreadySettled();
        if (r.owner != msg.sender) revert NotRequestOwner();

        r.settled = true;
        queuedShares -= r.shares;
        costBasis[r.owner] += r.basis;
        _transfer(address(this), r.owner, r.shares);
        _advanceQueue();
        emit RedemptionCancelled(id, r.owner, r.shares);
    }

    // ───────────────────────────── admin: Kuru ─────────────────────────────

    function swapUsdcForMon(uint256 usdcIn, uint256 minMonOut) external onlyOwner notOverdue returns (uint256) {
        uint256 floorOut = assetsToMon(usdcIn).mulDiv(BPS - maxSwapSlippageBps, BPS);
        return _swap(asset(), address(wmon), usdcIn, Math.max(minMonOut, floorOut));
    }

    function swapMonForUsdc(uint256 monIn, uint256 minUsdcOut) external onlyOwner returns (uint256) {
        uint256 floorOut = monToAssets(monIn).mulDiv(BPS - maxSwapSlippageBps, BPS);
        return _swap(address(wmon), asset(), monIn, Math.max(minUsdcOut, floorOut));
    }

    function swapUsdcForAusd(uint256 usdcIn, uint256 minAusdOut) external onlyOwner notOverdue returns (uint256) {
        uint256 floorOut = usdcIn.mulDiv(BPS - stableParityBandBps, BPS);
        return _swap(asset(), address(ausd), usdcIn, Math.max(minAusdOut, floorOut));
    }

    function swapAusdForUsdc(uint256 ausdIn, uint256 minUsdcOut) external onlyOwner returns (uint256) {
        uint256 floorOut = ausdIn.mulDiv(BPS - stableParityBandBps, BPS);
        return _swap(address(ausd), asset(), ausdIn, Math.max(minUsdcOut, floorOut));
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).forceApprove(address(spotVenue), amountIn);
        amountOut = spotVenue.swapExactIn(tokenIn, tokenOut, amountIn, minOut, address(this));
        emit Swapped(tokenIn, tokenOut, amountIn, amountOut);
    }

    // ───────────────────────────── admin: staking ─────────────────────────────

    /// @notice Delegate MON to a validator. Wrapped MON is unwrapped first as the precompile is native.
    function stake(uint64 validatorId, uint256 monAmount) external onlyOwner notOverdue {
        _requireCommissionInRange(validatorId);
        uint256 native = address(this).balance;
        if (native < monAmount) wmon.withdraw(monAmount - native);

        stakedMon += monAmount;
        _staking().delegate{value: monAmount}(validatorId);
        emit Staked(validatorId, monAmount);
    }

    /// @notice Begin unbonding. The MON is claimable after one epoch, roughly six to twelve hours.
    function unstake(uint64 validatorId, uint256 monAmount) external onlyOwner returns (uint8 withdrawId) {
        withdrawId = nextWithdrawId[validatorId];
        if (pendingUnstake[validatorId][withdrawId] != 0) revert WithdrawSlotBusy(validatorId, withdrawId);
        unchecked {
            nextWithdrawId[validatorId] = withdrawId + 1;
        }

        stakedMon -= monAmount;
        unstakingMon += monAmount;
        pendingUnstake[validatorId][withdrawId] = monAmount;

        _staking().undelegate(validatorId, monAmount, withdrawId);
        emit Unstaked(validatorId, withdrawId, monAmount);
    }

    /// @notice Collect matured unbonded MON. Permissionless, since it only returns funds to the vault.
    function claimUnstaked(uint64 validatorId, uint8 withdrawId) external nonReentrant returns (uint256 received) {
        uint256 recorded = pendingUnstake[validatorId][withdrawId];
        if (recorded == 0) revert NothingToClaim();

        uint256 before = address(this).balance;
        _staking().withdraw(validatorId, withdrawId);
        received = address(this).balance - before;

        delete pendingUnstake[validatorId][withdrawId];
        unstakingMon -= recorded;
        if (received > 0) wmon.deposit{value: received}();
        emit UnstakeClaimed(validatorId, withdrawId, received);
    }

    /// @notice Collect staking rewards as wrapped MON. Permissionless.
    function claimStakingRewards(uint64 validatorId) external nonReentrant returns (uint256 received) {
        uint256 before = address(this).balance;
        _staking().claimRewards(validatorId);
        received = address(this).balance - before;
        if (received > 0) wmon.deposit{value: received}();
        emit StakingRewardsClaimed(validatorId, received);
    }

    function _requireCommissionInRange(uint64 validatorId) internal {
        (bool ok, bytes memory data) =
            address(_staking()).call(abi.encodeWithSelector(IMonadStaking.getValidator.selector, validatorId));
        if (!ok || data.length < 12 * 32) revert StakingCallFailed();
        uint256 commission;
        assembly {
            commission := mload(add(data, 160)) // word index 4 of the return head
        }
        if (commission > maxValidatorCommission) revert ValidatorCommissionTooHigh(commission, maxValidatorCommission);
    }

    // ───────────────────────────── admin: Perpl ─────────────────────────────

    function perplCreateAccount(uint256 ausdAmount) external onlyOwner notOverdue {
        if (perplAccountOpened) revert AccountAlreadyOpen();
        perplAccountOpened = true;
        perplPrincipal += ausdAmount;
        ausd.forceApprove(address(perpl), ausdAmount);
        perpl.createAccount(ausdAmount);
        perplReportedAt = uint64(block.timestamp);
        emit PerplAccountOpened(ausdAmount);
    }

    function perplDepositCollateral(uint256 ausdAmount) external onlyOwner notOverdue {
        perplPrincipal += ausdAmount;
        ausd.forceApprove(address(perpl), ausdAmount);
        perpl.depositCollateral(ausdAmount);
        emit PerplCollateralDeposited(ausdAmount);
    }

    function perplWithdrawCollateral(uint256 ausdAmount) external onlyOwner returns (uint256 received) {
        if (ausdAmount > perplPrincipal) revert AmountExceedsPrincipal(ausdAmount, perplPrincipal);
        uint256 before = ausd.balanceOf(address(this));
        perpl.withdrawCollateral(ausdAmount);
        received = ausd.balanceOf(address(this)) - before;
        perplPrincipal -= ausdAmount;
        emit PerplCollateralWithdrawn(received);
    }

    /// @notice Let Perpl forward the admin's API-signed orders for this vault's account.
    /// @dev Perpl never permits withdrawals through an API key, so this grants trading only.
    function perplAllowOrderForwarding(bool allowed) external onlyOwner {
        perpl.allowOrderForwarding(allowed);
        emit PerplOrderForwardingSet(allowed);
    }

    /// @notice Mark the open position's unrealised result. Deposits and redemptions require this to
    ///         be fresh, and it is bounded relative to the collateral actually posted.
    function reportPerplPnl(int256 pnl) external onlyOwner {
        uint256 magnitude = pnl < 0 ? uint256(-pnl) : uint256(pnl);
        if (magnitude > perplPrincipal.mulDiv(perplPnlBandBps, BPS)) revert PnlOutOfBand();
        perplReportedPnl = pnl;
        perplReportedAt = uint64(block.timestamp);
        emit PerplPnlReported(pnl, perplPrincipal);
    }

    function _requireFreshPerplReport() internal view {
        if (perplPrincipal == 0) return;
        if (block.timestamp > uint256(perplReportedAt) + perplReportMaxAge) revert StalePerplReport();
    }

    // ───────────────────────────── admin: fees and config ─────────────────────────────

    /// @notice The only assets the admin can move out, and only what depositors' profits accrued.
    function withdrawFees(address to, uint256 amount) external onlyOwner notOverdue {
        if (to == address(0)) revert ZeroAddress();
        accruedFees -= amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    function proposePerformanceFee(uint16 bps) external onlyOwner {
        if (bps > MAX_PERFORMANCE_FEE_BPS) revert InvalidBps();
        if (bps <= performanceFeeBps) {
            performanceFeeBps = bps;
            emit FeeUpdated(bps);
            return;
        }
        pendingPerformanceFeeBps = bps;
        pendingFeeEffectiveAt = uint64(block.timestamp + FEE_TIMELOCK);
        emit FeeProposed(bps, pendingFeeEffectiveAt);
    }

    function applyPerformanceFee() external onlyOwner {
        if (pendingFeeEffectiveAt == 0) revert NoFeeTimelockPending();
        if (block.timestamp < pendingFeeEffectiveAt) revert FeeTimelockActive(pendingFeeEffectiveAt);
        performanceFeeBps = pendingPerformanceFeeBps;
        delete pendingPerformanceFeeBps;
        delete pendingFeeEffectiveAt;
        emit FeeUpdated(performanceFeeBps);
    }

    function setWhitelistEnabled(bool enabled) external onlyOwner {
        whitelistEnabled = enabled;
        emit WhitelistModeSet(enabled);
    }

    function setDepositors(address[] calldata accounts, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isDepositor[accounts[i]] = allowed;
            emit DepositorSet(accounts[i], allowed);
        }
    }

    function setLimits(uint256 depositCap_, uint256 minDeposit_) external onlyOwner {
        depositCap = depositCap_;
        minDeposit = minDeposit_;
        emit ConfigUpdated();
    }

    function setRiskParams(
        uint16 maxSwapSlippageBps_,
        uint16 stableParityBandBps_,
        uint256 maxValidatorCommission_,
        uint16 perplPnlBandBps_,
        uint32 perplReportMaxAge_
    ) external onlyOwner {
        if (
            maxSwapSlippageBps_ > MAX_SWAP_SLIPPAGE_BPS || stableParityBandBps_ > MAX_SWAP_SLIPPAGE_BPS
                || perplPnlBandBps_ > BPS
        ) revert InvalidBps();
        maxSwapSlippageBps = maxSwapSlippageBps_;
        stableParityBandBps = stableParityBandBps_;
        maxValidatorCommission = maxValidatorCommission_;
        perplPnlBandBps = perplPnlBandBps_;
        perplReportMaxAge = perplReportMaxAge_;
        emit ConfigUpdated();
    }

    function setVenue(ISpotVenue spotVenue_, IPriceOracle oracle_) external onlyOwner {
        if (address(spotVenue_) == address(0) || address(oracle_) == address(0)) revert ZeroAddress();
        spotVenue = spotVenue_;
        oracle = oracle_;
        emit ConfigUpdated();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ───────────────────────────── internals ─────────────────────────────

    modifier notOverdue() {
        if (hasOverdueRedemptions()) revert RedemptionsOverdue();
        _;
    }

    /// @dev Removes the share of `owner`'s cost basis that belongs to `shares`.
    function _takeBasis(address owner, uint256 shares) internal returns (uint256 basis) {
        uint256 bal = balanceOf(owner);
        if (bal == 0) return 0;
        basis = costBasis[owner].mulDiv(shares, bal);
        costBasis[owner] -= basis;
    }

    /// @dev Prices the shares, charges the fee on profit above the holder's own entry, pays the rest.
    /// @param gross must be priced BEFORE the shares are burnt, or the burn inflates the result.
    function _settle(uint256 shares, uint256 gross, uint256 basis, address owner, address receiver)
        internal
        returns (uint256 assetsOut, uint256 fee)
    {
        uint256 available = availableLiquidity();
        if (gross > available) revert InsufficientLiquidity(gross, available);

        if (gross > basis && performanceFeeBps > 0) {
            uint256 profit = gross - basis;
            fee = profit.mulDiv(performanceFeeBps, BPS);
            accruedFees += fee;
            emit PerformanceFeeCharged(owner, profit, fee);
        }
        assetsOut = gross - fee;
        IERC20(asset()).safeTransfer(receiver, assetsOut);
        emit Withdraw(msg.sender, receiver, owner, assetsOut, shares);
    }

    /// @dev The staking precompile. Overridden only in tests, since Foundry refuses to mock a
    ///      precompile address. Production always uses the constant above.
    function _staking() internal view virtual returns (IMonadStaking) {
        return STAKING;
    }

    function _advanceQueue() internal {
        uint256 i = queueHead;
        uint256 n = redemptions.length;
        while (i < n && redemptions[i].settled) {
            i++;
        }
        queueHead = i;
    }

    /// @dev Cost basis follows the shares when they move between holders, so a recipient is never
    ///      taxed on someone else's principal. Escrow moves are handled by the queue functions.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && from != address(this) && to != address(this)) {
            uint256 bal = balanceOf(from);
            if (bal > 0) {
                uint256 moved = costBasis[from].mulDiv(value, bal);
                costBasis[from] -= moved;
                costBasis[to] += moved;
            }
        }
        super._update(from, to, value);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return SHARE_DECIMALS_OFFSET;
    }

    /// @dev Receives native MON from unwrapping, from unbonding, and from staking rewards.
    receive() external payable {}
}
