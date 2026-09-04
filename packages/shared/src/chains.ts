import { defineChain, type Chain } from "viem";

/** Monad mainnet. https://docs.monad.xyz/developer-essentials/network-information */
export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.monad.xyz"],
      webSocket: ["wss://rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://monadvision.com" },
    monadscan: { name: "Monadscan", url: "https://monadscan.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

/** Monad testnet. Faucet: https://faucet.monad.xyz */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const SUPPORTED_CHAINS = [monadMainnet, monadTestnet] as const satisfies readonly Chain[];
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]["id"];

export function isSupportedChainId(id: number): id is SupportedChainId {
  return SUPPORTED_CHAINS.some((c) => c.id === id);
}

export function chainById(id: number): Chain {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === id);
  if (!chain)
    throw new Error(`Unsupported chain id ${id}. Supported: 143 (Monad), 10143 (Monad Testnet)`);
  return chain;
}
