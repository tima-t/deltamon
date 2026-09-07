// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SdMonVault} from "../src/SdMonVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {MockSpotVenue} from "./mocks/MockVenues.sol";

contract SdMonVaultTest is Test {
    MockERC20 usdc;
    MockERC20 mon;
    MockOracle oracle;
    MockSpotVenue venue;
    SdMonVault vault;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant MON_PRICE = 0.025e18; // $0.025
    uint256 constant CAP = 10_000_000e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        mon = new MockERC20("Wrapped MON", "WMON", 18);
        oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(mon), MON_PRICE);
        venue = new MockSpotVenue(oracle);
        vault = new SdMonVault(usdc, mon, venue, oracle, admin, CAP);

        bytes32 keeperRole = vault.KEEPER_ROLE();
        vm.prank(admin);
        vault.grantRole(keeperRole, keeper);

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

    function test_metadata() public view {
        assertEq(vault.symbol(), "sdMON");
        assertEq(vault.decimals(), 18);
        assertEq(vault.asset(), address(usdc));
        assertEq(vault.targetMonBps(), 6000);
    }

    function test_depositSwapsSixtyPercentIntoMon() public {
        uint256 shares = _deposit(alice, 1000e6);

        assertEq(vault.usdcBalance(), 400e6);
        assertEq(vault.monBalance(), 24_000e18); // 600 USDC / $0.025
        assertEq(vault.totalAssets(), 1000e6);
        assertEq(vault.monShareBps(), 6000);
        assertEq(shares, 1000e18); // 1 sdMON per USDC of value at inception
        assertEq(vault.balanceOf(alice), shares);
        assertEq(vault.pricePerShare(), 1e6);
    }

    function test_secondDepositorGetsProRataShares() public {
        _deposit(alice, 1000e6);

        // MON doubles: alice's book is now 400 + 1200 = 1600 USDC.
        oracle.setPrice(address(mon), MON_PRICE * 2);
        assertEq(vault.totalAssets(), 1600e6);

        uint256 bobShares = _deposit(bob, 800e6);
        // 800 of value into a 1600 book → bob owns 1/3, i.e. half of alice's shares.
        assertApproxEqRel(bobShares, 500e18, 1e12);
        assertApproxEqRel(vault.convertToAssets(bobShares), 800e6, 1e12);
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(alice)), 1600e6, 1e12);
    }

    function test_previewDepositIsAnUpperBoundUnderSlippage() public {
        venue.setFeeBps(30); // venue fills 0.3 % worse than oracle
        uint256 preview = vault.previewDeposit(1000e6);
        uint256 actual = _deposit(alice, 1000e6);
        assertLt(actual, preview);
        // Slippage lands on the depositor: 0.3 % of the 60 % swapped.
        assertApproxEqRel(actual, 1000e18 - 1.8e18, 1e12);
    }

    function test_redeemSellsMonBackToUsdc() public {
        uint256 shares = _deposit(alice, 1000e6);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertApproxEqAbs(out, 1000e6, 2);
        assertApproxEqAbs(usdc.balanceOf(alice), 1_000_000e6, 2);
        assertEq(vault.totalSupply(), 0);
        assertLe(vault.monBalance(), 1);
    }

    function test_redeemInKindReturnsBothTokens() public {
        uint256 shares = _deposit(alice, 1000e6);
        vm.prank(alice);
        (uint256 usdcOut, uint256 monOut) = vault.redeemInKind(shares, alice, alice);
        assertApproxEqAbs(usdcOut, 400e6, 1);
        assertApproxEqAbs(monOut, 24_000e18, 1e6);
        assertEq(mon.balanceOf(alice), monOut);
    }

    function test_partialRedeemKeepsAllocation() public {
        _deposit(alice, 1000e6);
        _deposit(bob, 500e6);
        uint256 half = vault.balanceOf(alice) / 2;
        vm.prank(alice);
        uint256 out = vault.redeem(half, alice, alice);
        assertApproxEqRel(out, 500e6, 1e12);
        assertEq(vault.monShareBps(), 6000);
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(bob)), 500e6, 1e12);
    }

    function test_redeemWithAllowance() public {
        uint256 shares = _deposit(alice, 1000e6);
        vm.prank(alice);
        vault.approve(bob, shares);
        vm.prank(bob);
        uint256 out = vault.redeem(shares, bob, alice);
        assertApproxEqAbs(out, 1000e6, 2);
        assertEq(vault.balanceOf(alice), 0);
    }

    function test_rebalanceSellsExcessMon() public {
        _deposit(alice, 1000e6);
        oracle.setPrice(address(mon), MON_PRICE * 2); // MON is now 75 % of the book
        assertEq(vault.monShareBps(), 7500);

        vm.prank(keeper);
        vault.rebalance();

        assertApproxEqAbs(vault.monShareBps(), 6000, 1);
        assertApproxEqRel(vault.totalAssets(), 1600e6, 1e12);
        assertEq(vault.lastRebalanceAt(), block.timestamp);
    }

    function test_rebalanceBuysWhenUnderweight() public {
        _deposit(alice, 1000e6);
        oracle.setPrice(address(mon), MON_PRICE / 2); // MON is now ~43 % of the book
        assertLt(vault.monShareBps(), 5500);

        vm.prank(keeper);
        vault.rebalance();
        assertApproxEqAbs(vault.monShareBps(), 6000, 1);
    }

    function test_rebalanceRevertsInsideThreshold() public {
        _deposit(alice, 1000e6);
        vm.prank(keeper);
        vm.expectPartialRevert(SdMonVault.NothingToRebalance.selector);
        vault.rebalance();
    }

    function test_onlyKeeperCanRebalance() public {
        _deposit(alice, 1000e6);
        oracle.setPrice(address(mon), MON_PRICE * 2);
        vm.prank(alice);
        vm.expectPartialRevert(IAccessControl.AccessControlUnauthorizedAccount.selector);
        vault.rebalance();
    }

    function test_mintAndWithdrawDisabled() public {
        assertEq(vault.maxMint(alice), 0);
        assertEq(vault.maxWithdraw(alice), 0);
        vm.startPrank(alice);
        vm.expectRevert(SdMonVault.MintNotSupported.selector);
        vault.mint(1e18, alice);
        vm.expectRevert(SdMonVault.WithdrawNotSupported.selector);
        vault.withdraw(1e6, alice, alice);
        vm.stopPrank();
    }

    function test_minDepositEnforced() public {
        vm.prank(alice);
        vm.expectPartialRevert(SdMonVault.BelowMinDeposit.selector);
        vault.deposit(5e6, alice);
    }

    function test_depositCapEnforced() public {
        vm.prank(admin);
        vault.setDepositCap(500e6);
        vm.prank(alice);
        vm.expectPartialRevert(ERC4626.ERC4626ExceededMaxDeposit.selector);
        vault.deposit(600e6, alice);
    }

    function test_venueMinimumEnforced() public {
        vm.prank(admin);
        vault.setMinSwapMon(200e18); // Kuru MON/USDC minSize
        // 10 USDC → 6 USDC of MON = 240 MON: ok. Raise the price so 6 USDC buys only 120 MON.
        oracle.setPrice(address(mon), 0.05e18);
        vm.prank(alice);
        vm.expectPartialRevert(SdMonVault.SwapBelowVenueMinimum.selector);
        vault.deposit(10e6, alice);
    }

    function test_slippageGuardReverts() public {
        venue.setFeeBps(100); // 1 % worse than the 0.5 % tolerance
        vm.prank(alice);
        vm.expectRevert("MockSpotVenue: slippage");
        vault.deposit(1000e6, alice);
    }

    function test_pauseBlocksDepositsAndRebalanceButAllowsRedeem() public {
        uint256 shares = _deposit(alice, 1000e6);
        vm.prank(admin);
        vault.pause();

        assertEq(vault.maxDeposit(alice), 0);
        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(100e6, alice);

        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertApproxEqAbs(out, 1000e6, 2);
    }

    function test_adminSettersValidate() public {
        vm.startPrank(admin);
        vm.expectRevert(SdMonVault.InvalidBps.selector);
        vault.setAllocation(10_001, 500);
        vm.expectRevert(SdMonVault.InvalidBps.selector);
        vault.setMaxSlippage(501);
        vault.setAllocation(5000, 300);
        vm.stopPrank();
        assertEq(vault.targetMonBps(), 5000);
        _deposit(alice, 1000e6);
        assertEq(vault.monShareBps(), 5000);
    }

    function testFuzz_depositRedeemRoundTrip(uint96 amount) public {
        amount = uint96(bound(uint256(amount), 10e6, 1_000_000e6));
        uint256 shares = _deposit(alice, amount);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertLe(out, amount);
        assertApproxEqRel(out, amount, 1e12);
    }

    function testFuzz_twoDepositorsShareValueProRata(uint96 a, uint96 b, uint64 priceMul) public {
        a = uint96(bound(uint256(a), 10e6, 500_000e6));
        b = uint96(bound(uint256(b), 10e6, 500_000e6));
        priceMul = uint64(bound(uint256(priceMul), 0.2e18, 5e18));

        _deposit(alice, a);
        oracle.setPrice(address(mon), MON_PRICE * priceMul / 1e18);
        uint256 aliceValueBefore = vault.convertToAssets(vault.balanceOf(alice));
        _deposit(bob, b);

        // Bob's arrival never changes what Alice's shares are worth.
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(alice)), aliceValueBefore, 1e12);
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(bob)), b, 1e12);
    }
}
