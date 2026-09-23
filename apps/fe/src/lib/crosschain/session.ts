import { isAddress, type Address, type Hex } from "viem";

export const SESSION_KEY = "deltamon.crosschain-deposit.v1";

export interface DepositSession {
  account: Address;
  id: string;
  sourceAssetId: string;
  sourceChainId: number;
  sourceToken: Address;
  sourceName: string;
  amount: string;
  sourceDecimals: number;
  depositAddress: Address;
  deadline?: string;
  sourceTxHash?: Hex;
  initialShares?: string;
  startingBlock?: string;
  recoveryId?: string;
}

export function parseStoredSession(raw: string | null, account: Address): DepositSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DepositSession;
    return value.account?.toLowerCase() === account.toLowerCase() &&
      typeof value.id === "string" &&
      typeof value.sourceChainId === "number" &&
      typeof value.amount === "string" && /^\d+$/.test(value.amount) &&
      isAddress(value.sourceToken) && isAddress(value.depositAddress)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function quoteExpired(deadline: string | undefined, now: number): boolean {
  if (!deadline) return false;
  const expiry = Date.parse(deadline);
  return Number.isFinite(expiry) && now >= expiry;
}

export function depositErrorMessage(error: unknown, sourceChain?: string): string {
  const message = error instanceof Error ? error.message : "The deposit could not continue";
  if (/insufficient funds|insufficient balance.*gas|not enough.*gas/i.test(message)) {
    return `Not enough source-chain gas${sourceChain ? ` on ${sourceChain}` : ""} to send USDC.`;
  }
  if (/user rejected|user denied|rejected by user/i.test(message)) {
    return "The wallet request was declined. You can continue this deposit when ready.";
  }
  return message.split("\n")[0] ?? "The deposit could not continue";
}
