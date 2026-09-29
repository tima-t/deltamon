import { type Address, type Hex, type WalletClient } from "viem";
import { publicClient } from "../chain.js";
import { logger } from "../lib/logger.js";

/**
 * Sending one vault transaction exactly once, across restarts.
 *
 * The hazard is a crash between broadcasting and recording the hash: on resume the step looks
 * unfinished and a naive retry sends it twice. So the nonce is chosen and persisted *before* the
 * send, and the transaction is broadcast with that exact nonce. On resume:
 *
 *   - the account's confirmed nonce is still the pinned one, so nothing was mined and re-sending
 *     with the same nonce is safe; or
 *   - the account has moved past it, so that nonce is spent and the step must not be sent again.
 *
 * The second case is reported rather than assumed successful, because the spent nonce could also
 * belong to a manual transaction from the same address.
 */

export interface PinnedSend {
  nonce: number;
}

export interface SendOutcome {
  txHash: Hex;
  nonce: number;
}

/** The nonce this account will use next, pinned before anything is broadcast. */
export async function pinNonce(address: Address): Promise<number> {
  return publicClient.getTransactionCount({ address, blockTag: "pending" });
}

export type NonceState =
  | { kind: "unused"; confirmed: number }
  | { kind: "spent"; confirmed: number };

/** Whether a pinned nonce has already been consumed by a mined transaction. */
export async function checkNonce(address: Address, pinned: number): Promise<NonceState> {
  const confirmed = await publicClient.getTransactionCount({ address, blockTag: "latest" });
  return confirmed > pinned ? { kind: "spent", confirmed } : { kind: "unused", confirmed };
}

export interface WriteRequest {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

/**
 * Simulates, then broadcasts with the pinned nonce. Simulation is what turns a doomed call into a
 * clean failure before a nonce is burned.
 */
export async function sendPinned(
  wallet: WalletClient,
  request: WriteRequest,
  nonce: number,
): Promise<SendOutcome> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { request: simulated } = await publicClient.simulateContract({
    address: request.address,
    // viem's generic inference is not useful for a runtime-selected function name.
    abi: request.abi as never,
    functionName: request.functionName as never,
    args: request.args as never,
    account,
    nonce,
  });
  const txHash = await wallet.writeContract(simulated as never);
  logger.info({ fn: request.functionName, nonce, txHash }, "vault transaction sent");
  return { txHash, nonce };
}

/** Waits for a receipt and fails loudly on a revert. */
export async function confirm(txHash: Hex): Promise<{ blockNumber: bigint }> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`transaction ${txHash} reverted`);
  return { blockNumber: receipt.blockNumber };
}
