// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPriceOracle {
    /// @notice USD price of one whole token, scaled to 1e18. Reverts when stale or unset.
    function price(address token) external view returns (uint256);
}
