import type { Address, Hex } from "viem";

/**
 * Third-party contract addresses on Monad, sourced from the Monad Foundation
 * registry (https://github.com/monad-crypto/protocols) and protocol docs.
 * Keep this file as the single source of truth for both FE and BE.
 */
export const ADDRESSES = {
  143: {
    tokens: {
      WMON: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
      USDC: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      USDT0: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
      AUSD: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
      /** aPriori liquid staked MON */
      aprMON: "0x0c65A0BC65a5D819235B71F554D210D3F80E0852",
      /** Kintsu liquid staked MON (proxy) */
      sMON: "0xA3227C5969757783154C60bF0bC1944180ed81B9",
      /** Magma liquid staked MON */
      gMON: "0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081",
    },
    /** Kuru — on-chain CLOB spot DEX + aggregator (hackathon sponsor). */
    kuru: {
      router: "0xd651346d7c789536ebf06dc72aE3C8502cd695CC",
      marginAccount: "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5",
      flowRouterV2: "0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2",
      markets: {
        MON_USDC: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
        MON_AUSD: "0x131a2e70a5b31a517a74b8c567149bc294470da9",
        AUSD_USDC: "0x699abc15308156e9a3ab89ec7387e9cfe1c86a3b",
        WETH_USDC: "0xa6aFD386135B7D41A6C40C525abC4A1019b0D132",
      },
    },
    /** Perpl — on-chain CLOB perpetuals. Collateral is AUSD. */
    perpl: {
      exchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
      collateral: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    },
    aaveV3: {
      pool: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
      poolAddressesProvider: "0x34793Fb9935F7bB5E5aE920fb963F39063E7A615",
      protocolDataProvider: "0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad",
      oracle: "0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf",
    },
    morpho: {
      morpho: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
      metaMorphoV1_1Factory: "0x33f20973275B2F574488b18929cd7DCBf1AbF275",
    },
    uniswap: {
      swapRouter02: "0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900",
      quoterV2: "0x661e93cca42afacb172121ef892830ca3b70f08d",
      universalRouter: "0x0d97dc33264bfc1c226207428a79b26757fb9dc3",
    },
    pyth: {
      /** Pull oracle endpoint (current). */
      priceFeed: "0x2880aB155794e7179c9eE2e38200202908C17B43",
      /** Post-Aug-2026 Pyth Core upgrade address; recommended for new integrations. */
      priceFeedUpgraded: "0xB754BA51E3861Ac0Cb67f73CD046dE790A36508d",
    },
    chainlink: {
      MON_USD: "0xBcD78f76005B7515837af6b50c7C52BCf73822fb",
      USDC_USD: "0xf5F15f188AbCb0d165D1Edb7f37F7d6fA2fCebec",
      USDT_USD: "0x1a1Be4c184923a6BFF8c27cfDf6ac8bDE4DE00FC",
      APRMON_MON: "0xc744776cAF11982a4c632121E0f6E2543f42FA47",
      SMON_MON: "0x056d0eF95A4e046D028b00E6eC00bB4A8b1eBb96",
      GMON_MON: "0xf97dfEd6Aa4cc387aBC5d47F0062A91CB4E4A755",
    },
    canonical: {
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
      permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      createX: "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed",
    },
  },
  10143: {
    tokens: {
      WMON: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701",
      /** Circle USDC on Monad testnet */
      USDC: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
    },
    kuru: {
      router: "0x7EFbE105Ca7415dE98F96622173458ac1c054630",
      marginAccount: "0xd029C2D98ff85D8F64799017fE00a59B1159CE02",
      /** Kuru's own test USDC (differs from Circle testnet USDC). */
      testUSDC: "0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570",
      markets: {
        MON_USDC: "0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9",
      },
    },
    perpl: {
      exchange: "0x1964c32f0be608e7d29302aff5e61268e72080cc",
      collateral: "0xdf5b718d8fcc173335185a2a1513ee8151e3c027",
    },
    pyth: {
      priceFeed: "0x2880aB155794e7179c9eE2e38200202908C17B43",
      priceFeedUpgraded: "0xFC6bd9F9f0c6481c6Af3A7Eb46b296A5B85ed379",
    },
    canonical: {
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
      permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      createX: "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed",
    },
  },
} as const satisfies Record<number, Record<string, unknown>>;

export type AddressBook = typeof ADDRESSES;

/** Pyth price feed ids (32 bytes). Same ids on every chain. */
export const PYTH_FEEDS = {
  MON_USD: "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1",
  USDC_USD: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  AUSD_USD: "0xd9912df360b5b7f21a122f15bdd5e27f62ce5e72bd316c291f7c86620e07fb2a",
  BTC_USD: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH_USD: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
} as const satisfies Record<string, Hex>;

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
