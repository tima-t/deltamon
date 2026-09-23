import type { Chain } from "viem";
import { arbitrum, avalanche, base, bsc, gnosis, mainnet, optimism, polygon, xLayer } from "viem/chains";
import { monadMainnet } from "@deltamon/shared";

/** Aurora's EVM blockchain keys paired with the networks this app can read and sign on. */
export const sourceChains: Record<string, Chain> = {
  eth: mainnet,
  arb: arbitrum,
  base,
  gnosis,
  pol: polygon,
  bsc,
  op: optimism,
  avax: avalanche,
  monad: monadMainnet,
  xlayer: xLayer,
};

export const walletChains = [
  monadMainnet,
  mainnet,
  arbitrum,
  base,
  gnosis,
  polygon,
  bsc,
  optimism,
  avalanche,
  xLayer,
] as const;

export function sourceChainById(chainId: number): Chain | undefined {
  return Object.values(sourceChains).find((chain) => chain.id === chainId);
}
