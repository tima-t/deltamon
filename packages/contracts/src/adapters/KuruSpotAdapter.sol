// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISpotVenue} from "../interfaces/ISpotVenue.sol";
import {IKuruRouter} from "../interfaces/external/IKuruRouter.sol";

/// @title KuruSpotAdapter
/// @notice Routes spot swaps through Kuru's on-chain CLOB router (`anyToAnySwap`).
/// @dev Routes are pre-registered per (tokenIn, tokenOut) so the strategy never takes untrusted paths.
///      TODO(kuru): if a market's base asset is native MON rather than WMON, wrap/unwrap around the swap
///      and set `nativeSend` accordingly (see https://docs.kuru.io/contracts/Router).
contract KuruSpotAdapter is ISpotVenue, Ownable {
    using SafeERC20 for IERC20;

    struct Route {
        address[] markets;
        bool[] isBuy;
    }

    IKuruRouter public immutable router;
    mapping(bytes32 => Route) private _routes;

    event RouteSet(address indexed tokenIn, address indexed tokenOut, address[] markets, bool[] isBuy);

    error RouteNotSet(address tokenIn, address tokenOut);
    error LengthMismatch();
    error InsufficientOutput(uint256 received, uint256 minimum);

    constructor(address router_, address owner_) Ownable(owner_) {
        router = IKuruRouter(router_);
    }

    function routeKey(address tokenIn, address tokenOut) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut));
    }

    function setRoute(address tokenIn, address tokenOut, address[] calldata markets, bool[] calldata isBuy)
        external
        onlyOwner
    {
        if (markets.length == 0 || markets.length != isBuy.length) revert LengthMismatch();
        _routes[routeKey(tokenIn, tokenOut)] = Route({markets: markets, isBuy: isBuy});
        emit RouteSet(tokenIn, tokenOut, markets, isBuy);
    }

    function getRoute(address tokenIn, address tokenOut) external view returns (address[] memory, bool[] memory) {
        Route storage r = _routes[routeKey(tokenIn, tokenOut)];
        return (r.markets, r.isBuy);
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address to)
        external
        returns (uint256 amountOut)
    {
        Route storage r = _routes[routeKey(tokenIn, tokenOut)];
        if (r.markets.length == 0) revert RouteNotSet(tokenIn, tokenOut);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);

        bool[] memory nativeSend = new bool[](r.markets.length);
        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        router.anyToAnySwap(r.markets, r.isBuy, nativeSend, tokenIn, tokenOut, amountIn, minAmountOut);
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);

        IERC20(tokenOut).safeTransfer(to, amountOut);
    }
}
