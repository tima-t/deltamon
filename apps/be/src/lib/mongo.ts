import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { env } from "../config.js";
import { logger } from "./logger.js";

/**
 * Persistent automation and accounting records, shared by API readers and background workers.
 */

let client: MongoClient | null = null;
let database: Db | null = null;
let connecting: Promise<Db> | null = null;

export function mongoConfigured(): boolean {
  return Boolean(env.MONGO_CONNECTION_STRING);
}

export async function db(): Promise<Db> {
  if (database) return database;
  if (!env.MONGO_CONNECTION_STRING) throw new Error("MONGO_CONNECTION_STRING is not set");
  connecting ??= (async () => {
    const candidate = new MongoClient(env.MONGO_CONNECTION_STRING!, {
      serverSelectionTimeoutMS: 8_000,
    });
    client = candidate;
    try {
      await candidate.connect();
      const ready = candidate.db(env.MONGO_DB_NAME);
      await ensureIndexes(ready);
      database = ready;
      logger.info({ db: env.MONGO_DB_NAME }, "mongo connected");
      return ready;
    } catch (err) {
      await candidate.close().catch(() => undefined);
      client = null;
      connecting = null;
      throw err;
    }
  })();
  return connecting;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
  connecting = null;
}

export const collections = {
  config: "automation_config",
  flows: "automation_flows",
  activity: "activity",
  sessions: "console_sessions",
  accountingVault: "accounting_vault_snapshots",
  accountingFunding: "accounting_funding_observations",
  accountingEvents: "accounting_perpl_events",
  accountingState: "accounting_state",
} as const;

async function ensureIndexes(d: Db): Promise<void> {
  for (const name of [
    collections.accountingVault,
    collections.accountingFunding,
    collections.accountingEvents,
  ]) {
    await d.collection(name).createIndex({ scope: 1, at: 1 }, { name: "accounting_timeline" });
  }
  // One flow per trigger, enforced by the database rather than by a check-then-act in the worker.
  await d
    .collection(collections.flows)
    .createIndex({ triggerKey: 1 }, { unique: true, name: "trigger_once" });
  await d.collection(collections.flows).createIndex({ createdAt: -1 }, { name: "recent_flows" });
  await d.collection(collections.activity).createIndex({ at: -1 }, { name: "recent_activity" });
  // On-chain events are keyed by their log, so a re-scan cannot record them twice.
  await d
    .collection(collections.activity)
    .createIndex({ dedupeKey: 1 }, { unique: true, sparse: true, name: "activity_once" });
  // Mongo expires the document itself, so a forgotten token cannot linger past its life.
  await d
    .collection(collections.sessions)
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "session_ttl" });
}

export async function collection<T extends Document>(name: string): Promise<Collection<T>> {
  return (await db()).collection<T>(name);
}
