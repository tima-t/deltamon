import "dotenv/config";
import { z } from "zod";
import { PERPL_API_URL } from "@deltamon/shared";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  /** Monad mainnet, where the vault is deployed. */
  CHAIN_ID: z.coerce.number().int().default(143),
  RPC_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  VAULT_ADDRESS: z.preprocess(emptyToUndefined, address.optional()),

  KEEPER_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  KEEPER_PRIVATE_KEY: z.preprocess(emptyToUndefined, privateKey.optional()),
  KEEPER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  /** Where the perp managers publish what they hold in total. See services/perpBook.ts. */
  PERP_BOOK_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  /** A feed older than this is not marked from. */
  PERP_BOOK_MAX_AGE_SEC: z.coerce.number().int().positive().default(300),
  /** Re-mark early once the book has moved more than this share of what is deployed. */
  PERP_MARK_MIN_CHANGE_BPS: z.coerce.number().int().nonnegative().default(25),
  /**
   * The shortest gap between marks driven by movement. Without it a levered book re-marks on every
   * tick: the change is measured against what was deployed while the book moves with notional.
   * A lapsing mark still re-marks regardless.
   */
  PERP_MARK_MIN_INTERVAL_SEC: z.coerce.number().int().nonnegative().default(1_800),
  /** Validators the vault delegates to. Rewards and unbonded MON are claimed from these. */
  VALIDATOR_IDS: z
    .string()
    .default("")
    .refine(
      (v) => v.split(",").every((s) => /^\d*$/.test(s.trim())),
      "expected comma-separated validator ids",
    )
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .map((s) => BigInt(s)),
    ),
  /** The smallest reward claim worth a transaction, in MON. Small, frequent claims are not worth sandwiching. */
  REWARDS_MIN_CLAIM_MON: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .default("1"),

  /**
   * Addresses allowed to drive a Perpl account through this backend, comma separated. A caller
   * proves it holds one by signing a challenge, and gets a 24 hour bearer token in return. Public
   * addresses only: no key of any kind belongs in this variable.
   */
  PERPL_MANAGERS: z
    .string()
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s)),
    ),

  /**
   * Signs the manager wallet's own transactions: approving AUSD and depositing it into Perpl as
   * collateral. Separate from the admin key and just as sensitive, since the manager holds vault
   * money the vault cannot claw back.
   */
  PERP_MANAGER_PRIVATE_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^(0x)?[0-9a-fA-F]{64}$/, "expected a 32 byte hex private key, with or without 0x")
      .transform((k) => (k.startsWith("0x") ? k : `0x${k}`))
      .optional(),
  ),

  /** The perp manager the pipeline funds. Must be listed on the vault as a manager. */
  PERP_MANAGER_ADDRESS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
  ),
  /**
   * Where automation state lives: the pipeline's steps, its config, the console's sessions and the
   * activity log. Without it the automation stays idle rather than risk replaying a step it cannot
   * remember, and the Automations tab reports that storage is not configured.
   */
  MONGO_CONNECTION_STRING: z.preprocess(emptyToUndefined, z.string().optional()),
  MONGO_DB_NAME: z.string().default("deltamon"),
  /**
   * Signs the automation's vault transactions. Full admin power: it can swap, stake and fund perp
   * managers. Keep it off any machine that does not need to run the pipeline.
   */
  ADMIN_PRIVATE_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^(0x)?[0-9a-fA-F]{64}$/, "expected a 32 byte hex private key, with or without 0x")
      // viem wants the prefix; a key pasted without one is still a key.
      .transform((k) => (k.startsWith("0x") ? k : `0x${k}`))
      .optional(),
  ),

  PERPL_API_URL: z.preprocess(emptyToUndefined, z.url().default(PERPL_API_URL)),
  PERPL_CHAIN_ID: z.coerce.number().int().positive().default(143),
  PERPL_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  PERPL_API_KEY_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", z.prettifyError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
