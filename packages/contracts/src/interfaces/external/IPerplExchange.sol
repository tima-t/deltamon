// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Perpl's on-chain Exchange. Collateral custody and account setup only.
/// @dev Order entry does NOT exist on-chain. Orders are submitted over Perpl's signed WebSocket API
///      by a key the account has authorised, and the exchange forwards them once
///      `allowOrderForwarding(true)` has been called by the account owner. Perpl's documentation
///      states that withdrawals and transfers out are never permitted through an API key, so the
///      only way collateral leaves is `withdrawCollateral`, callable solely by this vault.
///      Selectors verified against the deployed implementation on Monad mainnet.
interface IPerplExchange {
    /// @dev 0xcab13915. Creates the exchange account with an initial collateral deposit.
    function createAccount(uint256 amountCNS) external;
    /// @dev 0xbad4a01f
    function depositCollateral(uint256 amount) external;
    /// @dev 0x6112fe2e
    function withdrawCollateral(uint256 amount) external;
    /// @dev 0x7962f910. Lets the exchange forward API-signed orders for this account.
    function allowOrderForwarding(bool allowed) external;
}
