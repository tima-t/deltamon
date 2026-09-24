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
    vault: "0x9165D1698B7Bd11E702a36874c3047331B7fA213",
    spotVenue: "0xCedB2Fb595a748e19172aa8B7261F6976C49f170",
    oracle: "0xb606682137e747D8E79398870407E60A5C603611",
    admin: "0x6f69cf4Be38aFEA938F73a88f10991Da4b5E2A7B",
    deployer: "0x6f69cf4Be38aFEA938F73a88f10991Da4b5E2A7B",
    keeper: "0x6f69cf4Be38aFEA938F73a88f10991Da4b5E2A7B",
    deployedAtBlock: 107645440,
  },
};

export function getDeployment(chainId: number): Deployment | undefined {
  return DEPLOYMENTS[chainId];
}
