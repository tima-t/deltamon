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
  143: {
    vault: "0x4ce4FA54196F132D928F1ae76db074C14E0203a3",
    spotVenue: "0x06b78F0f747f3cf2D086f4EeCD30c3e89321c562",
    oracle: "0x4dFB13DA673bcCfAD237EA6d90d5B1525aBF287F",
    admin: "0x6f69cf4Be38aFEA938F73a88f10991Da4b5E2A7B",
    deployer: "0x6f69cf4Be38aFEA938F73a88f10991Da4b5E2A7B",
    keeper: "0x6f69cf4Be38aFEA938F73a88f10991Da4b5E2A7B",
    deployedAtBlock: 105316612,
  },
};

export function getDeployment(chainId: number): Deployment | undefined {
  return DEPLOYMENTS[chainId];
}
