/**
 * Enrolls a Perpl API key for the vault's exchange account.
 *
 * The Ed25519 private key is generated here, on your machine, and is never sent anywhere.
 * Perpl only ever receives the public half. The opaque token it returns is shown once and
 * cannot be re-derived, so both values go straight into apps/be/.env, which is gitignored.
 *
 * The key can trade the vault's position and nothing else. Perpl never permits withdrawals
 * through an API key at any scope, and the vault's collateral can only be moved by the vault.
 *
 *   pnpm --filter @deltamon/be perpl:enroll
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { hashTypedData, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API_URL = process.env.PERPL_API_URL ?? "https://app.perpl.xyz/api";
const CHAIN_ID = Number(process.env.PERPL_CHAIN_ID ?? 143);
/** Must be whitelisted by Perpl before either endpoint will answer. */
const ORIGIN = process.env.PERPL_ORIGIN;
/** The vault. It owns the Perpl account, so it is the profile the key acts for. */
const TARGET_PROFILE = process.env.PERPL_TARGET_PROFILE;
/** The admin wallet. Used once, to sign the enrolment, then forgotten. */
const ADMIN_PRIVATE_KEY = process.env.PERPL_ENROLL_PRIVATE_KEY;
/** 2 = trade, which implies read. Lowest scope that can run the strategy. */
const SCOPE_MASK = Number(process.env.PERPL_SCOPE_MASK ?? 2);
const LABEL = process.env.PERPL_KEY_LABEL ?? "deltamon-keeper";
/** Optional. Restrict the key to your backend's address, up to four ranges. */
const IP_CIDRS = (process.env.PERPL_IP_CIDRS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing ${name}. See apps/be/.env.example.`);
    process.exit(1);
  }
  return value;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN as string },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint: Record<number, string> = {
      403: "Origin is not whitelisted by Perpl. Ask them to add it.",
      404: "Target profile not found. Has the vault called createAccount yet?",
      409: "That public key is already registered. Revoked keys cannot be reused, so run this again for a fresh pair.",
      423: "This profile already has the maximum of 16 active keys.",
    };
    console.error(`\n${path} failed: ${res.status}\n${text}\n${hint[res.status] ?? ""}`);
    process.exit(1);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

const origin = requireEnv("PERPL_ORIGIN", ORIGIN);
const target = requireEnv("PERPL_TARGET_PROFILE", TARGET_PROFILE);
const adminKey = requireEnv("PERPL_ENROLL_PRIVATE_KEY", ADMIN_PRIVATE_KEY) as Hex;
if (!isAddress(target)) {
  console.error("PERPL_TARGET_PROFILE is not an address.");
  process.exit(1);
}

// 1. Generate the key pair locally. The private half never leaves this process.
const privateKey = ed.utils.randomSecretKey();
const publicKey = await ed.getPublicKeyAsync(privateKey);
const publicKeyHex = `0x${Buffer.from(publicKey).toString("hex")}`;
const privateKeyHex = `0x${Buffer.from(privateKey).toString("hex")}`;

const admin = privateKeyToAccount(adminKey);
console.log(`signing wallet   ${admin.address}`);
console.log(`vault profile    ${target}`);
console.log(`chain            ${CHAIN_ID}`);
console.log(`scope            ${SCOPE_MASK} (2 = trade, never withdraw)`);
if (IP_CIDRS.length > 0) console.log(`ip allow-list    ${IP_CIDRS.join(", ")}`);

// 2. Ask Perpl what to sign.
const payload = await post("/v1/api-key/payload", {
  chain_id: CHAIN_ID,
  address: admin.address,
  public_key: publicKeyHex,
  scope_mask: SCOPE_MASK,
  label: LABEL,
  target_profile: target,
  ...(IP_CIDRS.length > 0 ? { ip_cidrs: IP_CIDRS } : {}),
});

const typedData = payload.typed_data as {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType?: string;
  message: Record<string, unknown>;
};
const { EIP712Domain: _domainType, ...types } = typedData.types;
const primaryType = typedData.primaryType ?? Object.keys(types)[0];

// 3. Two signatures: the wallet proves it operates the account, the key proves we hold it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const signature = await admin.signTypedData({
  domain: typedData.domain,
  types,
  primaryType,
  message: typedData.message,
} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const digest = hashTypedData({
  domain: typedData.domain,
  types,
  primaryType,
  message: typedData.message,
} as any);
const pop = await ed.signAsync(Buffer.from(digest.slice(2), "hex"), privateKey);
const popSignature = `0x${Buffer.from(pop).toString("hex")}`;

const enrolled = await post("/v1/api-key/enroll", {
  chain_id: CHAIN_ID,
  address: admin.address,
  typed_data: payload.typed_data,
  mac: payload.mac,
  signature,
  pop_signature: popSignature,
  target_profile: target,
});

const info = (enrolled.api_key ?? enrolled) as Record<string, unknown>;
const token = info.api_key as string;

// 4. Write the two secrets where the backend expects them, and nowhere else.
const envBlock = `PERPL_API_KEY=${token}\nPERPL_API_KEY_SECRET=${privateKeyHex}\n`;
writeFileSync("perpl-key.env", envBlock, { mode: 0o600 });

console.log("\nEnrolled. The token is shown once and cannot be re-derived.\n");
console.log(envBlock);
console.log("Written to apps/be/perpl-key.env with owner-only permissions.");
console.log("Move both lines into apps/be/.env, then delete that file.");
console.log("Never commit either value, and never expose them to the frontend.");
