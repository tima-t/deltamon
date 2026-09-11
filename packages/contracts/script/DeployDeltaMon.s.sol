// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeltaMonVault} from "../src/DeltaMonVault.sol";
import {KuruSpotAdapter} from "../src/adapters/KuruSpotAdapter.sol";
import {ChainlinkOracle} from "../src/oracles/ChainlinkOracle.sol";
import {ISpotVenue} from "../src/interfaces/ISpotVenue.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {IWMON} from "../src/interfaces/external/IWMON.sol";

/// @notice Deploys the vault stack. The broadcasting key becomes the admin, per the spec.
///         forge script script/DeployDeltaMon.s.sol:DeployDeltaMon --rpc-url monad --broadcast --private-key $PRIVATE_KEY
contract DeployDeltaMon is Script {
    struct Params {
        address usdc;
        address wmon;
        address ausd;
        address kuruRouter;
        address kuruMonUsdc;
        address kuruAusdUsdc;
        address chainlinkMonUsd;
        uint256 depositCap;
        uint256 minDeposit;
        uint16 performanceFeeBps;
    }

    function run() external {
        Params memory p;
        p.usdc = vm.envAddress("USDC");
        p.wmon = vm.envAddress("WMON");
        p.ausd = vm.envAddress("AUSD");
        p.kuruRouter = vm.envAddress("KURU_ROUTER");
        p.kuruMonUsdc = vm.envAddress("KURU_MARKET_MON_USDC");
        p.kuruAusdUsdc = vm.envOr("KURU_MARKET_AUSD_USDC", address(0));
        p.chainlinkMonUsd = vm.envAddress("CHAINLINK_MON_USD");
        p.depositCap = vm.envOr("DEPOSIT_CAP", uint256(50_000e6));
        p.minDeposit = vm.envOr("MIN_DEPOSIT", uint256(10e6));
        p.performanceFeeBps = uint16(vm.envOr("PERFORMANCE_FEE_BPS", uint256(1000)));

        vm.startBroadcast();
        address admin = msg.sender;

        ChainlinkOracle oracle = new ChainlinkOracle(admin);
        // The MON/USD feed was measured updating every 30 seconds, so an hour is ample headroom
        // while still refusing a price that has actually gone dark.
        oracle.setFeed(p.wmon, p.chainlinkMonUsd, address(0), vm.envOr("ORACLE_MAX_STALENESS", uint256(1 hours)));

        KuruSpotAdapter spot = new KuruSpotAdapter(p.kuruRouter, p.wmon, admin);
        address[] memory monRoute = new address[](1);
        monRoute[0] = p.kuruMonUsdc;
        spot.setRoute(p.usdc, p.wmon, monRoute);
        spot.setRoute(p.wmon, p.usdc, monRoute);
        // The AUSD book is empty on mainnet today, so this route is registered only when given.
        if (p.kuruAusdUsdc != address(0)) {
            address[] memory ausdRoute = new address[](1);
            ausdRoute[0] = p.kuruAusdUsdc;
            spot.setRoute(p.usdc, p.ausd, ausdRoute);
            spot.setRoute(p.ausd, p.usdc, ausdRoute);
        }

        DeltaMonVault vault = new DeltaMonVault(
            IERC20(p.usdc),
            IWMON(p.wmon),
            IERC20(p.ausd),
            ISpotVenue(address(spot)),
            IPriceOracle(address(oracle)),
            p.depositCap,
            p.performanceFeeBps
        );
        vault.setLimits(p.depositCap, p.minDeposit);

        vm.stopBroadcast();

        console2.log("chainId        ", block.chainid);
        console2.log("admin          ", admin);
        console2.log("DeltaMonVault  ", address(vault));
        console2.log("KuruSpotAdapter", address(spot));
        console2.log("ChainlinkOracle", address(oracle));

        string memory json = "deployment";
        vm.serializeAddress(json, "vault", address(vault));
        vm.serializeAddress(json, "spotVenue", address(spot));
        vm.serializeAddress(json, "oracle", address(oracle));
        vm.serializeAddress(json, "admin", admin);
        string memory out = vm.serializeUint(json, "deployedAtBlock", block.number);
        vm.writeJson(out, string.concat("deployments/deltamon-", vm.toString(block.chainid), ".json"));
    }
}
