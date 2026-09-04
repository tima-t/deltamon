// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";

/// @title DeltaVault
/// @notice ERC-4626 vault that allocates to one delta-neutral strategy.
/// @dev Non-custodial by construction:
///      - no role can move user assets anywhere except along the vault ⇄ strategy path;
///      - the keeper can only invest / divest / rebalance / harvest;
///      - strategy replacement is timelocked and unwinds the old strategy first;
///      - withdrawals stay open while paused.
contract DeltaVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 3000;
    uint256 public constant STRATEGY_TIMELOCK = 1 days;
    uint256 private constant PPS_SCALE = 1e18;

    IStrategy public strategy;
    IStrategy public pendingStrategy;
    uint256 public pendingStrategyActivation;

    uint256 public depositCap;
    uint256 public performanceFeeBps;
    address public feeRecipient;
    /// @notice Price per share (1e18) above which performance fees accrue.
    uint256 public highWaterMark;

    event StrategyProposed(address indexed strategy, uint256 activatesAt);
    event StrategyActivated(address indexed strategy);
    event Invested(uint256 assets);
    event Divested(uint256 assets);
    event Rebalanced(int256 netDeltaBps);
    event Harvested(uint256 profit, uint256 fee, uint256 feeShares);
    event DepositCapUpdated(uint256 cap);
    event PerformanceFeeUpdated(uint256 bps);
    event FeeRecipientUpdated(address recipient);
    event EmergencyExit(address indexed by);

    error NoStrategy();
    error StrategyAlreadySet();
    error InvalidStrategy();
    error NoPendingStrategy();
    error TimelockActive(uint256 activatesAt);
    error FeeTooHigh();
    error ZeroAddress();
    error InsufficientLiquidity(uint256 requested, uint256 available);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address admin,
        address feeRecipient_,
        uint256 depositCap_,
        uint256 performanceFeeBps_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (admin == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (performanceFeeBps_ > MAX_PERFORMANCE_FEE_BPS) revert FeeTooHigh();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
        feeRecipient = feeRecipient_;
        depositCap = depositCap_;
        performanceFeeBps = performanceFeeBps_;
        highWaterMark = PPS_SCALE;
    }

    // ───────────────────────────── views ─────────────────────────────

    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        return address(strategy) == address(0) ? idle : idle + strategy.totalAssets();
    }

    function idleAssets() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @notice Assets per share, scaled to 1e18.
    function pricePerShare() public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? PPS_SCALE : totalAssets().mulDiv(PPS_SCALE, supply);
    }

    function netDeltaBps() external view returns (int256) {
        return address(strategy) == address(0) ? int256(0) : strategy.netDeltaBps();
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 total = totalAssets();
        return total >= depositCap ? 0 : depositCap - total;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assets = maxDeposit(receiver);
        return assets == 0 ? 0 : _convertToShares(assets, Math.Rounding.Floor);
    }

    // ───────────────────────────── keeper ─────────────────────────────

    /// @notice Move idle assets into the strategy.
    function invest(uint256 assets) external onlyRole(KEEPER_ROLE) whenNotPaused nonReentrant {
        IStrategy s = _requireStrategy();
        IERC20(asset()).safeTransfer(address(s), assets);
        s.deposit(assets);
        emit Invested(assets);
    }

    /// @notice Pull assets back from the strategy into the idle buffer.
    function divest(uint256 assets) external onlyRole(KEEPER_ROLE) nonReentrant returns (uint256 received) {
        received = _requireStrategy().withdraw(assets, address(this));
        emit Divested(received);
    }

    /// @notice Deploy idle strategy capital and re-hedge to neutral.
    function rebalance(bytes calldata data) external onlyRole(KEEPER_ROLE) whenNotPaused nonReentrant {
        IStrategy s = _requireStrategy();
        s.rebalance(data);
        emit Rebalanced(s.netDeltaBps());
    }

    /// @notice Mint performance-fee shares on profit above the high-water mark.
    function harvest() external onlyRole(KEEPER_ROLE) nonReentrant returns (uint256 feeShares) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        uint256 total = totalAssets();
        uint256 pps = total.mulDiv(PPS_SCALE, supply);
        if (pps <= highWaterMark) return 0;

        uint256 profit = (pps - highWaterMark).mulDiv(supply, PPS_SCALE);
        uint256 fee = profit.mulDiv(performanceFeeBps, BPS);
        if (fee > 0 && fee < total) {
            // Mint shares worth exactly `fee` after dilution.
            feeShares = fee.mulDiv(supply, total - fee);
            _mint(feeRecipient, feeShares);
        }
        highWaterMark = totalAssets().mulDiv(PPS_SCALE, totalSupply());
        emit Harvested(profit, fee, feeShares);
    }

    // ───────────────────────────── admin ─────────────────────────────

    /// @notice One-time initial strategy assignment (no timelock while the vault is empty of strategy).
    function setStrategy(IStrategy s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(strategy) != address(0)) revert StrategyAlreadySet();
        _validateStrategy(s);
        strategy = s;
        emit StrategyActivated(address(s));
    }

    function proposeStrategy(IStrategy s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _validateStrategy(s);
        pendingStrategy = s;
        pendingStrategyActivation = block.timestamp + STRATEGY_TIMELOCK;
        emit StrategyProposed(address(s), pendingStrategyActivation);
    }

    function activateStrategy() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        IStrategy next = pendingStrategy;
        if (address(next) == address(0)) revert NoPendingStrategy();
        if (block.timestamp < pendingStrategyActivation) revert TimelockActive(pendingStrategyActivation);

        IStrategy previous = strategy;
        if (address(previous) != address(0)) previous.emergencyExit();

        strategy = next;
        delete pendingStrategy;
        delete pendingStrategyActivation;
        emit StrategyActivated(address(next));
    }

    function setDepositCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositCap = cap;
        emit DepositCapUpdated(cap);
    }

    function setPerformanceFee(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_PERFORMANCE_FEE_BPS) revert FeeTooHigh();
        performanceFeeBps = bps;
        emit PerformanceFeeUpdated(bps);
    }

    function setFeeRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    // ───────────────────────────── guardian ─────────────────────────────

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    /// @notice Pull everything back from the strategy and pause deposits. Withdrawals stay open.
    function emergencyExit() external onlyRole(GUARDIAN_ROLE) nonReentrant {
        if (address(strategy) != address(0)) strategy.emergencyExit();
        if (!paused()) _pause();
        emit EmergencyExit(msg.sender);
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _requireStrategy() internal view returns (IStrategy s) {
        s = strategy;
        if (address(s) == address(0)) revert NoStrategy();
    }

    function _validateStrategy(IStrategy s) internal view {
        if (address(s) == address(0) || s.vault() != address(this) || s.asset() != asset()) revert InvalidStrategy();
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        nonReentrant
    {
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle < assets) {
            if (address(strategy) == address(0)) revert InsufficientLiquidity(assets, idle);
            strategy.withdraw(assets - idle, address(this));
            uint256 nowIdle = IERC20(asset()).balanceOf(address(this));
            if (nowIdle < assets) revert InsufficientLiquidity(assets, nowIdle);
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }
}
