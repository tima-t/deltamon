import { createPublicClient, http, type Address, type Chain } from "viem";

export async function assertContractGas(
  chain: Chain,
  account: Address,
  request: Parameters<ReturnType<typeof createPublicClient>["estimateContractGas"]>[0],
): Promise<void> {
  const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
  const [balance, gas, fees] = await Promise.all([
    client.getBalance({ address: account }),
    client.estimateContractGas({ ...request, account }),
    client.estimateFeesPerGas(),
  ]);
  const price = fees.maxFeePerGas ?? fees.gasPrice;
  if (!price) throw new Error(`Could not check ${chain.name} network gas. Try again.`);
  if (balance < (gas * 120n / 100n) * price) {
    throw new Error(`Add ${chain.nativeCurrency.symbol} to this wallet on ${chain.name} to pay network gas before continuing.`);
  }
}
