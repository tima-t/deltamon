import { createPublicClient, erc20Abi, http, isAddress, type Address } from "viem";
import { ADDRESSES } from "@deltamon/shared";
import { sourceChains } from "./chains";

const TOKENS_URL = "https://intents-connect-api.aurora.dev/api/v1/supported_tokens";
const MONAD_USDC = ADDRESSES[143].tokens.USDC.toLowerCase();
const BALANCE_CONCURRENCY = 4;
const BALANCE_TIMEOUT_MS = 3_500;

export interface CrossChainAsset {
  assetId: string;
  blockchain: string;
  chainId: number;
  chainName: string;
  contractAddress: Address;
  decimals: number;
}

interface AuroraToken {
  assetId?: unknown;
  symbol?: unknown;
  blockchain?: unknown;
  contractAddress?: unknown;
  decimals?: unknown;
}

function tokenList(value: unknown): AuroraToken[] {
  return Array.isArray(value) ? value : [];
}

async function withTimeout<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Balance read timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getCrossChainCatalog(): Promise<{
  sources: CrossChainAsset[];
  destinationAssetId: string;
}> {
  const response = await fetch(TOKENS_URL, {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Aurora token catalog returned ${response.status}`);
  const data = (await response.json()) as { result?: { in?: unknown; out?: unknown } };
  const input = tokenList(data.result?.in);
  const output = tokenList(data.result?.out);
  const destination = output.find(
    (token) =>
      token.blockchain === "monad" &&
      token.symbol === "USDC" &&
      typeof token.contractAddress === "string" &&
      token.contractAddress.toLowerCase() === MONAD_USDC &&
      typeof token.assetId === "string",
  );
  if (!destination || typeof destination.assetId !== "string") {
    throw new Error("The vault's Monad USDC is unavailable as an Aurora output asset");
  }

  const sources: CrossChainAsset[] = input.flatMap((token) => {
    if (
      token.symbol !== "USDC" ||
      typeof token.blockchain !== "string" ||
      typeof token.assetId !== "string" ||
      typeof token.contractAddress !== "string" ||
      !isAddress(token.contractAddress) ||
      typeof token.decimals !== "number" ||
      !Number.isInteger(token.decimals)
    ) {
      return [];
    }
    const chain = sourceChains[token.blockchain];
    if (!chain) return [];
    return [{
      assetId: token.assetId,
      blockchain: token.blockchain,
      chainId: chain.id,
      chainName: chain.name,
      contractAddress: token.contractAddress as Address,
      decimals: token.decimals,
    }];
  });

  return { sources, destinationAssetId: destination.assetId };
}

export interface FundedAsset extends CrossChainAsset {
  balance: string | null;
  error?: string;
}

export async function getFundedAssets(address: Address): Promise<FundedAsset[]> {
  const { sources } = await getCrossChainCatalog();
  const results = new Array<FundedAsset>(sources.length);
  let next = 0;
  async function worker() {
    while (next < sources.length) {
      const index = next++;
      const asset = sources[index]!;
      const chain = sourceChains[asset.blockchain];
      if (!chain) {
        results[index] = { ...asset, balance: null, error: "Unsupported source chain" };
        continue;
      }
      try {
        const client = createPublicClient({
          chain,
          transport: http(chain.rpcUrls.default.http[0], { retryCount: 0, timeout: BALANCE_TIMEOUT_MS }),
        });
        const balance = await withTimeout(
          client.readContract({
            address: asset.contractAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }),
          BALANCE_TIMEOUT_MS,
        );
        results[index] = { ...asset, balance: balance.toString() };
      } catch {
        results[index] = { ...asset, balance: null, error: "Balance unavailable" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BALANCE_CONCURRENCY, sources.length) }, () => worker()));
  return results.filter((asset) => asset.balance === null || BigInt(asset.balance) > 0n);
}
