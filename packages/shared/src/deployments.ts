import type { Address } from "viem";

/**
 * DeltaMon's own deployed contracts (v1 sdMON vault). Filled from
 * packages/contracts/deployments/sdmon-<chainId>.json after each deploy.
 */
export interface Deployment {
  vault: Address;
  spotVenue: Address;
  oracle: Address;
  deployedAtBlock: number;
}

export const DEPLOYMENTS: Partial<Record<number, Deployment>> = {
  // 143: { vault: "0x...", spotVenue: "0x...", oracle: "0x...", deployedAtBlock: 0 },
};

export function getDeployment(chainId: number): Deployment | undefined {
  return DEPLOYMENTS[chainId];
}
