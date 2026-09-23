import { parseEventLogs, type Address, type Log } from "viem";
import { deltaMonVaultAbi } from "@deltamon/shared";

/** Read the actual USDC paid by the vault, after performance fees, from a confirmed receipt. */
export function redemptionPayout(
  logs: readonly Log[] | undefined,
  vault: Address | undefined,
  receiver: Address | undefined,
): bigint | undefined {
  if (!logs || !vault || !receiver) return undefined;
  const events = parseEventLogs({ abi: deltaMonVaultAbi, eventName: "Withdraw", logs: [...logs] });
  return events.find(
    (event) =>
      event.address.toLowerCase() === vault.toLowerCase() &&
      event.args.receiver.toLowerCase() === receiver.toLowerCase(),
  )?.args.assets;
}
