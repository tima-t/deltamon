import {
  AutomationConfigSchema,
  DEFAULT_AUTOMATION_CONFIG,
  type Activity,
  type AutomationConfig,
} from "@deltamon/shared";
import { collection, collections, mongoConfigured } from "../lib/mongo.js";
import { logger } from "../lib/logger.js";

/**
 * Reading and writing the automation's state.
 *
 * The config is a single document, so there is nothing to reconcile. The activity log is
 * append-only and deduplicated on a caller-supplied key, which is how a re-scan of the chain can
 * record the same event twice without it appearing twice.
 */

const CONFIG_ID = "automation";

interface ConfigDoc extends AutomationConfig {
  _id: string;
}

export async function readConfig(): Promise<AutomationConfig> {
  if (!mongoConfigured()) return DEFAULT_AUTOMATION_CONFIG;
  const docs = await collection<ConfigDoc>(collections.config);
  const found = await docs.findOne({ _id: CONFIG_ID });
  if (!found) return DEFAULT_AUTOMATION_CONFIG;
  // Parsed field by field over the defaults, so a document written before a setting existed keeps
  // everything it does carry. Validating it whole would fail on the missing field and quietly
  // hand back defaults, which reads to an operator as the automation switching itself off.
  const parsed = AutomationConfigSchema.partial().safeParse(found);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "stored automation config is invalid");
    return DEFAULT_AUTOMATION_CONFIG;
  }
  const merged = { ...DEFAULT_AUTOMATION_CONFIG, ...stripUndefined(parsed.data) };
  const whole = AutomationConfigSchema.safeParse(merged);
  if (!whole.success) {
    logger.warn({ issues: whole.error.issues }, "stored automation config is invalid");
    return DEFAULT_AUTOMATION_CONFIG;
  }
  return whole.data;
}

/** A field the document omits must not overwrite its default with undefined. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function writeConfig(
  next: Omit<AutomationConfig, "updatedAt" | "updatedBy">,
  updatedBy: string,
): Promise<AutomationConfig> {
  const docs = await collection<ConfigDoc>(collections.config);
  const value: AutomationConfig = {
    ...next,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await docs.updateOne({ _id: CONFIG_ID }, { $set: value }, { upsert: true });
  logger.info({ ...value }, "automation config changed");
  return value;
}

export interface ActivityInput extends Omit<Activity, "at"> {
  /** Optional: makes the write idempotent, for anything that can be replayed. */
  dedupeKey?: string;
  at?: string;
}

/** Appends one line. A duplicate dedupeKey is ignored rather than raising. */
export async function recordActivity(entry: ActivityInput): Promise<void> {
  if (!mongoConfigured()) return;
  try {
    const docs = await collection(collections.activity);
    const { dedupeKey, ...rest } = entry;
    const doc = { ...rest, at: entry.at ?? new Date().toISOString(), dedupeKey };
    if (dedupeKey) {
      await docs.updateOne({ dedupeKey }, { $setOnInsert: doc }, { upsert: true });
    } else {
      await docs.insertOne(doc);
    }
  } catch (err) {
    // The log is a record, not a dependency: never let it fail the thing it is describing.
    logger.warn({ err, kind: entry.kind }, "could not record activity");
  }
}

export async function listActivity(limit = 100, before?: string): Promise<Activity[]> {
  if (!mongoConfigured()) return [];
  const docs = await collection(collections.activity);
  const query = before ? { at: { $lt: before } } : {};
  const rows = await docs
    .find(query, { projection: { _id: 0, dedupeKey: 0 } })
    .sort({ at: -1 })
    .limit(Math.min(limit, 500))
    .toArray();
  return rows as unknown as Activity[];
}
