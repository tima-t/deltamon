// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeltaVault} from "../src/DeltaVault.sol";
import {DeltaNeutralStrategy} from "../src/strategies/DeltaNeutralStrategy.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {MockSpotVenue, MockStakingVenue, MockHedgeVenue} from "./mocks/MockVenues.sol";

contract DeltaNeutralStrategyTest is Test {
    MockERC20 usdc;
    MockERC20 wmon;
    MockERC20 lst;
    MockOracle oracle;
    MockSpotVenue spot;
    MockStakingVenue staking;
    MockHedgeVenue hedge;
    DeltaVault vault;
    DeltaNeutralStrategy strategy;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address fees = makeAddr("fees");
    address alice = makeAddr("alice");

    uint256 constant DEPOSIT = 1_000_000e6;
    uint256 constant MON_PRICE = 2e18;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        wmon = new MockERC20("Wrapped MON", "WMON", 18);
        lst = new MockERC20("aPriori MON", "aprMON", 18);

        oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(wmon), MON_PRICE);
        oracle.setPrice(address(lst), MON_PRICE);

        spot = new MockSpotVenue(oracle);
        staking = new MockStakingVenue(wmon, lst);
        hedge = new MockHedgeVenue(usdc);

        vault = new DeltaVault(usdc, "DeltaMon USDC Vault", "dmUSDC", admin, fees, 10_000_000e6, 1000);
        strategy = new DeltaNeutralStrategy(address(vault), address(usdc), address(wmon), address(lst), admin);

        vm.startPrank(admin);
        strategy.setVenues(spot, staking, hedge, oracle);
        vault.setStrategy(strategy);
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        vm.stopPrank();

        usdc.mint(alice, DEPOSIT);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(DEPOSIT, alice);
        vm.stopPrank();

        vm.prank(keeper);
        vault.invest(DEPOSIT);
    }

    function _rebalance() internal {
        vm.prank(keeper);
        vault.rebalance("");
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return x < 0 ? uint256(-x) : uint256(x);
    }

    function test_rebalanceDeploysAndHedges() public {
        assertEq(strategy.netDeltaBps(), 0);
        _rebalance();

        // 5 % buffer stays idle, the rest splits 50/50 between the legs.
        assertApproxEqRel(strategy.idleAssets(), 50_000e6, 1e15);
        assertApproxEqRel(strategy.spotLegValue(), 475_000e6, 1e15);
        assertApproxEqRel(hedge.shortNotional(), strategy.spotLegValue(), 1e15);
        assertApproxEqRel(strategy.totalAssets(), DEPOSIT, 1e15);
        assertLe(_abs(strategy.netDeltaBps()), 200);
        assertEq(vault.totalAssets(), strategy.totalAssets());
    }

    function test_priceMoveLeavesValueFlatAndRehedges() public {
        _rebalance();
        uint256 shortBefore = hedge.shortNotional();

        // MON +50 %: long leg gains, short leg loses the same notional.
        oracle.setPrice(address(wmon), 3e18);
        oracle.setPrice(address(lst), 3e18);
        hedge.applyPnl(-int256(shortBefore / 2));

        assertApproxEqRel(strategy.totalAssets(), DEPOSIT, 1e15);
        assertGt(strategy.netDeltaBps(), 2000); // long is now much bigger than the short

        _rebalance();
        assertLe(_abs(strategy.netDeltaBps()), 200);
        assertApproxEqRel(hedge.shortNotional(), strategy.spotLegValue(), 1e15);
    }

    function test_stakingYieldAccruesToVault() public {
        _rebalance();
        // LST appreciates 10 % vs MON (staking rewards).
        staking.setRate(1.1e18);
        oracle.setPrice(address(lst), MON_PRICE * 11 / 10);

        uint256 expectedGain = 475_000e6 / 10;
        assertApproxEqRel(vault.totalAssets(), DEPOSIT + expectedGain, 1e15);
        assertGt(vault.pricePerShare(), 1e18);
    }

    function test_withdrawUnwindsProportionally() public {
        _rebalance();

        vm.prank(alice);
        vault.withdraw(600_000e6, alice, alice);

        assertEq(usdc.balanceOf(alice), 600_000e6);
        assertApproxEqRel(vault.totalAssets(), 400_000e6, 1e15);
        assertLe(_abs(strategy.netDeltaBps()), 200);
        assertGt(hedge.shortNotional(), 0);
        assertGt(lst.balanceOf(address(strategy)), 0);
    }

    function test_fullRedeemAfterRebalance() public {
        _rebalance();
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertApproxEqRel(usdc.balanceOf(alice), DEPOSIT, 1e15);
        assertEq(vault.totalSupply(), 0);
    }

    function test_emergencyExitReturnsEverything() public {
        _rebalance();
        vm.prank(admin);
        vault.emergencyExit();

        assertEq(hedge.shortNotional(), 0);
        assertEq(lst.balanceOf(address(strategy)), 0);
        assertEq(strategy.totalAssets(), 0);
        assertApproxEqRel(vault.idleAssets(), DEPOSIT, 1e15);
        assertTrue(vault.paused());
    }

    function test_rebalanceSkipsDust() public {
        // Fresh vault with a tiny deposit below minAllocation.
        DeltaVault small = new DeltaVault(usdc, "s", "s", admin, fees, 10_000_000e6, 0);
        DeltaNeutralStrategy s =
            new DeltaNeutralStrategy(address(small), address(usdc), address(wmon), address(lst), admin);
        vm.startPrank(admin);
        s.setVenues(spot, staking, hedge, oracle);
        small.setStrategy(s);
        small.grantRole(small.KEEPER_ROLE(), keeper);
        vm.stopPrank();

        usdc.mint(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(small), 50e6);
        small.deposit(50e6, alice);
        vm.stopPrank();

        vm.startPrank(keeper);
        small.invest(50e6);
        small.rebalance("");
        vm.stopPrank();

        assertEq(s.spotLegValue(), 0);
        assertEq(s.idleAssets(), 50e6);
    }

    function test_onlyVaultCanDriveStrategy() public {
        vm.startPrank(alice);
        vm.expectRevert(DeltaNeutralStrategy.OnlyVault.selector);
        strategy.rebalance("");
        vm.expectRevert(DeltaNeutralStrategy.OnlyVault.selector);
        strategy.withdraw(1, alice);
        vm.expectRevert(DeltaNeutralStrategy.OnlyVault.selector);
        strategy.emergencyExit();
        vm.stopPrank();
    }

    function test_slippageGuardReverts() public {
        spot.setFeeBps(100); // 1 % worse than oracle, above the 0.5 % default
        vm.prank(keeper);
        vm.expectRevert("MockSpotVenue: slippage");
        vault.rebalance("");
    }
}
