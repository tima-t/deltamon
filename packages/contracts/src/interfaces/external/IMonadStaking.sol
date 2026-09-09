// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Monad's native staking precompile at 0x...1000.
/// @dev Amounts are in native MON wei. The view-style functions are declared non-view by the
///      precompile, so they cannot be called from a Solidity `view` function.
///      Reference: https://docs.monad.xyz/developer-essentials/staking/staking-precompile
interface IMonadStaking {
    function delegate(uint64 validatorId) external payable returns (bool success);
    function undelegate(uint64 validatorId, uint256 amount, uint8 withdrawId) external returns (bool success);
    function withdraw(uint64 validatorId, uint8 withdrawId) external returns (bool success);
    function claimRewards(uint64 validatorId) external returns (bool success);

    function getValidator(uint64 validatorId)
        external
        returns (
            address authAddress,
            uint64 flags,
            uint256 stake,
            uint256 accRewardPerToken,
            uint256 commission,
            uint256 unclaimedRewards,
            uint256 consensusStake,
            uint256 consensusCommission,
            uint256 snapshotStake,
            uint256 snapshotCommission,
            bytes memory secpPubkey,
            bytes memory blsPubkey
        );

    function getDelegator(uint64 validatorId, address delegator)
        external
        returns (
            uint256 stake,
            uint256 accRewardPerToken,
            uint256 unclaimedRewards,
            uint256 deltaStake,
            uint256 nextDeltaStake,
            uint64 deltaEpoch,
            uint64 nextDeltaEpoch
        );

    function getEpoch() external returns (uint64 epoch, bool inEpochDelayPeriod);
}
