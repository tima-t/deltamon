// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {DeltaVault} from "../src/DeltaVault.sol";
import {IStrategy} from "../src/interfaces/IStrategy.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockStrategy} from "./mocks/MockStrategy.sol";

contract DeltaVaultTest is Test {
    MockERC20 usdc;
    DeltaVault vault;
    MockStrategy strategy;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address fees = makeAddr("fees");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant CAP = 10_000_000e6;
    uint256 constant FEE_BPS = 1000; // 10 %

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new DeltaVault(usdc, "DeltaMon USDC Vault", "dmUSDC", admin, fees, CAP, FEE_BPS);
        strategy = new MockStrategy(address(vault), address(usdc));

        vm.startPrank(admin);
        vault.setStrategy(strategy);
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        vm.stopPrank();

        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        shares = vault.deposit(amount, who);
    }

    function test_depositMintsSharesOneToOne() public {
        uint256 shares = _deposit(alice, 100e6);
        assertEq(shares, 100e6);
        assertEq(vault.totalAssets(), 100e6);
        assertEq(vault.pricePerShare(), 1e18);
    }

    function test_withdrawFromIdle() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vault.withdraw(40e6, alice, alice);
        assertEq(usdc.balanceOf(alice), 1_000_000e6 - 60e6);
        assertEq(vault.balanceOf(alice), 60e6);
    }

    function test_investMovesAssetsToStrategy() public {
        _deposit(alice, 1000e6);
        vm.prank(keeper);
        vault.invest(800e6);
        assertEq(strategy.totalAssets(), 800e6);
        assertEq(vault.idleAssets(), 200e6);
        assertEq(vault.totalAssets(), 1000e6);
    }

    function test_withdrawPullsFromStrategy() public {
        _deposit(alice, 1000e6);
        vm.prank(keeper);
        vault.invest(900e6);

        vm.prank(alice);
        vault.withdraw(500e6, alice, alice);

        assertEq(usdc.balanceOf(alice), 1_000_000e6 - 500e6);
        assertEq(vault.totalAssets(), 500e6);
        assertEq(strategy.totalAssets(), 500e6);
    }

    function test_redeemAllCapturesYield() public {
        _deposit(alice, 1000e6);
        vm.prank(keeper);
        vault.invest(1000e6);
        usdc.mint(address(strategy), 100e6); // yield

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        // ERC-4626 virtual-share rounding keeps at most 1 unit in the vault.
        assertApproxEqAbs(usdc.balanceOf(alice), 1_000_000e6 + 100e6, 1);
    }

    function test_harvestMintsPerformanceFee() public {
        _deposit(alice, 1000e6);
        vm.prank(keeper);
        vault.invest(1000e6);
        usdc.mint(address(strategy), 100e6);

        vm.prank(keeper);
        uint256 feeShares = vault.harvest();
        assertGt(feeShares, 0);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(fees)), 10e6, 2);
        // Alice keeps the other 90 %.
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(alice)), 1090e6, 2);

        // Nothing new to charge.
        vm.prank(keeper);
        assertEq(vault.harvest(), 0);
    }

    function test_harvestRespectsHighWaterMark() public {
        _deposit(alice, 1000e6);
        vm.prank(keeper);
        vault.invest(1000e6);
        usdc.mint(address(strategy), 100e6);
        vm.prank(keeper);
        vault.harvest();
        uint256 hwm = vault.highWaterMark();

        usdc.burn(address(strategy), 50e6); // drawdown
        vm.prank(keeper);
        assertEq(vault.harvest(), 0);
        assertEq(vault.highWaterMark(), hwm);

        usdc.mint(address(strategy), 30e6); // partial recovery, still under HWM
        vm.prank(keeper);
        assertEq(vault.harvest(), 0);
    }

    function test_depositCapEnforced() public {
        vm.prank(admin);
        vault.setDepositCap(500e6);
        vm.prank(alice);
        vm.expectPartialRevert(ERC4626.ERC4626ExceededMaxDeposit.selector);
        vault.deposit(600e6, alice);
    }

    function test_pauseBlocksDepositsButAllowsWithdrawals() public {
        _deposit(alice, 100e6);
        vm.prank(admin);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(1e6, alice);

        vm.prank(alice);
        vault.withdraw(50e6, alice, alice);
        assertEq(vault.balanceOf(alice), 50e6);
    }

    function test_strategyMigrationIsTimelocked() public {
        _deposit(alice, 1000e6);
        vm.prank(keeper);
        vault.invest(1000e6);

        MockStrategy next = new MockStrategy(address(vault), address(usdc));
        vm.startPrank(admin);
        vault.proposeStrategy(next);
        vm.expectPartialRevert(DeltaVault.TimelockActive.selector);
        vault.activateStrategy();

        vm.warp(block.timestamp + 1 days);
        vault.activateStrategy();
        vm.stopPrank();

        assertEq(address(vault.strategy()), address(next));
        assertEq(strategy.totalAssets(), 0);
        assertEq(vault.idleAssets(), 1000e6);
    }

    function test_rejectsStrategyForAnotherVault() public {
        MockStrategy foreign = new MockStrategy(address(0xdead), address(usdc));
        vm.prank(admin);
        vm.expectRevert(DeltaVault.InvalidStrategy.selector);
        vault.proposeStrategy(foreign);
    }

    function test_onlyKeeperCanInvest() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectPartialRevert(IAccessControl.AccessControlUnauthorizedAccount.selector);
        vault.invest(100e6);
    }

    function test_emergencyExitPullsFundsAndPauses() public {
        _deposit(alice, 1000e6);
        vm.prank(keeper);
        vault.invest(1000e6);

        vm.prank(admin);
        vault.emergencyExit();

        assertTrue(vault.paused());
        assertEq(vault.idleAssets(), 1000e6);
        assertEq(strategy.totalAssets(), 0);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertEq(usdc.balanceOf(alice), 1_000_000e6);
    }

    function test_feeCapEnforced() public {
        vm.prank(admin);
        vm.expectRevert(DeltaVault.FeeTooHigh.selector);
        vault.setPerformanceFee(3001);
    }

    function testFuzz_depositWithdrawRoundTrip(uint96 amount) public {
        amount = uint96(bound(uint256(amount), 1, 1_000_000e6));
        _deposit(alice, amount);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertEq(usdc.balanceOf(alice), 1_000_000e6);
    }

    function testFuzz_sharesTrackProRata(uint96 a, uint96 b, uint96 yield) public {
        a = uint96(bound(uint256(a), 1e6, 500_000e6));
        b = uint96(bound(uint256(b), 1e6, 500_000e6));
        yield = uint96(bound(uint256(yield), 0, 100_000e6));

        _deposit(alice, a);
        _deposit(bob, b);
        uint256 idle = vault.idleAssets();
        vm.prank(keeper);
        vault.invest(idle);
        usdc.mint(address(strategy), yield);

        uint256 aliceValue = vault.convertToAssets(vault.balanceOf(alice));
        uint256 bobValue = vault.convertToAssets(vault.balanceOf(bob));
        // Each depositor's claim grows by the same ratio.
        assertApproxEqRel(aliceValue * uint256(b), bobValue * uint256(a), 1e12);
    }
}
