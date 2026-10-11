import type { Address } from "viem";
import { VaultAccountingHistorySchema, type VaultAccountingHistory } from "@deltamon/shared";
import { env } from "../config.js";
import { mongoConfigured } from "../lib/mongo.js";
import { logger } from "../lib/logger.js";
import { captureAccountingSnapshot } from "./accountingSnapshot.js";
import {
  collectFundingObservation,
  collectPerplHistory,
  resolvePerplBinding,
} from "./accountingPerpl.js";
import { accountingDaily } from "./accountingMath.js";
import {
  HISTORY_STREAMS,
  accountingEvents,
  fundingObservations,
  latestVaultSnapshot,
  readBinding,
  readHistoryCursor,
  saveVaultSnapshot,
  vaultScope,
  vaultSnapshots,
} from "./accountingStore.js";

const DAY = 86_400_000;

export class AccountingCollector {
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private stopping = false;
  private errors: string[] = [];
  private lastRunAt: string | null = null;

  status() {
    return {
      enabled: env.ACCOUNTING_ENABLED,
      configured: mongoConfigured() && Boolean(env.VAULT_ADDRESS),
      intervalMs: env.ACCOUNTING_INTERVAL_MS,
      running: this.active !== null,
      lastRunAt: this.lastRunAt,
      errors: [...this.errors],
      stakingApyBps: env.ACCOUNTING_STAKING_APY_BPS ?? null,
    };
  }

  start(): void {
    if (this.timer || !env.ACCOUNTING_ENABLED || !mongoConfigured() || !env.VAULT_ADDRESS) return;
    this.stopping = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), env.ACCOUNTING_INTERVAL_MS);
    logger.info({ intervalMs: env.ACCOUNTING_INTERVAL_MS }, "accounting collector started");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.active;
  }

  tick(): Promise<void> {
    if (this.active) return this.active;
    if (this.stopping || !env.ACCOUNTING_ENABLED || !mongoConfigured() || !env.VAULT_ADDRESS)
      return Promise.resolve();
    this.active = this.run().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async run(): Promise<void> {
    const scope = vaultScope(env.CHAIN_ID, env.VAULT_ADDRESS!);
    this.errors = [];
    const recordError = (part: string, err: unknown) => {
      // Do not return signed URLs, upstream response bodies or Mongo connection strings publicly.
      this.errors.push(`${part} unavailable`);
      logger.warn({ err, part }, "accounting collection failed");
    };
    await Promise.all([
      (async () => {
        try {
          const snapshot = await captureAccountingSnapshot(env.VAULT_ADDRESS as Address);
          if (Math.abs(Date.now() - Date.parse(snapshot.at)) > env.ACCOUNTING_INTERVAL_MS * 3)
            throw new Error("vault block is not current");
          await saveVaultSnapshot(scope, snapshot, env.ACCOUNTING_INTERVAL_MS);
        } catch (err) {
          recordError("vault snapshots", err);
        }
      })(),
      (async () => {
        if (!env.PERPL_API_KEY || !env.PERPL_API_KEY_SECRET) {
          this.errors.push("Perpl credentials are not configured");
          return;
        }
        try {
          const binding = await resolvePerplBinding(scope);
          const results = await Promise.allSettled([
            collectPerplHistory(binding, () => !this.stopping),
            collectFundingObservation(binding),
          ]);
          results.forEach((r, i) => {
            if (r.status === "rejected")
              recordError(i === 0 ? "Perpl history" : "funding observations", r.reason);
          });
        } catch (err) {
          recordError("Perpl account", err);
        }
      })(),
    ]);
    this.lastRunAt = new Date().toISOString();
  }
}

export const accounting = new AccountingCollector();

/** Public chart projections. Raw source events and API credentials never leave the backend. */
export async function getAccountingHistory(
  days = 30,
  now = Date.now(),
): Promise<VaultAccountingHistory> {
  const from = new Date(Math.floor(now / DAY) * DAY - (days - 1) * DAY).toISOString();
  const to = new Date(now).toISOString();
  const base: VaultAccountingHistory = {
    vault: env.VAULT_ADDRESS?.toLowerCase() ?? null,
    chainId: env.CHAIN_ID,
    from,
    to,
    status: "not_configured",
    latest: null,
    composition: null,
    perpl: {
      accountId: null,
      marketId: null,
      historyFrom: null,
      historyComplete: false,
      syncedThrough: null,
    },
    sources: {
      vaultReturn: "contract_book_value",
      fundingSettled: "perpl_account_and_position_events",
      fundingObserved: "perpl_settled_plus_open_accrual",
      tradingFees: "perpl_fills",
      staking: "estimated_from_recorded_balance_and_assumed_apy",
    },
    daily: [],
  };
  if (!mongoConfigured() || !env.VAULT_ADDRESS) return base;
  const scope = vaultScope(env.CHAIN_ID, env.VAULT_ADDRESS);
  const [snapshots, latest, binding] = await Promise.all([
    vaultSnapshots(scope, from, to),
    latestVaultSnapshot(scope),
    readBinding(scope),
  ]);
  const observations = binding ? await fundingObservations(binding.scope, from, to) : [];
  const eventFrom = observations[0]?.at && observations[0].at < from ? observations[0].at : from;
  const [events, cursors] = binding
    ? await Promise.all([
        accountingEvents(binding.scope, eventFrom, to),
        Promise.all(HISTORY_STREAMS.map((s) => readHistoryCursor(binding.scope, s))),
      ])
    : [[], []];
  const through = (streams: string[]) => {
    const selected = cursors.filter((c) => streams.includes(c.stream));
    if (
      selected.length !== streams.length ||
      selected.some((c) => !c.backfillComplete || !c.syncedThrough)
    )
      return null;
    return selected.map((c) => c.syncedThrough!).sort()[0] ?? null;
  };
  const fundingThrough = through(["account-history", "position-history"]);
  return VaultAccountingHistorySchema.parse({
    ...base,
    status: latest || events.length ? "available" : "collecting",
    latest,
    composition: latest
      ? {
          at: latest.at,
          basis: "gross_assets",
          idleUsdcUsd: latest.idleUsdcUsd,
          idleAusdUsd: latest.idleAusdUsd,
          monHoldingsUsd: latest.monHeld * latest.monPriceUsd,
          shortEquityBookedUsd: latest.shortEquityBookedUsd,
          accruedFeesUsd: latest.accruedFeesUsd,
          shortBookedAt: latest.shortBookedAt,
          shortBookFresh: latest.shortBookFresh,
        }
      : null,
    perpl: {
      accountId: binding?.accountId ?? null,
      marketId: binding?.marketId ?? null,
      historyFrom: binding?.historyFrom ?? null,
      historyComplete: cursors.length === 3 && cursors.every((c) => c.backfillComplete),
      syncedThrough: through(HISTORY_STREAMS),
    },
    daily: accountingDaily({
      from,
      to,
      snapshots,
      observations,
      events,
      marketId: binding?.marketId ?? null,
      fundingThrough,
      fillsThrough: through(["fills"]),
      positionsThrough: through(["position-history"]),
      historyFrom: binding?.historyFrom ?? null,
      maxGapMs: env.ACCOUNTING_INTERVAL_MS * 3,
    }),
  });
}
