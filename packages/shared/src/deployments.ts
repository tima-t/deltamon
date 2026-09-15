import type { Address } from "viem";

/**
 * DeltaMon's own deployed contracts. Filled from
 * packages/contracts/deployments/deltamon-<chainId>.json after each deploy.
 */
export interface Deployment {
  vault: Address;
  spotVenue: Address;
  oracle: Address;
  /** The multisig that owns the vault once it has called acceptOwnership(). */
  admin: Address;
  deployer: Address;
  /** The backend keeper, or the zero address if none was set at deploy. */
  keeper: Address;
  deployedAtBlock: number;
}

export const DEPLOYMENTS: Partial<Record<number, Deployment>> = {
  // 143: { vault: "0x...", spotVenue: "0x...", oracle: "0x...", admin: "0x...", deployer: "0x...", keeper: "0x...", deployedAtBlock: 0 },
};

export function getDeployment(chainId: number): Deployment | undefined {
  return DEPLOYMENTS[chainId];
}
