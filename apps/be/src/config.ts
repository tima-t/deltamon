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

  CHAIN_ID: z.coerce.number().int().default(10143),
  RPC_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  VAULT_ADDRESS: z.preprocess(emptyToUndefined, address.optional()),

  KEEPER_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  KEEPER_PRIVATE_KEY: z.preprocess(emptyToUndefined, privateKey.optional()),
  KEEPER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  REBALANCE_THRESHOLD_BPS: z.coerce.number().int().nonnegative().default(200),

  PERPL_API_URL: z.preprocess(emptyToUndefined, z.url().default(PERPL_API_URL)),
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
