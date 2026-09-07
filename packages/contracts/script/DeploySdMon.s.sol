// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SdMonVault} from "../src/SdMonVault.sol";
import {KuruSpotAdapter} from "../src/adapters/KuruSpotAdapter.sol";
import {ChainlinkOracle} from "../src/oracles/ChainlinkOracle.sol";
import {IKuruOrderBook} from "../src/interfaces/external/IKuruOrderBook.sol";

/// @notice Deploys the v1 sdMON vault stack. Broadcaster must be ADMIN.
///         forge script script/DeploySdMon.s.sol:DeploySdMon --rpc-url monad --broadcast --private-key $PRIVATE_KEY
contract DeploySdMon is Script {
    struct Params {
        address admin;
        address keeper;
        address usdc;
        address wmon;
        address kuruRouter;
        address kuruMarket;
        address chainlinkMonUsd;
        uint256 depositCap;
        uint256 minDeposit;
    }

    function run() external {
        Params memory p;
        p.admin = vm.envAddress("ADMIN");
        p.keeper = vm.envOr("KEEPER", p.admin);
        p.usdc = vm.envAddress("USDC");
        p.wmon = vm.envAddress("WMON");
        p.kuruRouter = vm.envAddress("KURU_ROUTER");
        p.kuruMarket = vm.envAddress("KURU_MARKET_MON_USDC");
        p.chainlinkMonUsd = vm.envAddress("CHAINLINK_MON_USD");
        p.depositCap = vm.envOr("DEPOSIT_CAP", uint256(10_000e6));
        p.minDeposit = vm.envOr("MIN_DEPOSIT", uint256(10e6));

        vm.startBroadcast();

        ChainlinkOracle oracle = new ChainlinkOracle(p.admin);
        oracle.setFeed(p.wmon, p.chainlinkMonUsd, address(0), 1 days);

        KuruSpotAdapter spot = new KuruSpotAdapter(p.kuruRouter, p.wmon, p.admin);
        address[] memory route = new address[](1);
        route[0] = p.kuruMarket;
        spot.setRoute(p.usdc, p.wmon, route);
        spot.setRoute(p.wmon, p.usdc, route);

        SdMonVault vault = new SdMonVault(IERC20(p.usdc), IERC20(p.wmon), spot, oracle, p.admin, p.depositCap);
        (,,,,,,, uint96 minSize,,,) = IKuruOrderBook(p.kuruMarket).getMarketParams();
        vault.setMinSwapMon(uint256(minSize) * 1e18 / 1e10);
        vault.setMinDeposit(p.minDeposit);
        vault.grantRole(vault.KEEPER_ROLE(), p.keeper);

        vm.stopBroadcast();

        console2.log("chainId       ", block.chainid);
        console2.log("SdMonVault    ", address(vault));
        console2.log("KuruSpot      ", address(spot));
        console2.log("ChainlinkOracle", address(oracle));

        string memory json = "deployment";
        vm.serializeAddress(json, "vault", address(vault));
        vm.serializeAddress(json, "spotVenue", address(spot));
        vm.serializeAddress(json, "oracle", address(oracle));
        string memory out = vm.serializeUint(json, "deployedAtBlock", block.number);
        vm.writeJson(out, string.concat("deployments/sdmon-", vm.toString(block.chainid), ".json"));
    }
}
