// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KuruSpotAdapter} from "../src/adapters/KuruSpotAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {MockWMON, MockKuruOrderBook, MockKuruRouter} from "./mocks/MockKuru.sol";

contract KuruSpotAdapterTest is Test {
    MockERC20 usdc;
    MockWMON wmon;
    MockOracle oracle;
    MockKuruOrderBook market;
    MockKuruRouter router;
    KuruSpotAdapter adapter;

    address owner = makeAddr("owner");
    address trader = makeAddr("trader");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        wmon = new MockWMON();
        oracle = new MockOracle();
        oracle.setPrice(address(wmon), 0.025e18);
        market = new MockKuruOrderBook(address(0), address(usdc));
        router = new MockKuruRouter(oracle, usdc, address(wmon));
        vm.deal(address(router), 1_000_000e18);
        adapter = new KuruSpotAdapter(address(router), address(wmon), owner);

        address[] memory route = new address[](1);
        route[0] = address(market);
        vm.startPrank(owner);
        adapter.setRoute(address(usdc), address(wmon), route);
        adapter.setRoute(address(wmon), address(usdc), route);
        vm.stopPrank();
    }

    function test_planDerivesDirectionFromMarket() public view {
        (address[] memory markets, bool[] memory isBuy, bool[] memory nativeSend) =
            adapter.previewPlan(address(usdc), address(wmon));
        assertEq(markets[0], address(market));
        assertTrue(isBuy[0]);
        assertFalse(nativeSend[0]);

        (, isBuy, nativeSend) = adapter.previewPlan(address(wmon), address(usdc));
        assertFalse(isBuy[0]);
        assertTrue(nativeSend[0]);
    }

    function test_buyMonWrapsNativeOutput() public {
        usdc.mint(trader, 100e6);
        vm.startPrank(trader);
        usdc.approve(address(adapter), 100e6);
        uint256 out = adapter.swapExactIn(address(usdc), address(wmon), 100e6, 3990e18, trader);
        vm.stopPrank();

        assertEq(out, 4000e18);
        assertEq(wmon.balanceOf(trader), 4000e18);
        assertEq(address(adapter).balance, 0);
        assertEq(usdc.balanceOf(address(router)), 100e6);
    }

    function test_sellMonUnwrapsBeforeRouter() public {
        vm.deal(trader, 4000e18);
        vm.startPrank(trader);
        wmon.deposit{value: 4000e18}();
        wmon.approve(address(adapter), 4000e18);
        uint256 out = adapter.swapExactIn(address(wmon), address(usdc), 4000e18, 99e6, trader);
        vm.stopPrank();

        assertEq(out, 100e6);
        assertEq(usdc.balanceOf(trader), 100e6);
        assertEq(wmon.balanceOf(address(adapter)), 0);
        assertEq(address(router).balance, 1_000_000e18 + 4000e18);
    }

    function test_slippageReverts() public {
        router.setFeeBps(100);
        usdc.mint(trader, 100e6);
        vm.startPrank(trader);
        usdc.approve(address(adapter), 100e6);
        vm.expectRevert("MockKuruRouter: slippage");
        adapter.swapExactIn(address(usdc), address(wmon), 100e6, 3990e18, trader);
        vm.stopPrank();
    }

    function test_rejectsRouteThatDoesNotConnect() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        address[] memory route = new address[](1);
        route[0] = address(market);
        vm.prank(owner);
        vm.expectPartialRevert(KuruSpotAdapter.RouteMismatch.selector);
        adapter.setRoute(address(other), address(wmon), route);
    }

    function test_rejectsRouteEndingAtWrongToken() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        address[] memory route = new address[](1);
        route[0] = address(market);
        vm.prank(owner);
        vm.expectPartialRevert(KuruSpotAdapter.RouteEndsAtWrongToken.selector);
        adapter.setRoute(address(usdc), address(other), route);
    }

    function test_unknownRouteReverts() public {
        vm.prank(trader);
        vm.expectPartialRevert(KuruSpotAdapter.RouteNotSet.selector);
        adapter.swapExactIn(address(usdc), address(usdc), 1, 0, trader);
    }
}
