import type { Address } from "viem";

/**
 * DeltaMon's own deployed contracts. Filled in by `forge script` output
 * (packages/contracts/deployments/<chainId>.json) — update after each deploy.
 */
export interface Deployment {
  vault: Address;
  strategy: Address;
  spotVenue: Address;
  hedgeVenue: Address;
  stakingVenue: Address;
  oracle: Address;
  deployedAtBlock: number;
}

export const DEPLOYMENTS: Partial<Record<number, Deployment>> = {
  // 10143: { vault: "0x...", strategy: "0x...", ... },
};

export function getDeployment(chainId: number): Deployment | undefined {
  return DEPLOYMENTS[chainId];
}
