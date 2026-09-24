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

/// @title DeltaMonVault
/// @notice A USDC vault with two roles. Depositors put USDC in and receive sdMON, an ERC-4626 share
///         of the whole book. The admin allocates that book across exactly three places and nowhere
///         else: Kuru for spot swaps, Monad's staking precompile for MON, and perp managers who run
///         the short leg on Perpl. The admin is meant to be a multisig. A separate keeper key does
///         routine upkeep and nothing else.
///
/// @dev What the admin can NOT do, enforced by this contract rather than by policy:
///      - There is no generic call or delegatecall. Every external interaction is a named function
///        with a fixed target, so no other protocol is reachable.
///      - Swaps are floored against the Chainlink MON/USD feed, so the admin cannot pick a bad
///        minimum output and trade the vault's money away to themselves on the order book.
///      - Staking only reaches validators whose commission is under a configured cap.
///      - Anything that widens the admin's reach waits three days: a higher perp ceiling, looser
///        risk limits, a new venue or oracle, a higher fee. That is longer than the redemption
///        deadline, so a depositor who objects can always be paid out before it lands.
///
///      What the admin CAN do, and depositors should know:
///      - Withdrawals are paid out of idle USDC and nothing else. There is no redemption queue and
///        no deadline: if the book is deployed, a holder waits until the admin brings enough back.
///      - Perp managers are custodial, and adding one takes effect immediately. Funding one is an
///        ordinary transfer to an address the vault cannot claw back from. What bounds it is the
///        perp ceiling, and raising that still waits three days.
///      - The perp book's value is reported, not measured, within a band.
contract DeltaMonVault is ERC4626, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;
    using SafeCast for uint256;

    // ───────────────────────────── constants ─────────────────────────────

    IMonadStaking public constant STAKING = IMonadStaking(0x0000000000000000000000000000000000001000);

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 1000; // 10 %
    uint256 public constant MAX_SWAP_SLIPPAGE_BPS = 500;
    /// @notice Fee increases wait this long; decreases apply at once. It gives a depositor who
    ///         objects three days to redeem, as far as the idle USDC reaches.
    uint256 public constant FEE_TIMELOCK = 3 days;
    /// @notice Changing the swap venue or the oracle waits this long, for the same reason.
    uint256 public constant VENUE_TIMELOCK = 3 days;
    /// @notice Raising the perp ceiling and loosening risk limits wait this long. Adding or removing
    ///         a manager, and tightening anything, apply at once.
    uint256 public constant CONFIG_TIMELOCK = 3 days;
    /// @notice Gas the oracle is given when checking whether it is live. The caller must supply it
    ///         in full, so nobody can fake an outage by starving the call.
    uint256 public constant ORACLE_CALL_GAS = 500_000;
    uint8 private constant SHARE_DECIMALS_OFFSET = 12;
    uint256 private constant WAD = 1e18;

    // ───────────────────────────── wiring ─────────────────────────────

    IWMON public immutable wmon;
    IERC20 public immutable ausd;
    uint8 private immutable _assetDecimals;

    ISpotVenue public spotVenue;
    IPriceOracle public oracle;
    ISpotVenue public pendingSpotVenue;
    IPriceOracle public pendingOracle;
    uint64 public venueEffectiveAt;

    /// @notice Hot key for routine upkeep: marking the perp book and claiming staking rewards.
    address public keeper;

    // ───────────────────────────── config ─────────────────────────────

    uint16 public performanceFeeBps;
    uint16 public pendingPerformanceFeeBps;
    uint64 public pendingFeeEffectiveAt;

    uint16 public maxSwapSlippageBps = 50;
    /// @notice How far a USDC and AUSD swap may stray from parity. Both are dollar stablecoins.
    uint16 public stableParityBandBps = 100;
    /// @notice Validator commission ceiling, 1e18 scaled. 1e17 is ten percent.
    uint256 public maxValidatorCommission = 2e17;

    struct RiskParams {
        uint16 maxSwapSlippageBps;
        uint16 stableParityBandBps;
        uint16 perpPnlBandBps;
        uint32 perpReportMaxAge;
        uint256 maxValidatorCommission;
    }

    /// @notice A looser set of risk limits waiting out CONFIG_TIMELOCK.
    RiskParams public pendingRiskParams;
    uint64 public pendingRiskParamsAt;

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

    /// @notice Externally owned addresses cleared to run the short leg with vault funds.
    /// @dev A manager is CUSTODIAL over what it is sent. The vault cannot compel a return.
    mapping(address => bool) public isPerpManager;
    /// @dev Every address ever cleared as a manager, so a front end can list them in one read.
    ///      Removing a manager clears the flag above but keeps the entry here, because a removed
    ///      manager may still hold value it has to return.
    address[] private _knownPerpManagers;
    mapping(address => bool) private _seenPerpManager;
    /// @notice Per manager, value sent minus value returned, in asset units.
    mapping(address => uint256) public perpManagerOutstanding;
    /// @notice Sum of the above across every manager.
    uint256 public perpManagerDeployed;
    /// @notice Ceiling on the whole perp book as a share of the vault. Bounds the blast radius.
    uint16 public maxPerpAllocationBps = 5000;
    uint16 public pendingMaxPerpAllocationBps;
    uint64 public pendingMaxPerpAllocationAt;

    /// @notice Unrealised result across the perp book, reported by the keeper or the admin.
    int256 public perpReportedPnl;
    uint64 public perpReportedAt;
    uint16 public perpPnlBandBps = 5000;
    uint32 public perpReportMaxAge = 6 hours;

    uint256 public accruedFees;

    // ───────────────────────────── events ─────────────────────────────

    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event Staked(uint64 indexed validatorId, uint256 monAmount);
    event Unstaked(uint64 indexed validatorId, uint8 withdrawId, uint256 monAmount);
    event UnstakeClaimed(uint64 indexed validatorId, uint8 withdrawId, uint256 monReceived);
    event StakingRewardsClaimed(uint64 indexed validatorId, uint256 monReceived);
    event PerpPnlReported(int256 pnl, uint256 deployed);
    event PerpMarkInvalidated(int256 pnl);
    event PerpManagerSet(address indexed manager, bool allowed);
    event SentToPerpManager(address indexed manager, address indexed token, uint256 amount, uint256 outstanding);
    event ReturnedByPerpManager(address indexed manager, address indexed token, uint256 amount, uint256 outstanding);
    event MaxPerpAllocationProposed(uint16 bps, uint64 effectiveAt);
    event MaxPerpAllocationUpdated(uint16 bps);
    event RedeemedInKind(
        address indexed owner,
        address indexed receiver,
        uint256 shares,
        uint256 assetsOut,
        uint256 monOut,
        uint256 ausdOut
    );
    event PerformanceFeeCharged(address indexed owner, uint256 profit, uint256 fee);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event FeeProposed(uint16 bps, uint64 effectiveAt);
    event FeeUpdated(uint16 bps);
    event WhitelistModeSet(bool enabled);
    event DepositorSet(address indexed account, bool allowed);
    event KeeperSet(address indexed keeper);
    event RiskParamsProposed(uint64 effectiveAt);
    event ConfigUpdated();
    event VenueProposed(address spotVenue, address oracle, uint64 effectiveAt);

    // ───────────────────────────── errors ─────────────────────────────

    error ZeroAddress();
    error InvalidBps();
    error NotWhitelisted(address account);
    error BelowMinDeposit(uint256 assets, uint256 minimum);
    error InsufficientLiquidity(uint256 needed, uint256 available);
    error NothingToClaim();
    error StalePerpReport();
    error PnlOutOfBand();
    error ValidatorCommissionTooHigh(uint256 commission, uint256 maximum);
    error WithdrawSlotBusy(uint64 validatorId, uint8 withdrawId);
    error StakingCallFailed();
    error NoFeeTimelockPending();
    error FeeTimelockActive(uint64 effectiveAt);
    error NotAPerpManager(address account);
    error NotKeeperOrOwner(address account);
    error UnsupportedToken(address token);
    error PerpAllocationTooHigh(uint256 deployed, uint256 ceiling);
    error NoVenueChangePending();
    error VenueTimelockActive(uint64 effectiveAt);
    error NoChangePending();
    error TimelockActive(uint64 effectiveAt);
    error VenueShortchanged(uint256 received, uint256 minimum);
    error RenounceDisabled();
    error OracleIsLive();
    error InsufficientGasForOracleCheck();

    constructor(
        IERC20 usdc_,
        IWMON wmon_,
        IERC20 ausd_,
        ISpotVenue spotVenue_,
        IPriceOracle oracle_,
        uint256 depositCap_,
        uint16 performanceFeeBps_
    ) ERC20("DeltaMon Vault Share", "sdMON") ERC4626(usdc_) Ownable(msg.sender) {
        if (
            address(wmon_) == address(0) || address(ausd_) == address(0) || address(spotVenue_) == address(0)
                || address(oracle_) == address(0)
        ) revert ZeroAddress();
        if (performanceFeeBps_ > MAX_PERFORMANCE_FEE_BPS) revert InvalidBps();

        wmon = wmon_;
        ausd = ausd_;
        spotVenue = spotVenue_;
        oracle = oracle_;
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

    /// @notice Everything the vault controls, before the fees it owes.
    function grossAssets() public view returns (uint256) {
        return usdcBalance() + monToAssets(totalMon()) + ausdToAssets(ausd.balanceOf(address(this))) + perpEquity();
    }

    /// @notice Every MON the vault controls: wrapped, native, delegated, and unbonding.
    function totalMon() public view returns (uint256) {
        return wmon.balanceOf(address(this)) + address(this).balance + stakedMon + unstakingMon;
    }

    /// @notice Everything the vault has pushed out to run the short leg, held by perp managers.
    function perpDeployed() public view returns (uint256) {
        return perpManagerDeployed;
    }

    /// @notice The perp book at its reported value, floored at zero.
    function perpEquity() public view returns (uint256) {
        uint256 deployed = perpDeployed();
        // Nothing out means nothing to value, whatever a leftover report still says.
        if (deployed == 0) return 0;
        int256 pnl = perpReportedPnl;
        // A mark that has gone stale is only trusted in the direction that does not favour whoever
        // is leaving. An unconfirmed gain is dropped; a reported loss still counts.
        if (perpReportIsStale() && pnl > 0) pnl = 0;
        int256 equity = deployed.toInt256() + pnl;
        return equity > 0 ? uint256(equity) : 0;
    }

    function perpReportIsStale() public view returns (bool) {
        if (perpDeployed() == 0) return false;
        // Zero means never marked, or invalidated by a return above what a manager was sent. Say so
        // outright rather than leaning on the clock having passed the max age.
        if (perpReportedAt == 0) return true;
        return block.timestamp > uint256(perpReportedAt) + perpReportMaxAge;
    }

    function monPrice() public view returns (uint256) {
        return oracle.price(address(wmon));
    }

    /// @notice Whether the oracle can price MON right now. While it cannot, `redeemInKind` opens.
    /// @dev The oracle is always handed ORACLE_CALL_GAS in full. Otherwise a caller could send just
    ///      too little gas for the oracle to finish and pass the failure off as an outage.
    function oracleIsLive() public view returns (bool) {
        // A call keeps back 1/64 of the gas left (EIP-150). The margin covers reaching the call.
        if (gasleft() < ORACLE_CALL_GAS + ORACLE_CALL_GAS / 63 + 50_000) revert InsufficientGasForOracleCheck();
        try oracle.price{gas: ORACLE_CALL_GAS}(address(wmon)) returns (uint256 p) {
            return p > 0;
        } catch {
            return false;
        }
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

    /// @dev The fee comes off the whole book, not off the idle USDC alone. Otherwise deploying the
    ///      USDC that backs an accrued fee would quietly lift the share price for everyone else.
    function totalAssets() public view override returns (uint256) {
        uint256 gross = grossAssets();
        return gross > accruedFees ? gross - accruedFees : 0;
    }

    function pricePerShare() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
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

    /// @notice Only what the idle USDC can actually pay. The rest waits for the admin to unwind.
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
        _requireFreshPerpReport();
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        if (assets < minDeposit) revert BelowMinDeposit(assets, minDeposit);
        shares = previewDeposit(assets);
        _pullAndMint(assets, shares, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256 assets) {
        _requireFreshPerpReport();
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

    /// @notice Redeem out of idle USDC. Capped by `availableLiquidity`, so it reverts when the book
    ///         is deployed and the admin has not brought enough back yet.
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 assetsOut)
    {
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
        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) revert ERC4626ExceededMaxWithdraw(owner, assets, maxAssets);
        shares = previewWithdraw(assets);

        uint256 gross = previewRedeem(shares);
        uint256 basis = _takeBasis(owner, shares);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        _settle(shares, gross, basis, owner, receiver);
    }

    /// @notice Exit without a price. While the oracle cannot price MON, take your share of what the
    ///         vault holds liquid, in kind: idle USDC, wrapped MON and AUSD. Your share of staked MON,
    ///         unbonding MON and the perp book stays behind with the holders who remain, so nobody who
    ///         stays can lose by it. No performance fee is charged, since there is no price to
    ///         measure a profit against.
    function redeemInKind(uint256 shares, address receiver)
        external
        nonReentrant
        returns (uint256 assetsOut, uint256 monOut, uint256 ausdOut)
    {
        if (oracleIsLive()) revert OracleIsLive();
        if (receiver == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf(msg.sender);
        if (shares == 0 || shares > bal) revert ERC4626ExceededMaxRedeem(msg.sender, shares, bal);

        uint256 supply = totalSupply();
        // Native MON left from unwrapping or unbonding is folded in, so it is shared like the rest.
        uint256 native = address(this).balance;
        if (native > 0) wmon.deposit{value: native}();

        assetsOut = availableLiquidity().mulDiv(shares, supply);
        monOut = wmon.balanceOf(address(this)).mulDiv(shares, supply);
        ausdOut = ausd.balanceOf(address(this)).mulDiv(shares, supply);

        _takeBasis(msg.sender, shares);
        _burn(msg.sender, shares);

        if (assetsOut > 0) IERC20(asset()).safeTransfer(receiver, assetsOut);
        if (monOut > 0) IERC20(address(wmon)).safeTransfer(receiver, monOut);
        if (ausdOut > 0) ausd.safeTransfer(receiver, ausdOut);
        emit RedeemedInKind(msg.sender, receiver, shares, assetsOut, monOut, ausdOut);
    }

    // ───────────────────────────── admin: Kuru ─────────────────────────────

    function swapUsdcForMon(uint256 usdcIn, uint256 minMonOut)
        external
        nonReentrant
        onlyOwner
        whenNotPaused
        returns (uint256)
    {
        uint256 floorOut = assetsToMon(usdcIn).mulDiv(BPS - maxSwapSlippageBps, BPS);
        return _swap(asset(), address(wmon), usdcIn, Math.max(minMonOut, floorOut));
    }

    function swapMonForUsdc(uint256 monIn, uint256 minUsdcOut) external nonReentrant onlyOwner returns (uint256) {
        uint256 floorOut = monToAssets(monIn).mulDiv(BPS - maxSwapSlippageBps, BPS);
        return _swap(address(wmon), asset(), monIn, Math.max(minUsdcOut, floorOut));
    }

    function swapUsdcForAusd(uint256 usdcIn, uint256 minAusdOut)
        external
        nonReentrant
        onlyOwner
        whenNotPaused
        returns (uint256)
    {
        uint256 floorOut = usdcIn.mulDiv(BPS - stableParityBandBps, BPS);
        return _swap(asset(), address(ausd), usdcIn, Math.max(minAusdOut, floorOut));
    }

    function swapAusdForUsdc(uint256 ausdIn, uint256 minUsdcOut) external nonReentrant onlyOwner returns (uint256) {
        uint256 floorOut = ausdIn.mulDiv(BPS - stableParityBandBps, BPS);
        return _swap(address(ausd), asset(), ausdIn, Math.max(minUsdcOut, floorOut));
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 amountOut)
    {
        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(address(spotVenue), amountIn);
        spotVenue.swapExactIn(tokenIn, tokenOut, amountIn, minOut, address(this));
        // The venue reports its own result. Believe the balance instead.
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
        if (amountOut < minOut) revert VenueShortchanged(amountOut, minOut);
        IERC20(tokenIn).forceApprove(address(spotVenue), 0);
        emit Swapped(tokenIn, tokenOut, amountIn, amountOut);
    }

    // ───────────────────────────── admin: staking ─────────────────────────────

    /// @notice Delegate MON to a validator. Wrapped MON is unwrapped first as the precompile is native.
    function stake(uint64 validatorId, uint256 monAmount) external nonReentrant onlyOwner whenNotPaused {
        _requireCommissionInRange(validatorId);
        uint256 native = address(this).balance;
        if (native < monAmount) wmon.withdraw(monAmount - native);

        stakedMon += monAmount;
        _staking().delegate{value: monAmount}(validatorId);
        emit Staked(validatorId, monAmount);
    }

    /// @notice Begin unbonding. The MON is claimable after one epoch, roughly six to twelve hours.
    function unstake(uint64 validatorId, uint256 monAmount) external nonReentrant onlyOwner returns (uint8 withdrawId) {
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

    /// @notice Collect staking rewards as wrapped MON.
    /// @dev Rewards only count once claimed, so a claim steps the share price up. Left open to
    ///      anyone, a bot could deposit, claim and redeem in one transaction and take a slice of
    ///      rewards it never earned. The keeper claims often instead, which keeps every step small.
    function claimStakingRewards(uint64 validatorId)
        external
        nonReentrant
        onlyKeeperOrOwner
        returns (uint256 received)
    {
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

    // ───────────────────────────── admin: perp managers ─────────────────────────────

    /// @notice Add or remove a perp manager. Both take effect immediately.
    /// @dev A manager is custodial over whatever it is sent, so this is the one lever here that is
    ///      deliberately not timelocked. What bounds the exposure is the perp ceiling, and raising
    ///      that still waits CONFIG_TIMELOCK. Removing a manager keeps their outstanding balance on
    ///      the books, so the accounting stays honest and they can still return what they hold.
    function controlPerpManagers(address manager, bool allowed) external onlyOwner {
        if (manager == address(0)) revert ZeroAddress();
        isPerpManager[manager] = allowed;
        if (allowed && !_seenPerpManager[manager]) {
            _seenPerpManager[manager] = true;
            _knownPerpManagers.push(manager);
        }
        emit PerpManagerSet(manager, allowed);
    }

    /// @notice Every address ever cleared as a manager, live or not. Read it alongside
    ///         `isPerpManager` and `perpManagerOutstanding` to see who is active and who still owes.
    function perpManagers() external view returns (address[] memory) {
        return _knownPerpManagers;
    }

    function perpManagerCount() external view returns (uint256) {
        return _knownPerpManagers.length;
    }

    /// @notice Send USDC or AUSD to a whitelisted manager so they can run the position on Perpl.
    /// @dev This is a real transfer to an externally owned address. Once it lands, only that
    ///      address can move it, and the vault has no way to claw it back. The allocation ceiling
    ///      and the reporting gate below are what bound the exposure.
    function sendFundPerpManager(address manager, address token, uint256 amount)
        external
        nonReentrant
        onlyOwner
        whenNotPaused
    {
        if (!isPerpManager[manager]) revert NotAPerpManager(manager);
        _requireSupportedToken(token);

        // An empty book has no result, by definition. Start both the mark and its clock from zero,
        // or a report left over from the previous book would come back here as a fresh one. Only
        // this transition resets the clock, so dust top-ups cannot keep a stale mark alive.
        if (perpManagerDeployed == 0) {
            perpReportedPnl = 0;
            perpReportedAt = uint64(block.timestamp);
        }
        perpManagerOutstanding[manager] += amount;
        perpManagerDeployed += amount;

        IERC20(token).safeTransfer(manager, amount);
        _requirePerpAllocationInRange(); // measured after the value leaves, never double counted
        emit SentToPerpManager(manager, token, amount, perpManagerOutstanding[manager]);
    }

    /// @notice Return USDC or AUSD from a manager. This is a return of capital, not a subscription,
    ///         so no shares are minted and existing holders simply see the value come back.
    /// @dev Callable by a current manager, or by a former one that still owes value. Anything
    ///      returned above what was sent is profit and lands straight in the vault.
    function perpManagerDeposit(address token, uint256 amount) external nonReentrant {
        uint256 outstanding = perpManagerOutstanding[msg.sender];
        if (!isPerpManager[msg.sender] && outstanding == 0) revert NotAPerpManager(msg.sender);
        _requireSupportedToken(token);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 credited = amount < outstanding ? amount : outstanding;
        perpManagerOutstanding[msg.sender] = outstanding - credited;
        perpManagerDeployed -= credited;

        if (perpManagerDeployed == 0) {
            delete perpReportedPnl;
        } else if (amount > credited) {
            // What came back above this manager's own balance is realised profit, now held here as
            // tokens. The book-wide mark may already count it, so take it out, and treat the mark
            // as stale until it is reported again. A stale mark is only trusted against leavers.
            perpReportedPnl -= (amount - credited).toInt256();
            perpReportedAt = 0;
            emit PerpMarkInvalidated(perpReportedPnl);
        }

        emit ReturnedByPerpManager(msg.sender, token, amount, perpManagerOutstanding[msg.sender]);
    }

    /// @notice Mark the unrealised result across the perp book. Deposits require this to be fresh.
    /// @dev The keeper reports inside the band both ways. The admin may also mark a loss down to the
    ///      whole book, so a real loss is never held up by a band that takes three days to widen.
    function reportPerpPnl(int256 pnl) external onlyKeeperOrOwner {
        uint256 deployed = perpDeployed();
        uint256 limit = pnl < 0 && msg.sender == owner() ? deployed : deployed.mulDiv(perpPnlBandBps, BPS);
        uint256 magnitude = pnl < 0 ? uint256(-pnl) : uint256(pnl);
        if (magnitude > limit) revert PnlOutOfBand();
        perpReportedPnl = pnl;
        perpReportedAt = uint64(block.timestamp);
        emit PerpPnlReported(pnl, deployed);
    }

    /// @notice Lower the perp ceiling at once, or propose a higher one that waits CONFIG_TIMELOCK.
    function setMaxPerpAllocation(uint16 bps) external onlyOwner {
        if (bps > BPS) revert InvalidBps();
        if (bps <= maxPerpAllocationBps) {
            maxPerpAllocationBps = bps;
            // A cut also withdraws a raise still waiting, so it cannot land later unannounced.
            delete pendingMaxPerpAllocationBps;
            delete pendingMaxPerpAllocationAt;
            emit MaxPerpAllocationUpdated(bps);
            return;
        }
        pendingMaxPerpAllocationBps = bps;
        pendingMaxPerpAllocationAt = uint64(block.timestamp + CONFIG_TIMELOCK);
        emit MaxPerpAllocationProposed(bps, pendingMaxPerpAllocationAt);
    }

    function applyMaxPerpAllocation() external onlyOwner {
        uint64 effectiveAt = pendingMaxPerpAllocationAt;
        if (effectiveAt == 0) revert NoChangePending();
        if (block.timestamp < effectiveAt) revert TimelockActive(effectiveAt);
        maxPerpAllocationBps = pendingMaxPerpAllocationBps;
        delete pendingMaxPerpAllocationBps;
        delete pendingMaxPerpAllocationAt;
        emit MaxPerpAllocationUpdated(maxPerpAllocationBps);
    }

    /// @dev Only deposits are gated on a fresh mark. Exits are not, because an admin who simply
    ///      stopped reporting would otherwise trap every depositor behind their silence. Exits
    ///      instead price against the conservative valuation in `perpEquity`.
    function _requireFreshPerpReport() internal view {
        if (perpReportIsStale()) revert StalePerpReport();
    }

    function _requireSupportedToken(address token) internal view {
        if (token != asset() && token != address(ausd)) revert UnsupportedToken(token);
    }

    function _requirePerpAllocationInRange() internal view {
        uint256 ceiling = totalAssets().mulDiv(maxPerpAllocationBps, BPS);
        uint256 deployed = perpDeployed();
        if (deployed > ceiling) revert PerpAllocationTooHigh(deployed, ceiling);
    }

    // ───────────────────────────── admin: fees and config ─────────────────────────────

    /// @notice The only assets the admin can move out, and only what depositors' profits accrued.
    function withdrawFees(address to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        accruedFees -= amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    function proposePerformanceFee(uint16 bps) external onlyOwner {
        if (bps > MAX_PERFORMANCE_FEE_BPS) revert InvalidBps();
        if (bps <= performanceFeeBps) {
            performanceFeeBps = bps;
            // Cancel any queued increase too, or it stays armed behind the lower headline number
            // and fires later without ever being re-announced.
            delete pendingPerformanceFeeBps;
            delete pendingFeeEffectiveAt;
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

    /// @notice Tighten risk limits at once, or propose looser ones that wait CONFIG_TIMELOCK. A set
    ///         counts as looser if any single limit in it widens. Tightening also withdraws a looser
    ///         set still waiting, so it cannot land later unannounced.
    function setRiskParams(
        uint16 maxSwapSlippageBps_,
        uint16 stableParityBandBps_,
        uint256 maxValidatorCommission_,
        uint16 perpPnlBandBps_,
        uint32 perpReportMaxAge_
    ) external onlyOwner {
        if (
            maxSwapSlippageBps_ > MAX_SWAP_SLIPPAGE_BPS || stableParityBandBps_ > MAX_SWAP_SLIPPAGE_BPS
                || perpPnlBandBps_ > BPS
        ) revert InvalidBps();
        RiskParams memory p = RiskParams({
            maxSwapSlippageBps: maxSwapSlippageBps_,
            stableParityBandBps: stableParityBandBps_,
            perpPnlBandBps: perpPnlBandBps_,
            perpReportMaxAge: perpReportMaxAge_,
            maxValidatorCommission: maxValidatorCommission_
        });
        bool loosens = p.maxSwapSlippageBps > maxSwapSlippageBps || p.stableParityBandBps > stableParityBandBps
            || p.perpPnlBandBps > perpPnlBandBps || p.perpReportMaxAge > perpReportMaxAge
            || p.maxValidatorCommission > maxValidatorCommission;
        if (!loosens) {
            delete pendingRiskParams;
            delete pendingRiskParamsAt;
            _applyRiskParams(p);
            return;
        }
        pendingRiskParams = p;
        pendingRiskParamsAt = uint64(block.timestamp + CONFIG_TIMELOCK);
        emit RiskParamsProposed(pendingRiskParamsAt);
    }

    function applyRiskParams() external onlyOwner {
        uint64 effectiveAt = pendingRiskParamsAt;
        if (effectiveAt == 0) revert NoChangePending();
        if (block.timestamp < effectiveAt) revert TimelockActive(effectiveAt);
        RiskParams memory p = pendingRiskParams;
        delete pendingRiskParams;
        delete pendingRiskParamsAt;
        _applyRiskParams(p);
    }

    function _applyRiskParams(RiskParams memory p) internal {
        maxSwapSlippageBps = p.maxSwapSlippageBps;
        stableParityBandBps = p.stableParityBandBps;
        maxValidatorCommission = p.maxValidatorCommission;
        perpPnlBandBps = p.perpPnlBandBps;
        perpReportMaxAge = p.perpReportMaxAge;
        emit ConfigUpdated();
    }

    /// @notice Set the keeper, or clear it with the zero address. It can mark the perp book inside
    ///         the band and claim staking rewards, and nothing else.
    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice Queue a new swap venue and oracle. Both are trusted by the swap path, so a malicious
    ///         pair could drain the vault. The delay is what makes that survivable: depositors can
    ///         see the proposal and leave before it takes effect.
    function proposeVenue(ISpotVenue spotVenue_, IPriceOracle oracle_) external onlyOwner {
        if (address(spotVenue_) == address(0) || address(oracle_) == address(0)) revert ZeroAddress();
        pendingSpotVenue = spotVenue_;
        pendingOracle = oracle_;
        venueEffectiveAt = uint64(block.timestamp + VENUE_TIMELOCK);
        emit VenueProposed(address(spotVenue_), address(oracle_), venueEffectiveAt);
    }

    function applyVenue() external onlyOwner {
        if (venueEffectiveAt == 0) revert NoVenueChangePending();
        if (block.timestamp < venueEffectiveAt) revert VenueTimelockActive(venueEffectiveAt);
        spotVenue = pendingSpotVenue;
        oracle = pendingOracle;
        delete pendingSpotVenue;
        delete pendingOracle;
        delete venueEffectiveAt;
        emit ConfigUpdated();
    }

    function cancelVenueChange() external onlyOwner {
        delete pendingSpotVenue;
        delete pendingOracle;
        delete venueEffectiveAt;
        emit ConfigUpdated();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Disabled. With no owner nothing could unwind MON, unstake or recall the perp book,
    ///         and depositors would be left with only the idle USDC.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ───────────────────────────── internals ─────────────────────────────

    modifier onlyKeeperOrOwner() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeperOrOwner(msg.sender);
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

    /// @dev Cost basis follows the shares when they move between holders, so a recipient is never
    ///      taxed on someone else's principal.
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
