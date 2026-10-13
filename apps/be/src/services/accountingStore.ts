import type { VaultAccountingSnapshot } from "@deltamon/shared";
import { collection, collections } from "../lib/mongo.js";

export type HistoryStream = "account-history" | "position-history" | "fills";
export const HISTORY_STREAMS: HistoryStream[] = ["account-history", "position-history", "fills"];

export interface AccountingEvent {
  _id: string;
  scope: string;
  stream: HistoryStream;
  at: string;
  /** Same on-chain log across account and position history, for funding reconciliation. */
  logKey: string;
  marketId: number | null;
  positionId: number | null;
  fundingRaw: string | null;
  tradingFeeRaw: string | null;
  realisedTradingPnlRaw: string | null;
  raw: Record<string, unknown>;
}

export interface HistoryCursor {
  _id: string;
  scope: string;
  stream: HistoryStream;
  /** Page being scanned. Written only after that page's records are durable. */
  page: string | null;
  anchor: string | null;
  pendingHead: string | null;
  backfillComplete: boolean;
  syncedThrough: string | null;
  sweepStartedAt: string | null;
}

export interface PerplBinding {
  _id: string;
  scope: string;
  profile: string;
  accountId: number;
  instanceId: number;
  marketId: number;
  historyFrom: string | null;
}

export interface DepositScan {
  _id: string;
  scope: string;
  /** Deployment block this sum started from; a different one invalidates the running total. */
  fromBlock: string;
  syncedTo: string;
  depositedRaw: string;
  depositCount: number;
  /** True once the scan has reached chain head at least once. */
  complete: boolean;
}

export interface FundingObservation {
  _id: string;
  scope: string;
  at: string;
  /** Unsettled MON funding, signed for each position's side. Null when an input is unavailable. */
  openFundingUsd: number | null;
  shortNotionalUsd: number | null;
  marketFundingSum: number | null;
  marketFundingAt: string | null;
  priceDecimals: number;
  sizeDecimals: number;
  fundingSumScalingExp: number;
  positions: Record<string, unknown>[];
}

interface VaultSnapshotDoc extends VaultAccountingSnapshot {
  _id: string;
  scope: string;
}

export function vaultScope(chainId: number, vault: string): string {
  return `${chainId}:${vault.toLowerCase()}`;
}

export async function readBinding(scope: string): Promise<PerplBinding | null> {
  return (await collection<PerplBinding>(collections.accountingState)).findOne({
    _id: `binding:${scope}`,
  });
}

export async function saveBinding(binding: PerplBinding): Promise<void> {
  await (
    await collection<PerplBinding>(collections.accountingState)
  ).updateOne({ _id: binding._id }, { $setOnInsert: binding }, { upsert: true });
  const saved = await readBinding(binding._id.slice("binding:".length));
  if (!saved || saved.scope !== binding.scope || saved.marketId !== binding.marketId) {
    throw new Error(
      "accounting account binding changed; use a dedicated account and database scope",
    );
  }
}

export async function readHistoryCursor(
  scope: string,
  stream: HistoryStream,
): Promise<HistoryCursor> {
  const _id = `cursor:${scope}:${stream}`;
  return (
    (await (await collection<HistoryCursor>(collections.accountingState)).findOne({ _id })) ?? {
      _id,
      scope,
      stream,
      page: null,
      anchor: null,
      pendingHead: null,
      backfillComplete: false,
      syncedThrough: null,
      sweepStartedAt: null,
    }
  );
}

export async function saveHistoryCursor(cursor: HistoryCursor): Promise<void> {
  await (
    await collection<HistoryCursor>(collections.accountingState)
  ).updateOne({ _id: cursor._id }, { $set: cursor }, { upsert: true });
}

export async function readDepositScan(scope: string): Promise<DepositScan | null> {
  return (await collection<DepositScan>(collections.accountingState)).findOne({
    _id: `deposits:${scope}`,
  });
}

export async function saveDepositScan(scan: DepositScan): Promise<void> {
  await (
    await collection<DepositScan>(collections.accountingState)
  ).updateOne({ _id: scan._id }, { $set: scan }, { upsert: true });
}

export async function saveEvents(events: AccountingEvent[]): Promise<void> {
  if (!events.length) return;
  await (
    await collection<AccountingEvent>(collections.accountingEvents)
  ).bulkWrite(
    events.map((event) => ({
      updateOne: {
        filter: { _id: event._id },
        update: { $setOnInsert: event },
        upsert: true,
      },
    })),
  );
}

export async function saveFundingObservation(observation: FundingObservation): Promise<void> {
  await (
    await collection<FundingObservation>(collections.accountingFunding)
  ).updateOne({ _id: observation._id }, { $setOnInsert: observation }, { upsert: true });
}

export async function saveVaultSnapshot(
  scope: string,
  snapshot: VaultAccountingSnapshot,
  intervalMs: number,
): Promise<void> {
  const _id = `${scope}:${Math.floor(Date.parse(snapshot.at) / intervalMs)}`;
  await (
    await collection<VaultSnapshotDoc>(collections.accountingVault)
  ).updateOne({ _id }, { $setOnInsert: { _id, scope, ...snapshot } }, { upsert: true });
}

export async function vaultSnapshots(
  scope: string,
  from: string,
  to: string,
): Promise<VaultAccountingSnapshot[]> {
  const docs = await collection<VaultSnapshotDoc>(collections.accountingVault);
  const [previous, rows] = await Promise.all([
    docs.findOne(
      { scope, at: { $lt: from } },
      { sort: { at: -1 }, projection: { _id: 0, scope: 0 } },
    ),
    docs
      .find({ scope, at: { $gte: from, $lte: to } }, { projection: { _id: 0, scope: 0 } })
      .sort({ at: 1 })
      .toArray(),
  ]);
  return (previous ? [previous, ...rows] : rows) as unknown as VaultAccountingSnapshot[];
}

export async function latestVaultSnapshot(scope: string): Promise<VaultAccountingSnapshot | null> {
  return (await collection<VaultSnapshotDoc>(collections.accountingVault)).findOne(
    { scope },
    { sort: { at: -1 }, projection: { _id: 0, scope: 0 } },
  ) as Promise<VaultAccountingSnapshot | null>;
}

export async function accountingEvents(
  scope: string,
  from: string,
  to: string,
): Promise<AccountingEvent[]> {
  return (await collection<AccountingEvent>(collections.accountingEvents))
    .find({ scope, at: { $gte: from, $lte: to } })
    .sort({ at: 1 })
    .toArray();
}

export async function fundingObservations(
  scope: string,
  from: string,
  to: string,
): Promise<FundingObservation[]> {
  const docs = await collection<FundingObservation>(collections.accountingFunding);
  const [previous, rows] = await Promise.all([
    docs.findOne({ scope, at: { $lt: from } }, { sort: { at: -1 } }),
    docs
      .find({ scope, at: { $gte: from, $lte: to } })
      .sort({ at: 1 })
      .toArray(),
  ]);
  return previous ? [previous, ...rows] : rows;
}
