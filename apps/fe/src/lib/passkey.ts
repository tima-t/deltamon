import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { getAddress, isAddress, type Address } from "viem";

const STORAGE_KEY = "deltamon.passkey.v1";
const ACCOUNT_PATH = "m/44'/60'/0'/0/0";
const PUBLIC_RP_ID = "app.deltamon.xyz";

export type PasskeyRecord = PasskeyCredentialMetadata & { address: Address };

export function passkeyEnabled(): boolean {
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_PASSKEY_ENABLED !== "true") return false;
  return window.location.hostname === PUBLIC_RP_ID || window.location.hostname === "localhost";
}

function rpId(): string {
  if (!passkeyEnabled()) {
    throw new Error("Passkey wallets are available only at app.deltamon.xyz or localhost.");
  }
  if (!window.isSecureContext) throw new Error("Passkeys require HTTPS or localhost.");
  return window.location.hostname;
}

export function readPasskeyRecord(): PasskeyRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<PasskeyRecord> | null;
    if (!value || typeof value.credentialId !== "string" || typeof value.address !== "string" || !isAddress(value.address)) return null;
    return {
      credentialId: value.credentialId,
      transports: Array.isArray(value.transports) ? value.transports : undefined,
      address: getAddress(value.address),
    };
  } catch {
    return null;
  }
}

function savePasskeyRecord(record: PasskeyRecord): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export function passkeyError(error: unknown): string {
  if (isMeraError(error)) {
    if (error.code === "PRF_UNAVAILABLE") return "This passkey provider does not support the feature needed for a wallet. Try a supported provider or connect an existing wallet.";
    if (error.code === "PASSKEY_OPERATION_FAILED") return "The passkey prompt was cancelled or could not finish. Try again or connect an existing wallet.";
    if (error.code === "CRYPTO_UNAVAILABLE") return "Passkeys need a secure HTTPS connection. Open DeltaMon at app.deltamon.xyz.";
  }
  return error instanceof Error ? error.message : "The passkey request could not finish.";
}

function deriveAccount(prfOutput: Uint8Array) {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const seed = mnemonicToSeedSync(mnemonic);
  let root: HDKey | undefined;
  try {
    root = HDKey.fromMasterSeed(seed);
    const node = root.derive(ACCOUNT_PATH);
    const privateKey = node.privateKey;
    if (!privateKey) throw new Error("Could not derive the passkey wallet.");
    try {
      const session = createSecp256k1SigningSession({ privateKey });
      return { session, mnemonic, address: getAddress(getEvmAddress(session.publicKey)) };
    } finally {
      privateKey.fill(0);
      node.wipePrivateData();
    }
  } finally {
    root?.wipePrivateData();
    seed.fill(0);
  }
}

function recordFromOutput(prfOutput: Uint8Array, credential: PasskeyCredentialMetadata): PasskeyRecord {
  try {
    const { session, address } = deriveAccount(prfOutput);
    session.end();
    return { ...credential, address };
  } finally {
    prfOutput.fill(0);
  }
}

export async function createPasskeyWallet(): Promise<PasskeyRecord> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId(), name: "DeltaMon" },
    user: { name: "DeltaMon wallet", displayName: "DeltaMon wallet" },
  });
  const record = recordFromOutput(created.prfOutput, {
    credentialId: created.credentialId,
    transports: created.transports,
  });
  savePasskeyRecord(record);
  return record;
}

export async function signInPasskeyWallet(useAnother = false): Promise<PasskeyRecord> {
  // An unpinned request also works on a fresh browser with a synced passkey.
  const known = readPasskeyRecord();
  const result = await getPasskeyPrfOutput({ rpId: rpId(), credential: useAnother ? undefined : known ?? undefined });
  const record = recordFromOutput(result.prfOutput, {
    credentialId: result.credentialId,
    transports: known?.credentialId === result.credentialId ? known.transports : undefined,
  });
  savePasskeyRecord(record);
  return record;
}

export async function withPasskeyAccount<T>(
  expectedAddress: Address,
  action: (account: ReturnType<typeof toViemAccount>) => Promise<T>,
): Promise<T> {
  const record = readPasskeyRecord();
  if (!record) throw new Error("Choose your passkey wallet again before signing.");
  const result = await getPasskeyPrfOutput({ rpId: rpId(), credential: record });
  let session: ReturnType<typeof createSecp256k1SigningSession> | undefined;
  try {
    if (result.credentialId !== record.credentialId) throw new Error("A different passkey was selected. Use the passkey for this wallet.");
    const derived = deriveAccount(result.prfOutput);
    session = derived.session;
    if (derived.address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error("This passkey opens a different wallet. Switch accounts before continuing.");
    }
    return await action(toViemAccount(session));
  } finally {
    result.prfOutput.fill(0);
    session?.end();
  }
}

export async function exportPasskeyRecoveryPhrase(expectedAddress: Address): Promise<string> {
  const record = readPasskeyRecord();
  if (!record) throw new Error("Choose your passkey wallet again.");
  const result = await getPasskeyPrfOutput({ rpId: rpId(), credential: record });
  try {
    if (result.credentialId !== record.credentialId) throw new Error("A different passkey was selected.");
    const derived = deriveAccount(result.prfOutput);
    try {
      if (derived.address.toLowerCase() !== expectedAddress.toLowerCase()) throw new Error("This passkey opens a different wallet.");
      return derived.mnemonic;
    } finally {
      derived.session.end();
    }
  } finally {
    result.prfOutput.fill(0);
  }
}
