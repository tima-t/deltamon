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
        uint256 shares = vault.deposit(1000e6, alice);
        assertEq(shares, 1000e18);
        assertEq(vault.costBasis(alice), 1000e6);

        vm.prank(admin);
        vault.swapUsdcForMon(250e6, 0);

        console2.log("USDC held", vault.usdcBalance());
        console2.log("WMON held", IERC20(WMON).balanceOf(address(vault)));
        assertEq(vault.usdcBalance(), 750e6);
        assertGt(IERC20(WMON).balanceOf(address(vault)), 0);
        assertApproxEqRel(vault.totalAssets(), 1000e6, 0.01e18);
    }

    function test_realNativeStaking() public onlyFork {
        vm.prank(alice);
        vault.deposit(1000e6, alice);
        vm.prank(admin);
        vault.swapUsdcForMon(250e6, 0);

        uint256 mon = IERC20(WMON).balanceOf(address(vault));
        vm.prank(admin);
        vault.stake(VALIDATOR, mon);

        assertEq(vault.stakedMon(), mon);
        assertEq(IERC20(WMON).balanceOf(address(vault)), 0);
        assertApproxEqRel(vault.totalAssets(), 1000e6, 0.01e18);

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
        vault.deposit(2000e6, alice);

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

    /// @notice Measures the round-trip size Kuru's MON book can actually absorb right now.
    function test_probeMonRoundTripDepth() public onlyFork {
        vm.prank(admin);
        vault.setRiskParams(300, 100, 2e17, 5000, 6 hours);
        vm.prank(alice);
        vault.deposit(2000e6, alice);

        uint256[4] memory sizes = [uint256(250e6), 500e6, 1000e6, 2500e6];
        for (uint256 i = 0; i < sizes.length; i++) {
            uint256 snap = vm.snapshotState();
            vm.prank(admin);
            try vault.swapUsdcForMon(sizes[i], 0) {
                uint256 mon = IERC20(WMON).balanceOf(address(vault));
                vm.prank(admin);
                try vault.swapMonForUsdc(mon, 0) {
                    console2.log("round trip OK at USDC", sizes[i], "-> back", vault.usdcBalance());
                } catch {
                    console2.log("SELL failed at USDC", sizes[i]);
                }
            } catch {
                console2.log("BUY failed at USDC", sizes[i]);
            }
            vm.revertToState(snap);
        }
    }

    function test_fullCycleWithProfitFee() public onlyFork {
        // The vault's default floor is half a percent per leg, which a live book can exceed on a
        // round trip. Widen it for this test so it measures the fee path, not today's spread.
        vm.prank(admin);
        vault.setRiskParams(300, 100, 2e17, 5000, 6 hours);

        vm.prank(alice);
        vault.deposit(1000e6, alice);
        vm.prank(admin);
        vault.swapUsdcForMon(250e6, 0);

        uint256 mon = IERC20(WMON).balanceOf(address(vault));
        vm.prank(admin);
        vault.swapMonForUsdc(mon, 0);

        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(aliceShares, alice, alice);
        console2.log("alice out", out);
        // Two crossings of a real order book cost some spread, so this always lands under par.
        assertApproxEqRel(out, 1000e6, 0.02e18);
        assertLe(out, 1000e6);
        assertEq(vault.accruedFees(), 0); // a loss, so no performance fee
    }
}
