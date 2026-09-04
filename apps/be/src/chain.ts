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
