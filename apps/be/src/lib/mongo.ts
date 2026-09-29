import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { env } from "../config.js";
import { logger } from "./logger.js";

/**
 * The automation's memory. Everything that must survive a restart without being replayed lives
 * here: the config, each pipeline run and its steps, and the activity log.
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
    client = new MongoClient(env.MONGO_CONNECTION_STRING!, { serverSelectionTimeoutMS: 8_000 });
    await client.connect();
    database = client.db(env.MONGO_DB_NAME);
    await ensureIndexes(database);
    logger.info({ db: env.MONGO_DB_NAME }, "mongo connected");
    return database;
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
} as const;

async function ensureIndexes(d: Db): Promise<void> {
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
}

export async function collection<T extends Document>(name: string): Promise<Collection<T>> {
  return (await db()).collection<T>(name);
}
