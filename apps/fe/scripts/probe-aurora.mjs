import { existsSync, readFileSync } from "node:fs";

const localEnv = new URL("../.env.local", import.meta.url);
const env = readFileSync(existsSync(localEnv) ? localEnv : new URL("../.env", import.meta.url), "utf8");
const key = process.env.AURORA_INTENTS_API_KEY || env.match(/^AURORA_INTENTS_API_KEY=(.*)$/m)?.[1]?.trim();
if (!key) throw new Error("Add AURORA_INTENTS_API_KEY to apps/fe/.env");

const base = "https://intents-connect-api.aurora.dev/api/v1";
const account = "0x1111111111111111111111111111111111111111";
const vault = "0x4ce4FA54196F132D928F1ae76db074C14E0203a3";
const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const catalogResponse = await fetch(`${base}/supported_tokens`);
const catalog = await catalogResponse.json();
if (!catalogResponse.ok) throw new Error(`Catalog request failed: ${catalogResponse.status}`);
const source = catalog.result?.in?.find((token) => token.blockchain === "base" && token.symbol === "USDC");
const destination = catalog.result?.out?.find(
  (token) => token.blockchain === "monad" && token.contractAddress?.toLowerCase() === usdc.toLowerCase(),
);
if (!source || !destination) throw new Error("Base or Monad USDC is missing from Aurora catalog");

const makeBody = (amount) => ({
    version: "1.0",
    type: "evm",
    dry: true,
    metadata: { title: "DeltaMon vault route probe", intent: "deltamon_deposit_probe" },
    quote: {
      amount: "10000000",
      originAsset: source.assetId,
      destinationAsset: destination.assetId,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    steps: [
      { to: usdc, functionSignature: "approve(address,uint256)", parameters: [vault, amount], value: "0" },
      { to: vault, functionSignature: "deposit(uint256,address)", parameters: [amount, account], value: "0" },
    ],
  });
const post = (body) => fetch(`${base}/executions/${account}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": key },
  body: JSON.stringify(body),
});
const response = await post(makeBody("{MIN_AMOUNT_OUT}"));
const data = await response.json().catch(() => ({}));
const fee = BigInt(data.result?.details?.networkFee ?? "0");
const minimum = BigInt(data.result?.quote?.minAmountOut ?? "0");
const safeAmount = minimum > fee * 2n ? (minimum - fee * 2n).toString() : null;
const fixedResponse = safeAmount && response.ok ? await post(makeBody(safeAmount)) : null;
const fixed = fixedResponse ? await fixedResponse.json().catch(() => ({})) : null;
console.log(JSON.stringify({
  status: response.status,
  error: data.error ?? data.message ?? data.result?.error,
  resultKeys: data.result ? Object.keys(data.result) : [],
  quote: data.result?.quote,
  details: data.result?.details && {
    networkFee: data.result.details.networkFee,
    serviceFee: data.result.details.serviceFee,
    payloadStandard: data.result.details.payload?.standard,
  },
  steps: data.result?.steps,
  feeSafeDryRun: fixedResponse && {
    status: fixedResponse.status,
    error: fixed?.error,
    depositAmount: safeAmount,
    minAmountOut: fixed?.result?.quote?.minAmountOut,
    networkFee: fixed?.result?.details?.networkFee,
    steps: fixed?.result?.steps,
  },
}, null, 2));
if (!response.ok || (fixedResponse && !fixedResponse.ok)) process.exitCode = 1;
