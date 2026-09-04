import { PYTH_FEEDS, PYTH_HERMES_URL, type Price } from "@deltamon/shared";
import { z } from "zod";

const HermesResponse = z.object({
  parsed: z.array(
    z.object({
      id: z.string(),
      price: z.object({
        price: z.string(),
        conf: z.string(),
        expo: z.number().int(),
        publish_time: z.number().int(),
      }),
    }),
  ),
});

function scale(raw: string, expo: number): number {
  return Number(raw) * 10 ** expo;
}

/** Latest price from Pyth Hermes (off-chain read; on-chain reads go through PythOracle.sol). */
export async function getPythPrice(symbol: keyof typeof PYTH_FEEDS): Promise<Price> {
  const feedId = PYTH_FEEDS[symbol];
  const url = new URL("/v2/updates/price/latest", PYTH_HERMES_URL);
  url.searchParams.append("ids[]", feedId);
  url.searchParams.set("parsed", "true");

  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Hermes ${res.status} for ${symbol}`);

  const body = HermesResponse.parse(await res.json());
  const entry = body.parsed[0];
  if (!entry) throw new Error(`Hermes returned no price for ${symbol}`);

  return {
    symbol,
    feedId,
    price: scale(entry.price.price, entry.price.expo),
    conf: scale(entry.price.conf, entry.price.expo),
    publishTime: entry.price.publish_time,
  };
}
