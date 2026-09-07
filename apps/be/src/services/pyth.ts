import { type Address, type Hex } from "viem";
import { ADDRESSES, PYTH_FEEDS, isSupportedChainId, type Price } from "@deltamon/shared";
import { env } from "../config.js";
import { publicClient } from "../chain.js";

/** Pyth's public Hermes endpoint requires an API key since 2026, so prices are read on-chain. */
const pythAbi = [
  {
    type: "function",
    name: "getPriceUnsafe",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
] as const;

function pythAddress(): Address {
  if (!isSupportedChainId(env.CHAIN_ID))
    throw new Error(`no Pyth address for chain ${env.CHAIN_ID}`);
  return ADDRESSES[env.CHAIN_ID].pyth.priceFeed;
}

export async function getPythPrice(symbol: keyof typeof PYTH_FEEDS): Promise<Price> {
  const feedId = PYTH_FEEDS[symbol] as Hex;
  const p = await publicClient.readContract({
    address: pythAddress(),
    abi: pythAbi,
    functionName: "getPriceUnsafe",
    args: [feedId],
  });
  const scale = 10 ** p.expo;
  return {
    symbol,
    feedId,
    price: Number(p.price) * scale,
    conf: Number(p.conf) * scale,
    publishTime: Number(p.publishTime),
  };
}
