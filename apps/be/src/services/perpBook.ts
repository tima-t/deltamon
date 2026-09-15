import { z } from "zod";

/**
 * The perp book as published by whoever runs the short leg: the total value every perp manager
 * holds, wallet balances plus Perpl account equity, in the vault's asset units (USDC, 6 decimals).
 *
 * Perpl only exposes account equity over its authenticated WebSocket, so the keeper does not read
 * Perpl itself. The manager's bot already holds that connection and publishes this document:
 *
 *   { "equity": "1234500000", "asOf": 1726300000 }
 *
 * `equity` is a decimal string of asset units, `asOf` the unix second it was measured.
 */
const PerpBookSchema = z.object({
  equity: z.string().regex(/^\d+$/),
  asOf: z.number().int().positive(),
});

export interface PerpBook {
  equity: bigint;
  asOfSec: bigint;
}

export async function fetchPerpBook(url: string): Promise<PerpBook> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`perp book feed ${res.status}`);
  const body = PerpBookSchema.parse(await res.json());
  return { equity: BigInt(body.equity), asOfSec: BigInt(body.asOf) };
}
