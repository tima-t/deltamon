// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeltaMonVault} from "../../src/DeltaMonVault.sol";
import {KuruSpotAdapter} from "../../src/adapters/KuruSpotAdapter.sol";
import {ChainlinkOracle} from "../../src/oracles/ChainlinkOracle.sol";
import {ISpotVenue} from "../../src/interfaces/ISpotVenue.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {IWMON} from "../../src/interfaces/external/IWMON.sol";
import {IPerplExchange} from "../../src/interfaces/external/IPerplExchange.sol";
import {IMonadStaking} from "../../src/interfaces/external/IMonadStaking.sol";

/// @notice Exercises the vault against live Monad mainnet contracts: Kuru's router, Chainlink's
///         MON/USD feed, the native staking precompile, and Perpl's Exchange.
///         RUN_FORK_TESTS=true forge test --match-contract DeltaMonMainnetFork -vv
contract DeltaMonMainnetForkTest is Test {
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    address constant KURU_ROUTER = 0xd651346d7c789536ebf06dc72aE3C8502cd695CC;
    address constant KURU_MON_USDC = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address constant KURU_MON_AUSD = 0x131A2e70A5b31a517A74b8c567149bc294470Da9;
    address constant KURU_AUSD_USDC = 0x699AbC15308156E9a3AB89Ec7387e9CfE1c86A3b;
    address constant CHAINLINK_MON_USD = 0xBcD78f76005B7515837af6b50c7C52BCf73822fb;
    address constant PERPL = 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F;
    address constant AUSD_WHALE = 0xdeBFeDF35faEd5d1664E553545e144C02227A2Ec; // Aave aAUSD
    address constant USDC_WHALE = 0x35a73BAcb179d3740395A3ceCc87FF2e581d6042;
    IMonadStaking constant STAKING = IMonadStaking(0x0000000000000000000000000000000000001000);
    uint64 constant VALIDATOR = 5;

    DeltaMonVault vault;
    KuruSpotAdapter adapter;
    ChainlinkOracle oracle;

    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bool enabled;

    function setUp() public {
        enabled = vm.envOr("RUN_FORK_TESTS", false);
        if (!enabled) return;
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")));

        oracle = new ChainlinkOracle(admin);
        vm.prank(admin);
        oracle.setFeed(WMON, CHAINLINK_MON_USD, address(0), 1 days);

        adapter = new KuruSpotAdapter(KURU_ROUTER, WMON, admin);
        address[] memory monRoute = new address[](1);
        monRoute[0] = KURU_MON_USDC;
        address[] memory ausdRoute = new address[](1);
        ausdRoute[0] = KURU_AUSD_USDC;
        vm.startPrank(admin);
        adapter.setRoute(USDC, WMON, monRoute);
        adapter.setRoute(WMON, USDC, monRoute);
        adapter.setRoute(USDC, AUSD, ausdRoute);
        adapter.setRoute(AUSD, USDC, ausdRoute);
        vm.stopPrank();

        vm.prank(admin);
        vault = new DeltaMonVault(
            IERC20(USDC),
            IWMON(WMON),
            IERC20(AUSD),
            ISpotVenue(address(adapter)),
            IPriceOracle(address(oracle)),
            IPerplExchange(PERPL),
            1_000_000e6,
            1000
        );

        vm.startPrank(USDC_WHALE);
        IERC20(USDC).transfer(alice, 50_000e6);
        IERC20(USDC).transfer(bob, 50_000e6);
        vm.stopPrank();
        vm.prank(alice);
        IERC20(USDC).approve(address(vault), type(uint256).max);
        vm.prank(bob);
        IERC20(USDC).approve(address(vault), type(uint256).max);
    }

    modifier onlyFork() {
        vm.skip(!enabled);
        _;
    }

    function test_depositThenRealKuruSwap() public onlyFork {
        console2.log("MON/USD 1e18", vault.monPrice());

        vm.prank(alice);
        uint256 shares = vault.deposit(10_000e6, alice);
        assertEq(shares, 10_000e18);
        assertEq(vault.costBasis(alice), 10_000e6);

        vm.prank(admin);
        vault.swapUsdcForMon(6000e6, 0);

        console2.log("USDC held", vault.usdcBalance());
        console2.log("WMON held", IERC20(WMON).balanceOf(address(vault)));
        assertEq(vault.usdcBalance(), 4000e6);
        assertGt(IERC20(WMON).balanceOf(address(vault)), 0);
        assertApproxEqRel(vault.totalAssets(), 10_000e6, 0.01e18);
    }

    function test_realNativeStaking() public onlyFork {
        vm.prank(alice);
        vault.deposit(10_000e6, alice);
        vm.prank(admin);
        vault.swapUsdcForMon(6000e6, 0);

        uint256 mon = IERC20(WMON).balanceOf(address(vault));
        vm.prank(admin);
        vault.stake(VALIDATOR, mon);

        assertEq(vault.stakedMon(), mon);
        assertEq(IERC20(WMON).balanceOf(address(vault)), 0);
        assertApproxEqRel(vault.totalAssets(), 10_000e6, 0.01e18);

        (uint256 stakeNow,,, uint256 deltaStake,,,) = STAKING.getDelegator(VALIDATOR, address(vault));
        console2.log("precompile stake", stakeNow);
        console2.log("precompile deltaStake", deltaStake);
        // Delegation lands at the next epoch boundary, so it shows up in one field or the other.
        assertEq(stakeNow + deltaStake, mon);

        // A fresh delegation only becomes active at the next epoch boundary, and Monad's epochs
        // cannot be advanced on a fork, so undelegating in the same epoch is expected to fail.
        vm.prank(admin);
        vm.expectRevert("insufficient stake");
        vault.unstake(VALIDATOR, mon);
    }

    /// @notice Documents a live blocker: Perpl takes AUSD as collateral, but neither Kuru route to
    ///         AUSD can be filled at any size today. Both revert with the book's MarketStateError.
    ///         Until a route exists, AUSD has to reach the vault another way.
    function test_ausdCannotBeSourcedOnKuruToday() public onlyFork {
        vm.prank(alice);
        vault.deposit(20_000e6, alice);

        uint256 snap = vm.snapshotState();
        vm.prank(admin);
        vm.expectRevert(); // direct AUSD/USDC book
        vault.swapUsdcForAusd(200e6, 0);
        vm.revertToState(snap);

        address[] memory viaMon = new address[](2);
        viaMon[0] = KURU_MON_USDC;
        viaMon[1] = KURU_MON_AUSD;
        vm.prank(admin);
        adapter.setRoute(USDC, AUSD, viaMon);
        vm.prank(admin);
        vm.expectRevert(); // two-hop through the deep MON book, still no fill
        vault.swapUsdcForAusd(200e6, 0);
    }

    /// @notice Drives the real Perpl Exchange: open the vault's own account, add and remove
    ///         collateral, and switch on order forwarding so the admin's API key can trade it.
    function test_realPerplCollateralRails() public onlyFork {
        vm.prank(alice);
        vault.deposit(10_000e6, alice);

        // Kuru cannot fill AUSD today, so the collateral is placed directly to test the rails.
        vm.prank(AUSD_WHALE);
        IERC20(AUSD).transfer(address(vault), 5000e6);
        assertEq(IERC20(AUSD).balanceOf(address(vault)), 5000e6);

        uint256 valueBefore = vault.totalAssets();
        vm.prank(admin);
        vault.perplCreateAccount(5000e6);
        assertEq(vault.perplPrincipal(), 5000e6);
        assertEq(vault.perpEquity(), 5000e6);
        assertEq(vault.totalAssets(), valueBefore); // collateral still counted at full value
        console2.log("Perpl account opened with AUSD", uint256(5000e6));

        vm.prank(admin);
        vault.perplAllowOrderForwarding(true);

        vm.prank(admin);
        uint256 back = vault.perplWithdrawCollateral(1000e6);
        console2.log("AUSD withdrawn from Perpl", back);
        assertEq(back, 1000e6);
        assertEq(vault.perplPrincipal(), 4000e6);
        assertEq(IERC20(AUSD).balanceOf(address(vault)), 1000e6);

        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.AmountExceedsPrincipal.selector);
        vault.perplWithdrawCollateral(5000e6);
    }

    /// @notice The admin's own key is useless against the vault's Perpl collateral. Perpl keys an
    ///         account by msg.sender and its only withdrawal function takes an amount and no
    ///         address, so nobody can name someone else's account as the source or the destination.
    function test_adminKeyCannotTouchPerplCollateral() public onlyFork {
        address attacker = makeAddr("attacker");

        vm.prank(alice);
        vault.deposit(10_000e6, alice);
        vm.prank(AUSD_WHALE);
        IERC20(AUSD).transfer(address(vault), 5000e6);
        vm.prank(admin);
        vault.perplCreateAccount(5000e6);
        // Worst case for the vault: order forwarding is on, so the admin is fully authorised to trade.
        vm.prank(admin);
        vault.perplAllowOrderForwarding(true);

        uint256 adminBefore = IERC20(AUSD).balanceOf(admin);
        uint256 attackerBefore = IERC20(AUSD).balanceOf(attacker);

        // The admin signs a withdrawal straight to Perpl with their own key.
        vm.prank(admin);
        try IPerplExchange(PERPL).withdrawCollateral(5000e6) {
            console2.log("admin direct withdraw did not revert");
        } catch {
            console2.log("admin direct withdraw reverted");
        }
        vm.prank(attacker);
        try IPerplExchange(PERPL).withdrawCollateral(5000e6) {
            console2.log("attacker direct withdraw did not revert");
        } catch {
            console2.log("attacker direct withdraw reverted");
        }

        // Neither of them received anything.
        assertEq(IERC20(AUSD).balanceOf(admin), adminBefore);
        assertEq(IERC20(AUSD).balanceOf(attacker), attackerBefore);

        // And the vault's collateral is still whole: it can take the full amount back.
        vm.prank(admin);
        uint256 back = vault.perplWithdrawCollateral(5000e6);
        assertEq(back, 5000e6);
        assertEq(IERC20(AUSD).balanceOf(address(vault)), 5000e6);
        assertEq(IERC20(AUSD).balanceOf(admin), adminBefore);
    }

    function test_fullCycleWithProfitFee() public onlyFork {
        // The vault's default floor is half a percent per leg, which a live book can exceed on a
        // round trip. Widen it for this test so it measures the fee path, not today's spread.
        vm.prank(admin);
        vault.setRiskParams(200, 100, 2e17, 5000, 6 hours);

        vm.prank(alice);
        vault.deposit(10_000e6, alice);
        vm.prank(admin);
        vault.swapUsdcForMon(6000e6, 0);

        uint256 mon = IERC20(WMON).balanceOf(address(vault));
        vm.prank(admin);
        vault.swapMonForUsdc(mon, 0);

        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(aliceShares, alice, alice);
        console2.log("alice out", out);
        // Two crossings of a real order book cost some spread, so this always lands under par.
        assertApproxEqRel(out, 10_000e6, 0.02e18);
        assertLe(out, 10_000e6);
        assertEq(vault.accruedFees(), 0); // a loss, so no performance fee
    }
}
