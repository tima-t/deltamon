// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeltaMonVault} from "../src/DeltaMonVault.sol";
import {KuruSpotAdapter} from "../src/adapters/KuruSpotAdapter.sol";
import {ChainlinkOracle} from "../src/oracles/ChainlinkOracle.sol";
import {ISpotVenue} from "../src/interfaces/ISpotVenue.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {IStableSwap} from "../src/interfaces/external/IStableSwap.sol";
import {IWMON} from "../src/interfaces/external/IWMON.sol";

/// @notice Deploys the vault stack. The broadcasting key deploys and configures everything, locks the
///         oracle and the swap adapter for good, then hands the vault to the multisig in VAULT_OWNER,
///         which becomes the admin once it calls acceptOwnership().
///         forge script script/DeployDeltaMon.s.sol:DeployDeltaMon --rpc-url monad --broadcast --private-key $PRIVATE_KEY
contract DeployDeltaMon is Script {
    struct Params {
        address usdc;
        address wmon;
        address ausd;
        address kuruRouter;
        address kuruMonUsdc;
        address stablePoolAusdUsdc;
        address chainlinkMonUsd;
        address owner;
        address keeper;
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
        p.stablePoolAusdUsdc = vm.envOr("STABLE_POOL_AUSD_USDC", address(0));
        p.chainlinkMonUsd = vm.envAddress("CHAINLINK_MON_USD");
        p.owner = vm.envAddress("VAULT_OWNER");
        p.keeper = vm.envOr("KEEPER_ADDRESS", address(0));
        p.depositCap = vm.envOr("DEPOSIT_CAP", uint256(50_000e6));
        p.minDeposit = vm.envOr("MIN_DEPOSIT", uint256(10e6));
        p.performanceFeeBps = uint16(vm.envOr("PERFORMANCE_FEE_BPS", uint256(1000)));

        // The admin can allocate every dollar in the vault, so it should not be a single key.
        if (p.owner.code.length == 0 && !vm.envOr("ALLOW_EOA_OWNER", false)) {
            revert("VAULT_OWNER has no code. Use a multisig, or set ALLOW_EOA_OWNER=true for a test deploy.");
        }

        vm.startBroadcast();
        address deployer = msg.sender;

        ChainlinkOracle oracle = new ChainlinkOracle(deployer);
        // The MON/USD feed was measured updating every 30 seconds, so an hour is ample headroom
        // while still refusing a price that has actually gone dark.
        oracle.setFeed(p.wmon, p.chainlinkMonUsd, address(0), vm.envOr("ORACLE_MAX_STALENESS", uint256(1 hours)));
        // Locked for good. A different feed means a new oracle, which can only reach the vault
        // through its three day venue timelock.
        oracle.renounceOwnership();

        KuruSpotAdapter spot = new KuruSpotAdapter(p.kuruRouter, p.wmon, deployer);
        address[] memory monRoute = new address[](1);
        monRoute[0] = p.kuruMonUsdc;
        spot.setRoute(p.usdc, p.wmon, monRoute);
        spot.setRoute(p.wmon, p.usdc, monRoute);

        // Kuru's AUSD order books are empty: the direct AUSD/USDC book reverts with MarketStateError
        // and the two hop route through MON with InsufficientLiquidity, at every size. The liquidity
        // Kuru's own front end uses for that pair sits in a StableSwap pool, so AUSD is routed there.
        // The indices come from the pool itself rather than from a guess.
        if (p.stablePoolAusdUsdc != address(0)) {
            IStableSwap pool = IStableSwap(p.stablePoolAusdUsdc);
            int128 iUsdc = pool.coins(0) == p.usdc ? int128(0) : int128(1);
            int128 iAusd = pool.coins(0) == p.ausd ? int128(0) : int128(1);
            require(iUsdc != iAusd, "stable pool does not hold both USDC and AUSD");
            spot.setStableRoute(p.usdc, p.ausd, address(pool), iUsdc, iAusd);
            spot.setStableRoute(p.ausd, p.usdc, address(pool), iAusd, iUsdc);
        }
        // Locked for the same reason. A route added later means a new adapter behind the timelock.
        spot.renounceOwnership();

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
        if (p.keeper != address(0)) vault.setKeeper(p.keeper);
        // Two steps: the multisig becomes the admin only once it calls acceptOwnership().
        vault.transferOwnership(p.owner);

        vm.stopBroadcast();

        require(oracle.owner() == address(0) && spot.owner() == address(0), "oracle or adapter still owned");

        console2.log("chainId        ", block.chainid);
        console2.log("deployer       ", deployer);
        console2.log("admin (pending)", p.owner);
        console2.log("keeper         ", p.keeper);
        console2.log("DeltaMonVault  ", address(vault));
        console2.log("KuruSpotAdapter", address(spot));
        console2.log("ChainlinkOracle", address(oracle));
        console2.log("AUSD stable pool", p.stablePoolAusdUsdc);
        console2.log("Next: the multisig calls acceptOwnership() on the vault.");

        string memory json = "deployment";
        vm.serializeAddress(json, "vault", address(vault));
        vm.serializeAddress(json, "spotVenue", address(spot));
        vm.serializeAddress(json, "oracle", address(oracle));
        vm.serializeAddress(json, "admin", p.owner);
        vm.serializeAddress(json, "deployer", deployer);
        vm.serializeAddress(json, "keeper", p.keeper);
        vm.serializeAddress(json, "stablePool", p.stablePoolAusdUsdc);
        string memory out = vm.serializeUint(json, "deployedAtBlock", block.number);
        vm.writeJson(out, string.concat("deployments/deltamon-", vm.toString(block.chainid), ".json"));
    }
}
