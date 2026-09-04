// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A strategy owns the capital the vault allocates to it and reports its value in vault-asset units.
interface IStrategy {
    event Deposited(uint256 assets);
    event Withdrawn(uint256 requested, uint256 sent, address indexed receiver);
    event Rebalanced(int256 netDeltaBpsBefore, int256 netDeltaBpsAfter);
    event EmergencyExited(uint256 assetsReturned);

    function vault() external view returns (address);
    function asset() external view returns (address);

    /// @notice Total value managed, in `asset` units (idle + spot leg + hedge equity).
    function totalAssets() external view returns (uint256);

    /// @notice (long − short) / totalAssets in basis points. 0 is perfectly neutral.
    function netDeltaBps() external view returns (int256);

    /// @notice Called by the vault after it transferred `assets` to the strategy.
    function deposit(uint256 assets) external;

    /// @notice Sends up to `assets` back to `receiver`, unwinding positions if needed.
    function withdraw(uint256 assets, address receiver) external returns (uint256 sent);

    /// @notice Deploys idle capital and re-hedges to neutral. Keeper-triggered through the vault.
    function rebalance(bytes calldata data) external;

    /// @notice Closes every position and returns all assets to the vault.
    function emergencyExit() external;
}
