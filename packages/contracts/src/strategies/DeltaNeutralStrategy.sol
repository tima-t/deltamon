// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";
import {ISpotVenue} from "../interfaces/ISpotVenue.sol";
import {IStakingVenue} from "../interfaces/IStakingVenue.sol";
import {IHedgeVenue} from "../interfaces/IHedgeVenue.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title DeltaNeutralStrategy
/// @notice Long leg: buy MON on the spot venue and stake it (LST earns staking yield).
///         Short leg: short the same USD notional on the hedge venue (earns funding when positive).
///         Net MON exposure ≈ 0; the vault's asset (USDC) value only moves with yield.
contract DeltaNeutralStrategy is IStrategy, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;
    using SafeCast for uint256;

    struct Config {
        uint16 hedgeCollateralBps; // share of each deployment parked as hedge collateral
        uint16 rebalanceThresholdBps; // |delta| tolerance before re-hedging
        uint16 maxSlippageBps; // default swap slippage
        uint16 liquidityBufferBps; // idle buffer kept for cheap withdrawals
        uint256 minAllocation; // do not deploy dust (asset units)
    }

    struct RebalanceParams {
        uint16 maxSlippageBps;
    }

    uint256 public constant BPS = 10_000;
    uint256 private constant WAD = 1e18;

    address public immutable vault;
    address public immutable asset;
    IERC20 public immutable wmon;
    IERC20 public immutable lst;
    uint8 private immutable _assetDecimals;

    ISpotVenue public spotVenue;
    IStakingVenue public stakingVenue;
    IHedgeVenue public hedgeVenue;
    IPriceOracle public oracle;
    Config public config;
    uint256 public lastRebalanceAt;

    event VenuesUpdated(address spot, address staking, address hedge, address oracle);
    event ConfigUpdated(Config config);

    error OnlyVault();
    error ZeroAddress();
    error InvalidBps();
    error VenuesNotSet();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address vault_, address asset_, address wmon_, address lst_, address admin) {
        if (
            vault_ == address(0) || asset_ == address(0) || wmon_ == address(0) || lst_ == address(0)
                || admin == address(0)
        ) revert ZeroAddress();
        vault = vault_;
        asset = asset_;
        wmon = IERC20(wmon_);
        lst = IERC20(lst_);
        uint8 dec = IERC20Metadata(asset_).decimals();
        _assetDecimals = dec;
        config = Config({
            hedgeCollateralBps: 5000,
            rebalanceThresholdBps: 200,
            maxSlippageBps: 50,
            liquidityBufferBps: 500,
            minAllocation: 100 * 10 ** dec
        });
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ───────────────────────────── admin ─────────────────────────────

    function setVenues(ISpotVenue spot_, IStakingVenue staking_, IHedgeVenue hedge_, IPriceOracle oracle_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (
            address(spot_) == address(0) || address(staking_) == address(0) || address(hedge_) == address(0)
                || address(oracle_) == address(0)
        ) revert ZeroAddress();
        spotVenue = spot_;
        stakingVenue = staking_;
        hedgeVenue = hedge_;
        oracle = oracle_;
        emit VenuesUpdated(address(spot_), address(staking_), address(hedge_), address(oracle_));
    }

    function setConfig(Config calldata c) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (
            c.hedgeCollateralBps > BPS || c.rebalanceThresholdBps > BPS || c.maxSlippageBps > BPS
                || c.liquidityBufferBps > BPS
        ) revert InvalidBps();
        config = c;
        emit ConfigUpdated(c);
    }

    // ───────────────────────────── views ─────────────────────────────

    function idleAssets() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /// @notice Value of LST + unstaked MON held, in asset units.
    function spotLegValue() public view returns (uint256) {
        if (address(oracle) == address(0)) return 0;
        return _valueInAsset(address(lst), lst.balanceOf(address(this)))
            + _valueInAsset(address(wmon), wmon.balanceOf(address(this)));
    }

    function hedgeLegEquity() public view returns (uint256) {
        return address(hedgeVenue) == address(0) ? 0 : hedgeVenue.equity();
    }

    function shortNotional() public view returns (uint256) {
        return address(hedgeVenue) == address(0) ? 0 : hedgeVenue.shortNotional();
    }

    function totalAssets() public view returns (uint256) {
        return idleAssets() + spotLegValue() + hedgeLegEquity();
    }

    function netDeltaBps() public view returns (int256) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        int256 longValue = spotLegValue().toInt256();
        int256 shortValue = shortNotional().toInt256();
        return (longValue - shortValue) * int256(BPS) / total.toInt256();
    }

    // ───────────────────────────── vault entry points ─────────────────────────────

    function deposit(uint256 assets) external onlyVault {
        // Assets already sit in this contract; allocation happens in rebalance() so deposits stay cheap.
        emit Deposited(assets);
    }

    function withdraw(uint256 assets, address receiver) external onlyVault nonReentrant returns (uint256 sent) {
        uint256 idle = idleAssets();
        if (idle < assets) {
            _unwind(assets - idle, config.maxSlippageBps);
            idle = idleAssets();
        }
        sent = assets < idle ? assets : idle;
        IERC20(asset).safeTransfer(receiver, sent);
        emit Withdrawn(assets, sent, receiver);
    }

    function rebalance(bytes calldata data) external onlyVault nonReentrant {
        _requireVenues();
        uint16 slippage = data.length == 0 ? config.maxSlippageBps : abi.decode(data, (RebalanceParams)).maxSlippageBps;
        int256 before = netDeltaBps();
        _allocateIdle(slippage);
        _hedgeToNeutral();
        lastRebalanceAt = block.timestamp;
        emit Rebalanced(before, netDeltaBps());
    }

    function emergencyExit() external onlyVault nonReentrant {
        if (address(hedgeVenue) != address(0)) _unwind(type(uint256).max, config.maxSlippageBps);
        uint256 balance = idleAssets();
        IERC20(asset).safeTransfer(vault, balance);
        emit EmergencyExited(balance);
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _requireVenues() internal view {
        if (
            address(spotVenue) == address(0) || address(stakingVenue) == address(0) || address(hedgeVenue) == address(0)
                || address(oracle) == address(0)
        ) revert VenuesNotSet();
    }

    /// @dev token amount → asset units via oracle (USD 1e18 per whole token).
    function _valueInAsset(address token, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 p = oracle.price(token);
        uint8 d = IERC20Metadata(token).decimals();
        return amount.mulDiv(p, 10 ** d).mulDiv(10 ** _assetDecimals, WAD);
    }

    /// @dev asset units → token amount via oracle.
    function _assetToToken(address token, uint256 assetAmount) internal view returns (uint256) {
        if (assetAmount == 0) return 0;
        uint256 p = oracle.price(token);
        uint8 d = IERC20Metadata(token).decimals();
        return assetAmount.mulDiv(WAD, 10 ** _assetDecimals).mulDiv(10 ** d, p);
    }

    function _minOut(uint256 expected, uint16 slippageBps) internal pure returns (uint256) {
        return expected.mulDiv(BPS - slippageBps, BPS);
    }

    function _allocateIdle(uint16 slippageBps) internal {
        uint256 total = totalAssets();
        uint256 buffer = total.mulDiv(config.liquidityBufferBps, BPS);
        uint256 idle = idleAssets();
        if (idle <= buffer) return;
        uint256 deployable = idle - buffer;
        if (deployable < config.minAllocation) return;

        uint256 hedgePart = deployable.mulDiv(config.hedgeCollateralBps, BPS);
        uint256 spotPart = deployable - hedgePart;

        if (spotPart > 0) {
            uint256 minMon = _minOut(_assetToToken(address(wmon), spotPart), slippageBps);
            IERC20(asset).forceApprove(address(spotVenue), spotPart);
            uint256 monOut = spotVenue.swapExactIn(asset, address(wmon), spotPart, minMon, address(this));
            wmon.forceApprove(address(stakingVenue), monOut);
            stakingVenue.stake(monOut);
        }

        if (hedgePart > 0) {
            address collateral = hedgeVenue.collateralToken();
            uint256 collateralAmount = hedgePart;
            if (collateral != asset) {
                uint256 minCol = _minOut(_assetToToken(collateral, hedgePart), slippageBps);
                IERC20(asset).forceApprove(address(spotVenue), hedgePart);
                collateralAmount = spotVenue.swapExactIn(asset, collateral, hedgePart, minCol, address(this));
            }
            IERC20(collateral).forceApprove(address(hedgeVenue), collateralAmount);
            hedgeVenue.depositCollateral(collateralAmount);
        }
    }

    function _hedgeToNeutral() internal {
        uint256 total = totalAssets();
        if (total == 0) return;
        uint256 longValue = spotLegValue();
        uint256 shortValue = shortNotional();
        uint256 tolerance = total.mulDiv(config.rebalanceThresholdBps, BPS);
        if (longValue > shortValue + tolerance) {
            hedgeVenue.adjustShort((longValue - shortValue).toInt256());
        } else if (shortValue > longValue + tolerance) {
            hedgeVenue.adjustShort(-((shortValue - longValue).toInt256()));
        }
    }

    /// @dev Unwinds a proportional slice of both legs so `needed` asset units become idle.
    ///      Slightly over-unwinds to absorb rounding and slippage; the surplus stays idle.
    function _unwind(uint256 needed, uint16 slippageBps) internal {
        uint256 deployed = spotLegValue() + hedgeLegEquity();
        if (deployed == 0) return;
        uint256 target = needed == type(uint256).max ? needed : needed.mulDiv(BPS + slippageBps + 10, BPS);
        uint256 fraction = target >= deployed ? WAD : target.mulDiv(WAD, deployed);

        // Hedge leg first: shrink the short, then free collateral.
        uint256 shortValue = shortNotional();
        if (shortValue > 0) hedgeVenue.adjustShort(-(shortValue.mulDiv(fraction, WAD).toInt256()));
        uint256 equity = hedgeLegEquity();
        if (equity > 0) {
            uint256 out = hedgeVenue.withdrawCollateral(equity.mulDiv(fraction, WAD), address(this));
            address collateral = hedgeVenue.collateralToken();
            if (collateral != asset && out > 0) {
                IERC20(collateral).forceApprove(address(spotVenue), out);
                // forge-lint: disable-next-item(unused-return)
                spotVenue.swapExactIn(
                    collateral, asset, out, _minOut(_valueInAsset(collateral, out), slippageBps), address(this)
                );
            }
        }

        // Spot leg: LST → MON → asset.
        uint256 lstToUnstake = lst.balanceOf(address(this)).mulDiv(fraction, WAD);
        if (lstToUnstake > 0) {
            lst.forceApprove(address(stakingVenue), lstToUnstake);
            stakingVenue.unstake(lstToUnstake);
        }
        uint256 monBalance = wmon.balanceOf(address(this));
        if (monBalance > 0) {
            wmon.forceApprove(address(spotVenue), monBalance);
            // forge-lint: disable-next-item(unused-return)
            spotVenue.swapExactIn(
                address(wmon),
                asset,
                monBalance,
                _minOut(_valueInAsset(address(wmon), monBalance), slippageBps),
                address(this)
            );
        }
    }
}
