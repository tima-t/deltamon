import "server-only";

import {
  createPublicClient,
  erc20Abi,
  http,
  isAddress,
  parseAbi,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import { ADDRESSES, deltaMonVaultAbi, getDeployment, monadMainnet } from "@deltamon/shared";
import { getCrossChainCatalog, type CrossChainAsset } from "./catalog";
import { sourceChains } from "./chains";

const AURORA_URL = "https://intents-connect-api.aurora.dev/api/v1";
const vaultAddress = (process.env.NEXT_PUBLIC_VAULT_ADDRESS || getDeployment(143)?.vault) as
  | Address
  | undefined;
const usdcAddress = ADDRESSES[143].tokens.USDC;
const monadClient = createPublicClient({ chain: monadMainnet, transport: http() });

export class DepositError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function parseAccount(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new DepositError("Connect an EVM wallet first");
  }
  return value;
}

export function parseInput(value: unknown): {
  account: Address;
  sourceAssetId: string;
  amount: bigint;
  minAcceptedOutput: bigint;
} {
  if (!value || typeof value !== "object") throw new DepositError("Invalid deposit request");
  const body = value as Record<string, unknown>;
  const account = parseAccount(body.account);
  if (typeof body.sourceAssetId !== "string") throw new DepositError("Select a USDC source");
  if (typeof body.amount !== "string" || !/^\d+$/.test(body.amount)) {
    throw new DepositError("Enter a valid USDC amount");
  }
  const amount = BigInt(body.amount);
  if (amount <= 0n) throw new DepositError("Enter a USDC amount above zero");
  const minAcceptedOutput =
    typeof body.minAcceptedOutput === "string" && /^\d+$/.test(body.minAcceptedOutput)
      ? BigInt(body.minAcceptedOutput)
      : 0n;
  return { account, sourceAssetId: body.sourceAssetId, amount, minAcceptedOutput };
}

export async function auroraRequest<T>(path: string, init?: RequestInit, keyed = false): Promise<T> {
  const key = process.env.AURORA_INTENTS_API_KEY;
  if (keyed && !key) throw new DepositError("Cross-chain deposits are not configured yet", 503);
  const response = await fetch(`${AURORA_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(keyed ? { "x-api-key": key! } : {}),
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new DepositError(data.error || `Aurora returned ${response.status}`, response.status);
  }
  return data;
}

interface AuroraExecution {
  result: {
    id?: string;
    status?: string;
    quote?: {
      minAmountOut?: string;
      amountOut?: string;
      amountIn?: string;
      depositAddress?: string;
      deadline?: string;
    };
    details?: {
      networkFee?: string;
      serviceFee?: string;
      payload?: { payload_json?: string; standard?: string };
    };
    destinationChainTxHashes?: string[];
    originChainTxHashes?: string[];
    steps?: unknown[];
  };
}

export async function fetchExecution(account: Address, id: string): Promise<AuroraExecution> {
  const response = await auroraRequest<{ result?: AuroraExecution["result"][] }>(
    `/executions/${account}?id=${encodeURIComponent(id)}`,
  );
  const execution = response.result?.find((item) => item.id === id);
  if (!execution) throw new DepositError("Execution not found", 404);
  return { result: execution };
}

export async function getIntermediary(account: Address): Promise<Address> {
  const data = await auroraRequest<{ result?: { evm?: string } }>(
    `/executions/${account}/intermediary`,
  );
  const address = data.result?.evm;
  if (!address || !isAddress(address)) throw new DepositError("Aurora intermediary is unavailable", 502);
  return address;
}

export async function assertEoa(account: Address, asset: CrossChainAsset): Promise<void> {
  const source = sourceChains[asset.blockchain];
  if (!source) throw new DepositError("Unsupported source chain");
  const sourceClient = createPublicClient({ chain: source, transport: http(source.rpcUrls.default.http[0]) });
  const [sourceCode, monadCode] = await Promise.all([
    sourceClient.getCode({ address: account }),
    monadClient.getCode({ address: account }),
  ]);
  if ((sourceCode && sourceCode !== "0x") || (monadCode && monadCode !== "0x")) {
    throw new DepositError("Cross-chain deposits currently support standard EVM wallets only");
  }
}

export async function checkVaultDeposit(account: Address, amount: bigint): Promise<string> {
  if (!vaultAddress || !isAddress(vaultAddress)) {
    throw new DepositError("The Monad vault is not configured", 503);
  }
  const [minimum, maximum, preview] = await Promise.all([
    monadClient.readContract({ address: vaultAddress, abi: deltaMonVaultAbi, functionName: "minDeposit" }),
    monadClient.readContract({
      address: vaultAddress,
      abi: deltaMonVaultAbi,
      functionName: "maxDeposit",
      args: [account],
    }),
    monadClient.readContract({
      address: vaultAddress,
      abi: deltaMonVaultAbi,
      functionName: "previewDeposit",
      args: [amount],
    }),
  ]);
  if (amount < minimum) throw new DepositError("The amount reaching Monad is below the vault minimum");
  if (amount > maximum) throw new DepositError("The vault cannot accept this deposit now");
  return preview.toString();
}

export async function requestDepositExecution(input: ReturnType<typeof parseInput>, dry: boolean) {
  if (process.env.AURORA_CROSSCHAIN_ENABLED !== "true") {
    throw new DepositError("Cross-chain vault deposits are awaiting a live route check", 503);
  }
  const { sources, destinationAssetId } = await getCrossChainCatalog();
  const source = sources.find((asset) => asset.assetId === input.sourceAssetId);
  if (!source) throw new DepositError("This USDC route is no longer supported");
  if (source.chainId === 143) throw new DepositError("Use the direct Monad deposit for this balance");
  await assertEoa(input.account, source);
  if (!vaultAddress || !isAddress(vaultAddress)) {
    throw new DepositError("The Monad vault is not configured", 503);
  }
  const body = {
    version: "1.0",
    type: "evm",
    dry: true,
    metadata: { title: "Deposit USDC into DeltaMon", intent: "deltamon_deposit" },
    quote: {
      amount: input.amount.toString(),
      originAsset: source.assetId,
      destinationAsset: destinationAssetId,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    steps: [
      {
        to: usdcAddress,
        functionSignature: "approve(address,uint256)",
        parameters: [vaultAddress, "{MIN_AMOUNT_OUT}"],
        value: "0",
      },
      {
        to: vaultAddress,
        functionSignature: "deposit(uint256,address)",
        parameters: ["{MIN_AMOUNT_OUT}", input.account],
        value: "0",
      },
    ],
  };
  const estimate = await auroraRequest<AuroraExecution>(
    `/executions/${input.account}`,
    { method: "POST", body: JSON.stringify(body) },
    true,
  );
  const output = estimate.result.quote?.minAmountOut;
  const feeText = estimate.result.details?.networkFee;
  if (!output || !/^\d+$/.test(output) || !feeText || !/^\d+$/.test(feeText)) {
    throw new DepositError("Aurora did not return a minimum output and destination fee", 502);
  }
  const minimum = BigInt(output);
  const estimatedFee = BigInt(feeText);
  if (minimum <= estimatedFee * 2n) throw new DepositError("This route's output cannot cover the Monad execution fee");
  // Aurora appends a fee transfer after the vault call. Reserve twice the estimated fee
  // so that even the minimum output can fund both the vault deposit and that transfer.
  const depositAmount = minimum - estimatedFee * 2n;
  if (depositAmount < input.minAcceptedOutput) {
    throw new DepositError("The quote changed. Review the new amount before continuing");
  }
  const minShares = await checkVaultDeposit(input.account, depositAmount);
  const fixedSteps = [
    { to: usdcAddress, functionSignature: "approve(address,uint256)", parameters: [vaultAddress, depositAmount.toString()], value: "0" },
    { to: vaultAddress, functionSignature: "deposit(uint256,address)", parameters: [depositAmount.toString(), input.account], value: "0" },
  ];
  const [block, existingShares] = dry
    ? [undefined, undefined]
    : await Promise.all([
        monadClient.getBlockNumber(),
        monadClient.readContract({ address: vaultAddress, abi: deltaMonVaultAbi, functionName: "balanceOf", args: [input.account] }),
      ]);
  const startingBlock = block?.toString();
  const initialShares = existingShares?.toString();
  const execution = await auroraRequest<AuroraExecution>(
    `/executions/${input.account}`,
    { method: "POST", body: JSON.stringify({ ...body, dry, steps: fixedSteps }) },
    true,
  );
  const finalMinimum = execution.result.quote?.minAmountOut;
  const finalFee = execution.result.details?.networkFee;
  if (!finalMinimum || !/^\d+$/.test(finalMinimum) || !finalFee || !/^\d+$/.test(finalFee) || BigInt(finalMinimum) < depositAmount + BigInt(finalFee)) {
    throw new DepositError("Aurora's final quote cannot cover the vault deposit and execution fee");
  }
  await checkVaultDeposit(input.account, depositAmount);
  if (!dry && (!execution.result.id || !execution.result.quote?.depositAddress)) {
    throw new DepositError("Aurora did not return a deposit address", 502);
  }
  return { execution: execution.result, source, minShares, depositAmount: depositAmount.toString(), startingBlock, initialShares };
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function signatureToAurora(signature: Hex): string {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new DepositError("Invalid wallet signature");
  const bytes = Buffer.from(signature.slice(2), "hex");
  if (bytes[64] === 27 || bytes[64] === 28) bytes[64] -= 27;
  if (bytes[64] !== 0 && bytes[64] !== 1) throw new DepositError("Invalid wallet signature recovery bit");
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return `secp256k1:${encoded}`;
}

export async function submitSignature(account: Address, id: string, signature: Hex) {
  const execution = await fetchExecution(account, id);
  const message = execution.result.details?.payload?.payload_json;
  if (!message || execution.result.details?.payload?.standard !== "erc191") {
    throw new DepositError("Aurora did not return an EVM signing payload", 502);
  }
  const recovered = await recoverMessageAddress({ message, signature });
  if (recovered.toLowerCase() !== account.toLowerCase()) {
    throw new DepositError("The signature does not match the connected wallet");
  }
  return auroraRequest(
    `/executions/${account}/submit`,
    {
      method: "POST",
      body: JSON.stringify({ executionId: id, signature: signatureToAurora(signature) }),
    },
  );
}

export const transferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
export { vaultAddress, usdcAddress, monadClient, erc20Abi };
