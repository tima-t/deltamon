// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Spot swap venue (Kuru CLOB, Uniswap, …).
interface ISpotVenue {
    /// @dev Pulls `amountIn` of `tokenIn` from msg.sender (caller approves first) and sends output to `to`.
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address to)
        external
        returns (uint256 amountOut);
}
