// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IHedgeVenue} from "../interfaces/IHedgeVenue.sol";

/// @title PerplHedgeAdapter
/// @notice Hedge leg on Perpl (on-chain CLOB perps, AUSD collateral).
/// @dev Perpl settles on-chain but orders are submitted through its signed API
///      (https://github.com/PerplFoundation/api-docs). This adapter therefore splits the work:
///        - the strategy sets a *target* short notional on-chain (`adjustShort`);
///        - the keeper executes the order on Perpl and calls `reportPosition` with the resulting state.
///      Collateral custody: this contract holds the collateral and is the only address able to move it back
///      to the strategy. The keeper key never gains withdrawal rights over user collateral.
///      TODO(perpl): forward collateral into the Exchange contract and read position state on-chain once
///      the Exchange ABI / smart-contract-account flow is confirmed with the Perpl team.
contract PerplHedgeAdapter is IHedgeVenue, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant STRATEGY_ROLE = keccak256("STRATEGY_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    address public immutable collateralToken;
    address public immutable exchange;

    uint256 public targetShortNotional;
    uint256 public reportedShortNotional;
    uint256 public reportedEquity;
    uint256 public lastReportAt;
    uint256 public maxReportAge = 1 hours;

    event CollateralDeposited(uint256 amount);
    event CollateralWithdrawn(uint256 amount, address indexed to);
    event ShortTargetUpdated(uint256 target, int256 delta);
    event PositionReported(uint256 shortNotional, uint256 equity);
    event MaxReportAgeUpdated(uint256 seconds_);

    error ZeroAddress();

    constructor(address collateralToken_, address exchange_, address admin) {
        if (collateralToken_ == address(0) || admin == address(0)) revert ZeroAddress();
        collateralToken = collateralToken_;
        exchange = exchange_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ───────────────────────────── strategy ─────────────────────────────

    function depositCollateral(uint256 amount) external onlyRole(STRATEGY_ROLE) {
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        reportedEquity += amount;
        emit CollateralDeposited(amount);
    }

    function withdrawCollateral(uint256 amount, address to)
        external
        onlyRole(STRATEGY_ROLE)
        returns (uint256 withdrawn)
    {
        uint256 balance = IERC20(collateralToken).balanceOf(address(this));
        withdrawn = amount < balance ? amount : balance;
        reportedEquity = withdrawn >= reportedEquity ? 0 : reportedEquity - withdrawn;
        IERC20(collateralToken).safeTransfer(to, withdrawn);
        emit CollateralWithdrawn(withdrawn, to);
    }

    function adjustShort(int256 notionalDelta) external onlyRole(STRATEGY_ROLE) {
        if (notionalDelta >= 0) {
            targetShortNotional += uint256(notionalDelta);
        } else {
            uint256 reduce = uint256(-notionalDelta);
            targetShortNotional = reduce >= targetShortNotional ? 0 : targetShortNotional - reduce;
        }
        emit ShortTargetUpdated(targetShortNotional, notionalDelta);
    }

    // ───────────────────────────── keeper ─────────────────────────────

    /// @notice Keeper reports the executed Perpl position after filling the target.
    function reportPosition(uint256 shortNotional_, uint256 equity_) external onlyRole(KEEPER_ROLE) {
        reportedShortNotional = shortNotional_;
        reportedEquity = equity_;
        lastReportAt = block.timestamp;
        emit PositionReported(shortNotional_, equity_);
    }

    function setMaxReportAge(uint256 seconds_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxReportAge = seconds_;
        emit MaxReportAgeUpdated(seconds_);
    }

    // ───────────────────────────── views ─────────────────────────────

    function shortNotional() external view returns (uint256) {
        return reportedShortNotional;
    }

    function equity() external view returns (uint256) {
        return reportedEquity;
    }

    /// @notice True when the keeper has not reported for longer than `maxReportAge` while a short is open.
    function isStale() external view returns (bool) {
        return reportedShortNotional > 0 && block.timestamp - lastReportAt > maxReportAge;
    }

    /// @notice Difference between what the strategy wants and what the keeper last reported.
    function pendingShortDelta() external view returns (int256) {
        return int256(targetShortNotional) - int256(reportedShortNotional);
    }
}
