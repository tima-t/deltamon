// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISpotVenue} from "../../src/interfaces/ISpotVenue.sol";
import {IStakingVenue} from "../../src/interfaces/IStakingVenue.sol";
import {IHedgeVenue} from "../../src/interfaces/IHedgeVenue.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockOracle} from "./MockOracle.sol";

/// @dev Swaps at oracle price minus `feeBps`; mints output tokens.
contract MockSpotVenue is ISpotVenue {
    using SafeERC20 for IERC20;
    using Math for uint256;

    MockOracle public immutable oracle;
    uint256 public feeBps;

    constructor(MockOracle oracle_) {
        oracle = oracle_;
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address to)
        external
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 usd = amountIn.mulDiv(oracle.price(tokenIn), 10 ** IERC20Metadata(tokenIn).decimals());
        amountOut = usd.mulDiv(10 ** IERC20Metadata(tokenOut).decimals(), oracle.price(tokenOut));
        amountOut = amountOut.mulDiv(10_000 - feeBps, 10_000);
        require(amountOut >= minAmountOut, "MockSpotVenue: slippage");
        MockERC20(tokenOut).mint(to, amountOut);
    }
}

/// @dev 1 LST = `rate` / 1e18 staking tokens. Synchronous unstake.
contract MockStakingVenue is IStakingVenue {
    using SafeERC20 for IERC20;
    using Math for uint256;

    MockERC20 public immutable staking;
    MockERC20 public immutable liquid;
    uint256 public rate = 1e18;

    constructor(MockERC20 staking_, MockERC20 liquid_) {
        staking = staking_;
        liquid = liquid_;
    }

    function setRate(uint256 r) external {
        rate = r;
    }

    function stakingToken() external view returns (address) {
        return address(staking);
    }

    function liquidToken() external view returns (address) {
        return address(liquid);
    }

    function stake(uint256 amount) external returns (uint256 liquidOut) {
        IERC20(address(staking)).safeTransferFrom(msg.sender, address(this), amount);
        liquidOut = amount.mulDiv(1e18, rate);
        liquid.mint(msg.sender, liquidOut);
    }

    function unstake(uint256 liquidAmount) external returns (uint256 stakingOut) {
        IERC20(address(liquid)).safeTransferFrom(msg.sender, address(this), liquidAmount);
        liquid.burn(address(this), liquidAmount);
        stakingOut = liquidAmount.mulDiv(rate, 1e18);
        staking.mint(msg.sender, stakingOut);
    }

    function exchangeRate() external view returns (uint256) {
        return rate;
    }
}

/// @dev Tracks collateral and short size. `applyPnl` moves collateral to simulate mark-to-market.
contract MockHedgeVenue is IHedgeVenue {
    using SafeERC20 for IERC20;

    MockERC20 public immutable collateral;
    uint256 public collateralBalance;
    uint256 public short;
    int256 public lastAdjust;

    constructor(MockERC20 collateral_) {
        collateral = collateral_;
    }

    function collateralToken() external view returns (address) {
        return address(collateral);
    }

    function depositCollateral(uint256 amount) external {
        IERC20(address(collateral)).safeTransferFrom(msg.sender, address(this), amount);
        collateralBalance += amount;
    }

    function withdrawCollateral(uint256 amount, address to) external returns (uint256 withdrawn) {
        withdrawn = amount < collateralBalance ? amount : collateralBalance;
        collateralBalance -= withdrawn;
        IERC20(address(collateral)).safeTransfer(to, withdrawn);
    }

    function adjustShort(int256 notionalDelta) external {
        lastAdjust = notionalDelta;
        if (notionalDelta >= 0) {
            short += uint256(notionalDelta);
        } else {
            uint256 reduce = uint256(-notionalDelta);
            short = reduce >= short ? 0 : short - reduce;
        }
    }

    function applyPnl(int256 pnl) external {
        if (pnl >= 0) {
            collateral.mint(address(this), uint256(pnl));
            collateralBalance += uint256(pnl);
        } else {
            uint256 loss = uint256(-pnl);
            require(loss <= collateralBalance, "MockHedgeVenue: liquidated");
            collateral.burn(address(this), loss);
            collateralBalance -= loss;
        }
    }

    function shortNotional() external view returns (uint256) {
        return short;
    }

    function equity() external view returns (uint256) {
        return collateralBalance;
    }
}
