// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "../../src/interfaces/IStrategy.sol";

/// @dev Holds assets 1:1; yield is simulated by minting/burning the asset on this contract.
contract MockStrategy is IStrategy {
    using SafeERC20 for IERC20;

    address public immutable vault;
    address public immutable asset;
    int256 public delta;
    uint256 public rebalances;

    error OnlyVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address vault_, address asset_) {
        vault = vault_;
        asset = asset_;
    }

    function setDelta(int256 d) external {
        delta = d;
    }

    function totalAssets() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function netDeltaBps() external view returns (int256) {
        return delta;
    }

    function deposit(uint256 assets) external onlyVault {
        emit Deposited(assets);
    }

    function withdraw(uint256 assets, address receiver) external onlyVault returns (uint256 sent) {
        uint256 bal = IERC20(asset).balanceOf(address(this));
        sent = assets < bal ? assets : bal;
        IERC20(asset).safeTransfer(receiver, sent);
        emit Withdrawn(assets, sent, receiver);
    }

    function rebalance(bytes calldata) external onlyVault {
        rebalances++;
        emit Rebalanced(delta, delta);
    }

    function emergencyExit() external onlyVault {
        uint256 bal = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransfer(vault, bal);
        emit EmergencyExited(bal);
    }
}
