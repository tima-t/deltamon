/**
 * Order frames for Perpl's trading socket (mt 22), and the scaling the market config demands.
 *
 * Sizes and prices are integers scaled by the market's own decimals, which are read from
 * /v1/pub/context rather than hardcoded: MON is market 10 today with price_decimals 6 and
 * size_decimals 0, but both are config and both have changed before.
 *
 * Docs: https://github.com/PerplFoundation/api-docs (websocket.md)
 */

/** mt 22 `t`. Only the short side is exposed; the vault's hedge is never long. */
export const ORDER_TYPE = {
  openLong: 1,
  openShort: 2,
  closeLong: 3,
  closeShort: 4,
  cancel: 5,
  increaseCollateral: 6,
  change: 7,
} as const;

/** mt 22 `tpc`. A short is protected above and taken below, both against the mark. */
export const TRIGGER = {
  gteLast: 1,
  lteLast: 2,
  gteMark: 3,
  lteMark: 4,
} as const;

export interface MarketConfig {
  id: number;
  name: string;
  priceDecimals: number;
  sizeDecimals: number;
  orderTtlBlocks: number;
  isOpen: boolean;
  /** Mark price, scaled by priceDecimals. Null when the venue has not published one. */
  markPrice: number | null;
  /** Funding rate for one interval, as Perpl publishes it. */
  fundingRate: number | null;
  fundingIntervalSec: number | null;
  /** Running cumulative funding, the counterpart to a position's entry funding sum. */
  fundingSum: number | null;
  /** Extra exponent on the funding sum, on top of priceDecimals. */
  fundingSumScalingExp: number;
  /** When funding last settled, unix ms, so the next one can be anticipated. */
  fundingLastAtMs: number | null;
  /** Fraction of notional that must remain, in ten-thousandths. */
  maintenanceMargin: number | null;
  initialMargin: number | null;
}

/**
 * Decimal string to a scaled integer, without going through a float. `1.5` at 2 decimals is 150.
 * Extra precision the market cannot express is an error rather than a silent rounding.
 */
export function scale(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`not a positive decimal: ${value}`);
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.replace(/0+$/, "").length > decimals) {
    throw new Error(`${value} is finer than the market's ${decimals} decimals`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0").slice(0, decimals));
}

export function unscale(value: bigint | string, decimals: number): string {
  const raw = BigInt(value);
  if (decimals === 0) return raw.toString();
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
  const out = `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/\.?0+$/, "");
  return negative ? `-${out}` : out;
}

/** Perpl requires leverage on every order and has no default. Hundredths, so 100 is 1x. */
export const DEFAULT_LEVERAGE = 100;
/** mt 22 `fl`. Required, no default. 0 is GoodTillCancel. */
export const FLAG_GTC = 0;

export interface ShortRequest {
  market: MarketConfig;
  /** Size in whole units of the market's size_units, as a decimal string. */
  size: string;
  /** Hundredths, so 10x is 1000. Required by Perpl; defaults to 1x here. */
  leverage?: number;
  /** Trigger prices as decimal strings. A short stops out above and takes profit below. */
  stopLoss?: string;
  takeProfit?: string;
}

/**
 * Sizes and prices go on the wire as JSON numbers, never strings. Perpl's deserializer refuses a
 * string and drops the whole connection with a 1011 rather than answering, so an order sent that
 * way looks accepted locally and never exists on the exchange.
 */
export interface OrderFrame {
  mt: 22;
  mkt: number;
  t: number;
  /** Limit price scaled by the market's price decimals, 0 for market. */
  p: number;
  /** Size scaled by the market's size decimals. */
  s: number;
  rq: number;
  sn: number;
  lb: number;
  /** Required by Perpl, must be above zero. */
  lv: number;
  /** Required by Perpl, no default. */
  fl: number;
  tp?: number;
  tpc?: number;
  lp?: number;
}

/** A scaled integer as a JSON number, refusing anything a double cannot hold exactly. */
export function wireInt(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${what} is too large to send exactly`);
  }
  return Number(value);
}

/**
 * The entry plus any triggers that protect it. Triggers carry `lb: 0`, since the server assigns
 * their execution window when they activate rather than when they are posted, and they are linked
 * to the position so closing it takes them with it.
 */
export function openShortFrames(
  req: ShortRequest,
  nextRequestId: () => number,
  nextSeq: () => number,
  positionId?: number,
): OrderFrame[] {
  if (!req.market.isOpen) throw new Error(`${req.market.name} is closed on Perpl`);
  const size = scale(req.size, req.market.sizeDecimals);
  if (size <= 0n) throw new Error("size must be above zero");

  const leverage = req.leverage ?? DEFAULT_LEVERAGE;
  if (leverage <= 0) throw new Error("leverage must be above zero");

  const entry: OrderFrame = {
    mt: 22,
    mkt: req.market.id,
    t: ORDER_TYPE.openShort,
    p: 0, // market order
    s: wireInt(size, "size"),
    rq: nextRequestId(),
    sn: nextSeq(),
    lb: 0, // market default window
    lv: leverage,
    fl: FLAG_GTC,
  };

  const frames = [entry];
  const protective = (price: string, condition: number): OrderFrame => ({
    mt: 22,
    mkt: req.market.id,
    t: ORDER_TYPE.closeShort,
    p: 0,
    s: wireInt(size, "size"),
    rq: nextRequestId(),
    sn: nextSeq(),
    lb: 0,
    lv: leverage,
    fl: FLAG_GTC,
    tp: wireInt(scale(price, req.market.priceDecimals), "trigger price"),
    tpc: condition,
    ...(positionId === undefined ? {} : { lp: positionId }),
  });

  // A short loses as the price climbs, so the stop sits above and the target below.
  if (req.stopLoss !== undefined) frames.push(protective(req.stopLoss, TRIGGER.gteMark));
  if (req.takeProfit !== undefined) frames.push(protective(req.takeProfit, TRIGGER.lteMark));
  return frames;
}

export function closeShortFrame(
  market: MarketConfig,
  size: string,
  nextRequestId: () => number,
  nextSeq: () => number,
  leverage = DEFAULT_LEVERAGE,
): OrderFrame {
  const scaled = scale(size, market.sizeDecimals);
  if (scaled <= 0n) throw new Error("size must be above zero");
  return {
    mt: 22,
    mkt: market.id,
    t: ORDER_TYPE.closeShort,
    p: 0,
    s: wireInt(scaled, "size"),
    rq: nextRequestId(),
    sn: nextSeq(),
    lb: 0,
    lv: leverage,
    fl: FLAG_GTC,
  };
}

/**
 * Margin utilization from what the socket actually publishes. Perpl sends available and locked
 * balance but no equity or margin figure, so this is locked over the total the account controls,
 * and is labelled that way in the UI rather than dressed up as an exchange number.
 */
export function marginUtilization(available: string, locked: string): number | null {
  try {
    const free = BigInt(available);
    const held = BigInt(locked);
    const total = free + held;
    if (total <= 0n) return null;
    return Number((held * 10_000n) / total) / 100;
  } catch {
    return null;
  }
}
