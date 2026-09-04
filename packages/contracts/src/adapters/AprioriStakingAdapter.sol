// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStakingVenue} from "../interfaces/IStakingVenue.sol";
import {IWMON} from "../interfaces/external/IWMON.sol";
import {IAprMON} from "../interfaces/external/IAprMON.sol";

/// @title AprioriStakingAdapter
/// @notice Stakes MON into aPriori (aprMON). Unstaking is asynchronous on aPriori, so `unstake`
///         files a redeem request and returns 0; the keeper claims matured requests later.
/// @dev TODO(verify): aprMON deposit / requestRedeem signatures — see IAprMON.sol.
contract AprioriStakingAdapter is IStakingVenue {
    using SafeERC20 for IERC20;

    IWMON public immutable wmon;
    IAprMON public immutable aprMon;

    event RedeemRequested(uint256 shares, uint256 requestId, address indexed owner);

    constructor(address wmon_, address aprMon_) {
        wmon = IWMON(wmon_);
        aprMon = IAprMON(aprMon_);
    }

    function stakingToken() external view returns (address) {
        return address(wmon);
    }

    function liquidToken() external view returns (address) {
        return address(aprMon);
    }

    function stake(uint256 amount) external returns (uint256 liquidOut) {
        IERC20(address(wmon)).safeTransferFrom(msg.sender, address(this), amount);
        wmon.withdraw(amount);
        liquidOut = aprMon.deposit{value: amount}(amount, msg.sender);
    }

    function unstake(uint256 liquidAmount) external returns (uint256) {
        IERC20(address(aprMon)).safeTransferFrom(msg.sender, address(this), liquidAmount);
        uint256 requestId = aprMon.requestRedeem(liquidAmount, address(this), address(this));
        emit RedeemRequested(liquidAmount, requestId, msg.sender);
        return 0; // async: claimed by the keeper once the unbonding period passes
    }

    function exchangeRate() external view returns (uint256) {
        return aprMon.convertToAssets(1e18);
    }

    receive() external payable {}
}
