// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A Curve-style StableSwap pool, addressed by coin index.
/// @dev This is how AUSD is actually reachable on Monad. Kuru's AUSD order books are empty, and its
///      own front end routes USDC/AUSD through a pool of this shape. Measured on a mainnet fork:
///      about 1.5M of depth, and a 1,000 USDC round trip costs roughly one basis point.
interface IStableSwap {
    function coins(uint256 i) external view returns (address);
    function balances(uint256 i) external view returns (uint256);
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
    function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external returns (uint256);
}
