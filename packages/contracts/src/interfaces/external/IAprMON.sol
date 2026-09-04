// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice aPriori liquid staking token. ERC-4626-style deposit with native MON and ERC-7540-style async redeem.
/// @dev TODO(verify): confirm signatures against https://apriori-docs.gitbook.io/apriori-docs/ before mainnet use.
interface IAprMON is IERC20 {
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256 requestId);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
}
