// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStableSwap} from "../../src/interfaces/external/IStableSwap.sol";

/// @dev Stands in for the Curve-style AUSD/USDC pool: two coins of equal decimals, a flat fee, and
///      inventory of its own to pay out of. Indices matter, so `coins` is what the adapter checks.
contract MockStablePool is IStableSwap {
    using SafeERC20 for IERC20;

    address[2] private _coins;
    uint256 public feeBps;

    constructor(address coin0, address coin1) {
        _coins = [coin0, coin1];
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function coins(uint256 i) external view returns (address) {
        return _coins[i];
    }

    function balances(uint256 i) external view returns (uint256) {
        return IERC20(_coins[i]).balanceOf(address(this));
    }

    function get_dy(int128, int128, uint256 dx) public view returns (uint256) {
        return dx - (dx * feeBps) / 10_000;
    }

    function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external returns (uint256 dy) {
        dy = get_dy(i, j, dx);
        require(dy >= minDy, "MockStablePool: slippage");
        IERC20(_coins[uint256(uint128(i))]).safeTransferFrom(msg.sender, address(this), dx);
        IERC20(_coins[uint256(uint128(j))]).safeTransfer(msg.sender, dy);
    }
}
