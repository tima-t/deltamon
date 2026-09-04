// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeltaVault} from "../src/DeltaVault.sol";
import {DeltaNeutralStrategy} from "../src/strategies/DeltaNeutralStrategy.sol";
import {KuruSpotAdapter} from "../src/adapters/KuruSpotAdapter.sol";
import {AprioriStakingAdapter} from "../src/adapters/AprioriStakingAdapter.sol";
import {PerplHedgeAdapter} from "../src/adapters/PerplHedgeAdapter.sol";
import {PythOracle} from "../src/oracles/PythOracle.sol";

/// @notice Deploys and wires the full stack. The broadcasting key must be ADMIN for wiring to succeed.
///         forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    bytes32 constant PYTH_MON_USD = 0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;
    bytes32 constant PYTH_USDC_USD = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;

    struct Params {
        address admin;
        address feeRecipient;
        address keeper;
        address usdc;
        address wmon;
        address lst;
        address kuruRouter;
        address kuruMarket;
        address pyth;
        address perplExchange;
        address perplCollateral;
        uint256 cap;
        uint256 feeBps;
    }

    struct Deployed {
        DeltaVault vault;
        DeltaNeutralStrategy strategy;
        KuruSpotAdapter spot;
        AprioriStakingAdapter staking;
        PerplHedgeAdapter hedge;
        PythOracle oracle;
    }

    function run() external {
        Params memory p = _params();

        vm.startBroadcast();
        Deployed memory d = _deploy(p);
        _wire(p, d);
        vm.stopBroadcast();

        _report(d);
    }

    function _params() internal view returns (Params memory p) {
        p.admin = vm.envAddress("ADMIN");
        p.feeRecipient = vm.envOr("FEE_RECIPIENT", p.admin);
        p.keeper = vm.envOr("KEEPER", p.admin);
        p.usdc = vm.envAddress("USDC");
        p.wmon = vm.envAddress("WMON");
        p.lst = vm.envAddress("LST");
        p.kuruRouter = vm.envAddress("KURU_ROUTER");
        p.kuruMarket = vm.envAddress("KURU_MARKET_MON_USDC");
        p.pyth = vm.envAddress("PYTH");
        p.perplExchange = vm.envAddress("PERPL_EXCHANGE");
        p.perplCollateral = vm.envOr("PERPL_COLLATERAL", p.usdc);
        p.cap = vm.envOr("DEPOSIT_CAP", uint256(1_000_000e6));
        p.feeBps = vm.envOr("PERFORMANCE_FEE_BPS", uint256(1000));
    }

    function _deploy(Params memory p) internal returns (Deployed memory d) {
        d.vault =
            new DeltaVault(IERC20(p.usdc), "DeltaMon USDC Vault", "dmUSDC", p.admin, p.feeRecipient, p.cap, p.feeBps);
        d.strategy = new DeltaNeutralStrategy(address(d.vault), p.usdc, p.wmon, p.lst, p.admin);
        d.spot = new KuruSpotAdapter(p.kuruRouter, p.admin);
        d.staking = new AprioriStakingAdapter(p.wmon, p.lst);
        d.hedge = new PerplHedgeAdapter(p.perplCollateral, p.perplExchange, p.admin);
        d.oracle = new PythOracle(p.pyth, p.admin, 60);
    }

    function _wire(Params memory p, Deployed memory d) internal {
        d.oracle.setFeed(p.wmon, PYTH_MON_USD);
        d.oracle.setFeed(p.usdc, PYTH_USDC_USD);
        d.oracle.setFeed(p.lst, PYTH_MON_USD); // TODO: compose LST/MON rate feed × MON/USD
        if (p.perplCollateral != p.usdc) d.oracle.setFeed(p.perplCollateral, PYTH_USDC_USD);

        address[] memory markets = new address[](1);
        markets[0] = p.kuruMarket;
        bool[] memory buy = new bool[](1);
        buy[0] = true;
        bool[] memory sell = new bool[](1);
        d.spot.setRoute(p.usdc, p.wmon, markets, buy);
        d.spot.setRoute(p.wmon, p.usdc, markets, sell);

        d.hedge.grantRole(d.hedge.STRATEGY_ROLE(), address(d.strategy));
        d.hedge.grantRole(d.hedge.KEEPER_ROLE(), p.keeper);
        d.strategy.setVenues(d.spot, d.staking, d.hedge, d.oracle);
        d.vault.setStrategy(d.strategy);
        d.vault.grantRole(d.vault.KEEPER_ROLE(), p.keeper);
    }

    function _report(Deployed memory d) internal {
        console2.log("chainId      ", block.chainid);
        console2.log("DeltaVault   ", address(d.vault));
        console2.log("Strategy     ", address(d.strategy));
        console2.log("KuruSpot     ", address(d.spot));
        console2.log("AprioriStake ", address(d.staking));
        console2.log("PerplHedge   ", address(d.hedge));
        console2.log("PythOracle   ", address(d.oracle));

        string memory json = "deployment";
        vm.serializeAddress(json, "vault", address(d.vault));
        vm.serializeAddress(json, "strategy", address(d.strategy));
        vm.serializeAddress(json, "spotVenue", address(d.spot));
        vm.serializeAddress(json, "stakingVenue", address(d.staking));
        vm.serializeAddress(json, "hedgeVenue", address(d.hedge));
        vm.serializeAddress(json, "oracle", address(d.oracle));
        string memory out = vm.serializeUint(json, "deployedAtBlock", block.number);
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
