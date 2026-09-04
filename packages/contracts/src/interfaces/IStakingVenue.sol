// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Liquid staking venue (aPriori aprMON, Kintsu sMON, Magma gMON).
interface IStakingVenue {
    function stakingToken() external view returns (address);
    function liquidToken() external view returns (address);

    /// @dev Pulls `amount` of stakingToken from msg.sender; liquid tokens are sent to msg.sender.
    function stake(uint256 amount) external returns (uint256 liquidOut);

    /// @dev Pulls `liquidAmount` from msg.sender. Returns staking tokens sent back now; 0 if redemption is async.
    function unstake(uint256 liquidAmount) external returns (uint256 stakingOut);

    /// @notice Staking tokens per 1e18 liquid tokens.
    function exchangeRate() external view returns (uint256);
}
