// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISpotVenue} from "../../src/interfaces/ISpotVenue.sol";
import {MockOracle} from "./MockOracle.sol";

/// @dev Swaps at the oracle price minus a fee, paying out of its own pre-funded inventory.
///      Works with a real WETH9-style wrapped MON, unlike a mint-based mock.
contract MockDeskVenue is ISpotVenue {
    using SafeERC20 for IERC20;
    using Math for uint256;

    MockOracle public immutable oracle;
    uint256 public feeBps;

    constructor(MockOracle oracle_) {
        oracle = oracle_;
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address to)
        external
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 usd = amountIn.mulDiv(oracle.price(tokenIn), 10 ** IERC20Metadata(tokenIn).decimals());
        amountOut = usd.mulDiv(10 ** IERC20Metadata(tokenOut).decimals(), oracle.price(tokenOut));
        amountOut = amountOut.mulDiv(10_000 - feeBps, 10_000);
        require(amountOut >= minAmountOut, "MockDeskVenue: slippage");
        IERC20(tokenOut).safeTransfer(to, amountOut);
    }
}

/// @dev Stands in for Monad's staking precompile. Etch this at 0x...1000, then use the setters.
contract MockStakingPrecompile {
    mapping(uint64 => uint256) public commissionOf;
    mapping(address => mapping(uint64 => uint256)) public stakeOf;
    mapping(address => mapping(uint64 => uint256)) public rewardOf;
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public pendingAmount;
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public pendingReadyAt;

    uint256 public constant UNBONDING = 6 hours;

    function setCommission(uint64 validatorId, uint256 commission) external {
        commissionOf[validatorId] = commission;
    }

    function setReward(address delegator, uint64 validatorId, uint256 amount) external {
        rewardOf[delegator][validatorId] = amount;
    }

    function delegate(uint64 validatorId) external payable returns (bool) {
        stakeOf[msg.sender][validatorId] += msg.value;
        return true;
    }

    function undelegate(uint64 validatorId, uint256 amount, uint8 withdrawId) external returns (bool) {
        require(stakeOf[msg.sender][validatorId] >= amount, "MockStaking: stake");
        require(pendingAmount[msg.sender][validatorId][withdrawId] == 0, "MockStaking: slot");
        stakeOf[msg.sender][validatorId] -= amount;
        pendingAmount[msg.sender][validatorId][withdrawId] = amount;
        pendingReadyAt[msg.sender][validatorId][withdrawId] = block.timestamp + UNBONDING;
        return true;
    }

    function withdraw(uint64 validatorId, uint8 withdrawId) external returns (bool) {
        uint256 amount = pendingAmount[msg.sender][validatorId][withdrawId];
        require(amount > 0, "MockStaking: nothing");
        require(block.timestamp >= pendingReadyAt[msg.sender][validatorId][withdrawId], "MockStaking: unbonding");
        delete pendingAmount[msg.sender][validatorId][withdrawId];
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "MockStaking: send");
        return true;
    }

    function claimRewards(uint64 validatorId) external returns (bool) {
        uint256 amount = rewardOf[msg.sender][validatorId];
        rewardOf[msg.sender][validatorId] = 0;
        if (amount > 0) {
            (bool ok,) = msg.sender.call{value: amount}("");
            require(ok, "MockStaking: send");
        }
        return true;
    }

    function getValidator(uint64 validatorId)
        external
        view
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
        )
    {
        return (address(0), 0, 0, 0, commissionOf[validatorId], 0, 0, 0, 0, 0, "", "");
    }

    receive() external payable {}
}

/// @dev Stands in for Perpl's Exchange: collateral custody only, no on-chain order entry.
contract MockPerplExchange {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateralToken;
    mapping(address => uint256) public collateralOf;
    mapping(address => bool) public accountOpen;
    mapping(address => bool) public orderForwarding;

    constructor(IERC20 collateralToken_) {
        collateralToken = collateralToken_;
    }

    function createAccount(uint256 amountCNS) external {
        require(!accountOpen[msg.sender], "MockPerpl: open");
        accountOpen[msg.sender] = true;
        collateralToken.safeTransferFrom(msg.sender, address(this), amountCNS);
        collateralOf[msg.sender] += amountCNS;
    }

    function depositCollateral(uint256 amount) external {
        require(accountOpen[msg.sender], "MockPerpl: no account");
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        collateralOf[msg.sender] += amount;
    }

    function withdrawCollateral(uint256 amount) external {
        require(collateralOf[msg.sender] >= amount, "MockPerpl: collateral");
        collateralOf[msg.sender] -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
    }

    function allowOrderForwarding(bool allowed) external {
        orderForwarding[msg.sender] = allowed;
    }
}
