// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISpotVenue} from "../interfaces/ISpotVenue.sol";
import {IKuruRouter} from "../interfaces/external/IKuruRouter.sol";
import {IKuruOrderBook} from "../interfaces/external/IKuruOrderBook.sol";
import {IWMON} from "../interfaces/external/IWMON.sol";

/// @title KuruSpotAdapter
/// @notice Executes spot swaps through Kuru's on-chain CLOB router (`anyToAnySwap`).
/// @dev Kuru markets quote native MON as address(0). Callers always deal in WMON: the adapter
///      unwraps before selling MON and wraps whatever native MON the router pays out.
///      Routes are registered per (tokenIn, tokenOut) as an ordered list of markets; buy/sell
///      direction and native flags are derived from each market's params, so a mis-registered
///      route reverts instead of trading the wrong way.
contract KuruSpotAdapter is ISpotVenue, Ownable {
    using SafeERC20 for IERC20;

    address public constant NATIVE = address(0);

    IKuruRouter public immutable router;
    IWMON public immutable wmon;

    mapping(bytes32 => address[]) private _routes;

    event RouteSet(address indexed tokenIn, address indexed tokenOut, address[] markets);
    event Swapped(
        address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address indexed to
    );

    error ZeroAddress();
    error EmptyRoute();
    error RouteNotSet(address tokenIn, address tokenOut);
    error RouteMismatch(address market, address token);
    error RouteEndsAtWrongToken(address expected, address actual);
    error InsufficientOutput(uint256 received, uint256 minimum);

    constructor(address router_, address wmon_, address owner_) Ownable(owner_) {
        if (router_ == address(0) || wmon_ == address(0)) revert ZeroAddress();
        router = IKuruRouter(router_);
        wmon = IWMON(wmon_);
    }

    // ───────────────────────────── routes ─────────────────────────────

    function routeKey(address tokenIn, address tokenOut) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut));
    }

    /// @notice Register the markets to hop through for tokenIn → tokenOut. Use the WMON address for MON.
    function setRoute(address tokenIn, address tokenOut, address[] calldata markets) external onlyOwner {
        if (markets.length == 0) revert EmptyRoute();
        (,, address endToken) = _plan(_kuruToken(tokenIn), markets);
        address expected = _kuruToken(tokenOut);
        if (endToken != expected) revert RouteEndsAtWrongToken(expected, endToken);
        _routes[routeKey(tokenIn, tokenOut)] = markets;
        emit RouteSet(tokenIn, tokenOut, markets);
    }

    function getRoute(address tokenIn, address tokenOut) external view returns (address[] memory) {
        return _routes[routeKey(tokenIn, tokenOut)];
    }

    /// @notice The exact router call a swap would make, for off-chain inspection.
    function previewPlan(address tokenIn, address tokenOut)
        external
        view
        returns (address[] memory markets, bool[] memory isBuy, bool[] memory nativeSend)
    {
        markets = _routes[routeKey(tokenIn, tokenOut)];
        if (markets.length == 0) revert RouteNotSet(tokenIn, tokenOut);
        (isBuy, nativeSend,) = _plan(_kuruToken(tokenIn), markets);
    }

    // ───────────────────────────── swap ─────────────────────────────

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address to)
        external
        returns (uint256 amountOut)
    {
        address[] memory markets = _routes[routeKey(tokenIn, tokenOut)];
        if (markets.length == 0) revert RouteNotSet(tokenIn, tokenOut);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = _execute(markets, _kuruToken(tokenIn), _kuruToken(tokenOut), amountIn, minAmountOut);
        if (tokenOut == address(wmon)) wmon.deposit{value: amountOut}();
        IERC20(tokenOut).safeTransfer(to, amountOut);

        emit Swapped(tokenIn, tokenOut, amountIn, amountOut, to);
    }

    // ───────────────────────────── internals ─────────────────────────────

    /// @dev Unwraps or approves the debit side, calls the router, measures what was credited.
    function _execute(address[] memory markets, address debit, address credit, uint256 amountIn, uint256 minAmountOut)
        internal
        returns (uint256 amountOut)
    {
        (bool[] memory isBuy, bool[] memory nativeSend, address endToken) = _plan(debit, markets);
        if (endToken != credit) revert RouteEndsAtWrongToken(credit, endToken);

        uint256 value;
        if (debit == NATIVE) {
            wmon.withdraw(amountIn);
            value = amountIn;
        } else {
            IERC20(debit).forceApprove(address(router), amountIn);
        }

        uint256 before = _balance(credit);
        router.anyToAnySwap{value: value}(markets, isBuy, nativeSend, debit, credit, amountIn, minAmountOut);
        amountOut = _balance(credit) - before;
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);
    }

    function _kuruToken(address token) internal view returns (address) {
        return token == address(wmon) ? NATIVE : token;
    }

    function _balance(address kuruToken) internal view returns (uint256) {
        return kuruToken == NATIVE ? address(this).balance : IERC20(kuruToken).balanceOf(address(this));
    }

    /// @dev Walks the markets from `startToken`, deriving direction and native flags per hop.
    function _plan(address startToken, address[] memory markets)
        internal
        view
        returns (bool[] memory isBuy, bool[] memory nativeSend, address current)
    {
        uint256 n = markets.length;
        isBuy = new bool[](n);
        nativeSend = new bool[](n);
        current = startToken;
        for (uint256 i = 0; i < n; i++) {
            (,, address base,, address quote,,,,,,) = IKuruOrderBook(markets[i]).getMarketParams();
            nativeSend[i] = current == NATIVE;
            if (current == quote) {
                isBuy[i] = true; // spend quote, receive base
                current = base;
            } else if (current == base) {
                isBuy[i] = false; // sell base, receive quote
                current = quote;
            } else {
                revert RouteMismatch(markets[i], current);
            }
        }
    }

    receive() external payable {}
}
