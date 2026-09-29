import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById } from "@deltamon/shared";
import { env } from "./config.js";

export const chain = chainById(env.CHAIN_ID);

export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(env.RPC_URL),
  batch: { multicall: true },
});

let walletClient: WalletClient | null | undefined;

/** Returns a signer for the keeper, or null when no key is configured (dry-run). */
export function getKeeperWallet(): WalletClient | null {
  if (walletClient !== undefined) return walletClient;
  if (!env.KEEPER_PRIVATE_KEY) {
    walletClient = null;
    return walletClient;
  }
  const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY as Hex);
  walletClient = createWalletClient({ account, chain, transport: http(env.RPC_URL) });
  return walletClient;
}

let adminClient: WalletClient | null | undefined;

/**
 * Signs the automation's vault transactions. Null when ADMIN_PRIVATE_KEY is unset, which is how
 * the pipeline stays inert on a machine that should not be trading.
 */
export function getAdminWallet(): WalletClient | null {
  if (adminClient !== undefined) return adminClient;
  if (!env.ADMIN_PRIVATE_KEY) {
    adminClient = null;
    return adminClient;
  }
  const account = privateKeyToAccount(env.ADMIN_PRIVATE_KEY as Hex);
  adminClient = createWalletClient({ account, chain, transport: http(env.RPC_URL) });
  return adminClient;
}

let managerClient: WalletClient | null | undefined;

/**
 * Signs for the perp manager's own wallet, which is what puts AUSD into Perpl. Null when no key is
 * configured, in which case the pipeline stops before the deposit rather than opening a short it
 * cannot margin.
 */
export function getManagerWallet(): WalletClient | null {
  if (managerClient !== undefined) return managerClient;
  if (!env.PERP_MANAGER_PRIVATE_KEY) {
    managerClient = null;
    return managerClient;
  }
  const account = privateKeyToAccount(env.PERP_MANAGER_PRIVATE_KEY as Hex);
  managerClient = createWalletClient({ account, chain, transport: http(env.RPC_URL) });
  return managerClient;
}
