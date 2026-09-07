// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SdMonVault} from "../../src/SdMonVault.sol";
import {KuruSpotAdapter} from "../../src/adapters/KuruSpotAdapter.sol";
import {ChainlinkOracle} from "../../src/oracles/ChainlinkOracle.sol";
import {IKuruOrderBook} from "../../src/interfaces/external/IKuruOrderBook.sol";

/// @notice Runs the real deposit → Kuru swap → sdMON flow against a Monad mainnet fork.
///         RUN_FORK_TESTS=true forge test --match-contract KuruMainnetFork -vvv
contract KuruMainnetForkTest is Test {
    // Monad mainnet (chain id 143)
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address constant KURU_ROUTER = 0xd651346d7c789536ebf06dc72aE3C8502cd695CC;
    address constant KURU_MON_USDC = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address constant CHAINLINK_MON_USD = 0xBcD78f76005B7515837af6b50c7C52BCf73822fb;
    address constant USDC_WHALE = 0x35a73BAcb179d3740395A3ceCc87FF2e581d6042; // Aave aUSDC

    SdMonVault vault;
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
        address[] memory route = new address[](1);
        route[0] = KURU_MON_USDC;
        vm.startPrank(admin);
        adapter.setRoute(USDC, WMON, route);
        adapter.setRoute(WMON, USDC, route);
        vm.stopPrank();

        vault = new SdMonVault(IERC20(USDC), IERC20(WMON), adapter, oracle, admin, 1_000_000e6);
        (,,,,,,, uint96 minSize,,,) = IKuruOrderBook(KURU_MON_USDC).getMarketParams();
        vm.prank(admin);
        vault.setMinSwapMon(uint256(minSize) * 1e18 / 1e10); // sizePrecision 1e10 → MON units

        vm.startPrank(USDC_WHALE);
        IERC20(USDC).transfer(alice, 5000e6);
        IERC20(USDC).transfer(bob, 5000e6);
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

    function test_depositSwapsSixtyPercentOnKuru() public onlyFork {
        uint256 price = vault.monPrice();
        console2.log("MON/USD (1e18)", price);

        vm.prank(alice);
        uint256 shares = vault.deposit(1000e6, alice);

        console2.log("USDC held", vault.usdcBalance());
        console2.log("WMON held", vault.monBalance());
        console2.log("sdMON minted", shares);
        console2.log("mon share bps", vault.monShareBps());

        assertEq(vault.usdcBalance(), 400e6);
        assertGt(vault.monBalance(), 0);
        assertApproxEqRel(vault.monToAssets(vault.monBalance()), 600e6, 0.01e18); // within 1 % of oracle
        assertApproxEqAbs(vault.monShareBps(), 6000, 60);
        assertApproxEqRel(shares, 1000e18, 0.01e18);
        assertEq(address(adapter).balance, 0);
        assertEq(IERC20(WMON).balanceOf(address(adapter)), 0);
    }

    function test_secondDepositorAndRedeemRoundTrip() public onlyFork {
        vm.prank(alice);
        uint256 aliceShares = vault.deposit(1000e6, alice);
        vm.prank(bob);
        uint256 bobShares = vault.deposit(500e6, bob);

        assertApproxEqRel(bobShares * 2, aliceShares, 0.01e18);

        vm.prank(alice);
        uint256 out = vault.redeem(aliceShares, alice, alice);
        console2.log("alice redeemed USDC", out);
        assertApproxEqRel(out, 1000e6, 0.01e18); // round trip inside 1 % (spread + slippage)
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(bob)), 500e6, 0.01e18);
    }

    function test_redeemInKindOnFork() public onlyFork {
        vm.prank(alice);
        uint256 shares = vault.deposit(1000e6, alice);
        vm.prank(alice);
        (uint256 usdcOut, uint256 monOut) = vault.redeemInKind(shares, alice, alice);
        assertApproxEqAbs(usdcOut, 400e6, 1);
        assertEq(IERC20(WMON).balanceOf(alice), monOut);
        assertGt(monOut, 0);
    }
}
