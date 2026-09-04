// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Kuru Router (https://docs.kuru.io/contracts/Router). Only the swap entrypoint is needed here.
interface IKuruRouter {
    function anyToAnySwap(
        address[] calldata marketAddresses,
        bool[] calldata isBuy,
        bool[] calldata nativeSend,
        address debitToken,
        address creditToken,
        uint256 amount,
        uint256 minAmountOut
    ) external payable returns (uint256 amountOut);
}
