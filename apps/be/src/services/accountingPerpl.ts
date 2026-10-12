import { createHash } from "node:crypto";
import { formatUnits } from "viem";
import { z } from "zod";
import { env } from "../config.js";
import { findMarket } from "./perplAccounts.js";
import { getPerplContext } from "./perpl.js";
import { signedFetch } from "./perplAuth.js";
import {
  HISTORY_STREAMS,
  readBinding,
  saveBinding,
  readHistoryCursor,
  saveHistoryCursor,
  saveEvents,
  saveFundingObservation,
  type AccountingEvent,
  type FundingObservation,
  type HistoryCursor,
  type HistoryStream,
  type PerplBinding,
} from "./accountingStore.js";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.string().regex(/^-?\d+$/);
const timestamp = z.looseObject({
  t: integer.positive(),
  b: integer.optional(),
  tx: integer.optional(),
  l: integer.optional(),
  txid: z.string().optional(),
});
const historyPage = z.object({ d: z.array(z.record(z.string(), z.unknown())), np: z.string() });
const accountEvent = z.looseObject({
  at: timestamp,
  in: integer,
  id: integer,
  et: integer,
  m: integer.optional(),
  p: integer.optional(),
  a: amount,
  f: amount,
});
const positionEvent = z.looseObject({
  at: timestamp,
  mkt: integer,
  acc: integer,
  pid: integer,
  sr: integer,
  fnd: amount.optional(),
  dpnl: amount.optional(),
});
const fillEvent = z.looseObject({
  at: timestamp,
  mkt: integer,
  acc: integer,
  oid: integer,
  f: amount,
});

export function collateralUsd(raw: string): number {
  const value = Number(formatUnits(BigInt(raw), 6));
  if (!Number.isFinite(value)) throw new Error("Perpl amount is out of range");
  return value;
}

/** Amounts are excluded from identity: the same log is never counted again on a retry. */
export function eventIdentity(
  stream: HistoryStream,
  raw: Record<string, unknown>,
): { key: string; logKey: string } {
  const at = timestamp.parse(raw.at);
  if (
    at.l === undefined ||
    (at.txid === undefined && (at.b === undefined || at.tx === undefined))
  ) {
    throw new Error("Perpl history event has no stable transaction/log identity");
  }
  const logKey = `${at.txid?.toLowerCase() ?? `${at.b}:${at.tx}`}:${at.l}`;
  const identity = [
    stream,
    logKey,
    raw.id ?? raw.acc,
    raw.m ?? raw.mkt ?? null,
    raw.p ?? raw.pid ?? null,
    raw.et ?? raw.sr ?? null,
    raw.oid ?? raw.o ?? null,
  ];
  return { key: createHash("sha256").update(JSON.stringify(identity)).digest("hex"), logKey };
}

/** History position rows are event amounts, unlike live position snapshots. */
export function normalizeHistoryEvents(
  stream: HistoryStream,
  input: Record<string, unknown>[],
  binding: PerplBinding,
): AccountingEvent[] {
  const rows =
    stream === "position-history"
      ? input.flatMap((row) =>
          Array.isArray(row.e)
            ? row.e.map((e) => ({ ...row, ...(e as Record<string, unknown>), e: undefined }))
            : [row],
        )
      : input;
  return rows.flatMap((raw) => {
    const row =
      stream === "account-history"
        ? accountEvent.parse(raw)
        : stream === "position-history"
          ? positionEvent.parse(raw)
          : fillEvent.parse(raw);
    const accountId = stream === "account-history" ? row.id : row.acc;
    if (
      accountId !== binding.accountId ||
      (stream === "account-history" && row.in !== binding.instanceId)
    )
      return [];
    const at = new Date(timestamp.parse(row.at).t).toISOString();
    if (binding.historyFrom && at < binding.historyFrom) return [];
    const { key, logKey } = eventIdentity(stream, raw);
    let fundingRaw: string | null = null;
    if (stream === "position-history") fundingRaw = typeof row.fnd === "string" ? row.fnd : null;
    // Account `a` already includes its fee. Restore gross funding; fills record trading costs.
    if (stream === "account-history" && row.et === 8) {
      fundingRaw = (BigInt(String(row.a)) + BigInt(String(row.f))).toString();
    }
    const market = stream === "account-history" ? row.m : row.mkt;
    const position =
      stream === "account-history" ? row.p : stream === "position-history" ? row.pid : null;
    return [
      {
        _id: `${binding.scope}:${key}`,
        scope: binding.scope,
        stream,
        at,
        logKey,
        marketId: typeof market === "number" ? market : null,
        positionId: typeof position === "number" ? position : null,
        fundingRaw,
        tradingFeeRaw: stream === "fills" ? String(row.f) : null,
        realisedTradingPnlRaw:
          stream === "position-history" && typeof row.dpnl === "string" ? row.dpnl : null,
        raw,
      },
    ];
  });
}

interface SyncDependencies {
  readPage: (stream: HistoryStream, page: string | null) => Promise<unknown>;
  loadCursor: typeof readHistoryCursor;
  saveCursor: typeof saveHistoryCursor;
  save: typeof saveEvents;
  continueRunning?: () => boolean;
}

/** Bounded, restart-safe crawl. An unfinished backfill resumes; new head rows are caught next pass. */
export async function syncHistoryStream(
  binding: PerplBinding,
  stream: HistoryStream,
  maxPages: number,
  deps: SyncDependencies,
  now = new Date().toISOString(),
): Promise<HistoryCursor> {
  let state = await deps.loadCursor(binding.scope, stream);
  const visited = new Set<string>();
  for (let i = 0; i < maxPages && (deps.continueRunning?.() ?? true); i++) {
    const requestPage = state.page;
    if (visited.has(requestPage ?? "")) throw new Error("Perpl repeated a history cursor");
    visited.add(requestPage ?? "");
    const page = historyPage.parse(await deps.readPage(stream, requestPage));
    // Anchor covers the entire wallet feed, including unrelated accounts and records before the floor.
    const keys = page.d.map((row) => eventIdentity(stream, row).key);
    const pendingHead = state.pendingHead ?? (requestPage === null ? (keys[0] ?? null) : null);
    const sweepStartedAt = requestPage === null ? now : state.sweepStartedAt;
    const anchorAt = state.anchor === null ? -1 : keys.indexOf(state.anchor);
    const rows = anchorAt < 0 ? page.d : page.d.slice(0, anchorAt);
    await deps.save(normalizeHistoryEvents(stream, rows, binding));
    if (page.np && page.np === requestPage)
      throw new Error("Perpl returned a non-advancing history cursor");
    const done = anchorAt >= 0 || !page.np;
    state = {
      ...state,
      page: done ? null : page.np,
      pendingHead: done ? null : pendingHead,
      anchor: done ? (pendingHead ?? state.anchor) : state.anchor,
      backfillComplete: state.backfillComplete || done,
      // Do not claim events up to the end of a multi-tick crawl: its head was read earlier.
      syncedThrough: done ? (sweepStartedAt ?? state.syncedThrough) : state.syncedThrough,
      sweepStartedAt: done ? null : sweepStartedAt,
    };
    // The sweep start is durable separately from page progress, so a restart cannot extend coverage.
    await deps.saveCursor(state);
    if (done) break;
  }
  return state;
}

function perplGet(path: string): Promise<unknown> {
  if (!env.PERPL_API_KEY || !env.PERPL_API_KEY_SECRET)
    throw new Error("Perpl accounting credentials are not configured");
  return signedFetch(
    { apiKey: env.PERPL_API_KEY, secret: env.PERPL_API_KEY_SECRET },
    env.PERPL_CHAIN_ID,
    `${env.PERPL_API_URL.replace(/\/$/, "")}${path}`,
    { baseUrl: env.PERPL_API_URL },
  );
}

const walletSchema = z.object({
  addr: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  at: timestamp,
  as: z.array(z.object({ id: integer, in: integer })),
});

export async function resolvePerplBinding(scope: string): Promise<PerplBinding> {
  if (env.CHAIN_ID !== env.PERPL_CHAIN_ID)
    throw new Error("vault and Perpl accounting chains differ");
  const wallet = walletSchema.parse(await perplGet("/v1/trading/wallet"));
  const profile = wallet.addr.toLowerCase();
  const allowed = env.ACCOUNTING_PERPL_PROFILE
    ? [env.ACCOUNTING_PERPL_PROFILE]
    : [env.VAULT_ADDRESS, env.PERP_MANAGER_ADDRESS, ...env.PERPL_MANAGERS];
  if (!allowed.some((a) => a?.toLowerCase() === profile))
    throw new Error("Perpl profile is not the vault or a configured manager");
  const account =
    env.ACCOUNTING_PERPL_ACCOUNT_ID === undefined
      ? wallet.as.length === 1
        ? wallet.as[0]
        : undefined
      : wallet.as.find((a) => a.id === env.ACCOUNTING_PERPL_ACCOUNT_ID);
  if (!account) throw new Error("select a dedicated account with ACCOUNTING_PERPL_ACCOUNT_ID");
  const market = await findMarket("MON");
  if (!market) throw new Error("MON market is unavailable");
  const historyFrom = env.ACCOUNTING_HISTORY_FROM
    ? new Date(env.ACCOUNTING_HISTORY_FROM).toISOString()
    : null;
  const binding: PerplBinding = {
    _id: `binding:${scope}`,
    scope: `${scope}:perpl:${profile}:${account.in}:${account.id}:${historyFrom ?? "all"}`,
    profile,
    accountId: account.id,
    instanceId: account.in,
    marketId: market.id,
    historyFrom,
  };
  const existing = await readBinding(scope);
  if (existing && existing.scope !== binding.scope)
    throw new Error(
      "Perpl accounting binding differs from the recorded account; refusing to mix histories",
    );
  await saveBinding(binding);
  return binding;
}

export async function collectPerplHistory(
  binding: PerplBinding,
  continueRunning: () => boolean,
): Promise<void> {
  // Streams are independent: a temporarily unavailable endpoint must not stop the other records.
  const results = await Promise.allSettled(
    HISTORY_STREAMS.map((stream) =>
      syncHistoryStream(binding, stream, env.ACCOUNTING_HISTORY_PAGES_PER_TICK, {
        loadCursor: readHistoryCursor,
        saveCursor: saveHistoryCursor,
        save: saveEvents,
        continueRunning,
        readPage: (stream, page) => {
          const query = new URLSearchParams({ count: "100" });
          if (page) query.set("page", page);
          return perplGet(`/v1/trading/${stream}?${query}`);
        },
      }),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length)
    throw new AggregateError(
      failed.map((r) => (r as PromiseRejectedResult).reason),
      "Perpl history sync incomplete",
    );
}

export async function collectFundingObservation(binding: PerplBinding): Promise<void> {
  const [input, context] = await Promise.all([
    perplGet("/v1/trading/positions"),
    getPerplContext(),
  ]);
  const rawMarket = context.markets?.find((m) => m.id === binding.marketId && m.name === "MON");
  // Do not use trading UI defaults for missing decimals: they would invent a funding amount.
  const market = z
    .object({
      config: z.object({
        price_decimals: integer.max(18),
        size_decimals: integer.max(18),
        funding_sum_scaling_exp: integer.max(18),
      }),
      state: z.object({ mrk: integer.nullish() }).optional(),
      funding: z
        .object({
          sum: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
          at: timestamp,
        })
        .nullish(),
    })
    .parse(rawMarket);
  const positions = z
    .object({
      at: timestamp,
      d: z.array(
        z.looseObject({
          acc: integer,
          mkt: integer,
          sd: z.number().int(),
          s: integer,
          efs: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
        }),
      ),
    })
    .parse(input);
  const atMs = positions.at.t;
  if (atMs > Date.now() + 30_000) throw new Error("Perpl positions are future dated");
  const rows = positions.d.filter((p) => p.acc === binding.accountId && p.mkt === binding.marketId);
  const scales = {
    priceDecimals: market.config.price_decimals,
    sizeDecimals: market.config.size_decimals,
    fundingSumScalingExp: market.config.funding_sum_scaling_exp,
  };
  const fundingSum = market.funding?.sum ?? null;
  const fundingAt = market.funding?.at.t ?? null;
  const markPrice = market.state?.mrk ?? null;
  let funding: number | null = 0;
  let shortNotional: number | null = 0;
  for (const p of rows) {
    const size = p.s / 10 ** scales.sizeDecimals;
    if (p.sd !== 1 && p.sd !== 2) throw new Error("Perpl position side is unavailable");
    if (fundingSum === null || fundingAt === null || fundingAt > atMs) funding = null;
    else if (funding !== null) funding += positionFundingUsd(p.sd, p.s, p.efs, fundingSum, scales);
    if (p.sd === 2) {
      if (markPrice === null) shortNotional = null;
      else if (shortNotional !== null)
        shortNotional += (size * markPrice) / 10 ** scales.priceDecimals;
    }
  }
  await saveFundingObservation({
    _id: `${binding.scope}:${Math.floor(atMs / env.ACCOUNTING_INTERVAL_MS)}`,
    scope: binding.scope,
    at: new Date(atMs).toISOString(),
    openFundingUsd: funding,
    shortNotionalUsd: shortNotional,
    marketFundingSum: fundingSum,
    marketFundingAt: fundingAt === null ? null : new Date(fundingAt).toISOString(),
    ...scales,
    positions: rows,
  });
}

export function positionFundingUsd(
  side: number,
  sizeRaw: number,
  entryFundingSum: number,
  fundingSum: number,
  scales: Pick<FundingObservation, "priceDecimals" | "sizeDecimals" | "fundingSumScalingExp">,
): number {
  if (side !== 1 && side !== 2) throw new Error("invalid Perpl position side");
  return (
    ((side === 2 ? 1 : -1) *
      (fundingSum - entryFundingSum) *
      (sizeRaw / 10 ** scales.sizeDecimals)) /
    10 ** (scales.priceDecimals + scales.fundingSumScalingExp)
  );
}
