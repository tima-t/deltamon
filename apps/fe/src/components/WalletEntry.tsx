"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  createPasskeyWallet,
  exportPasskeyRecoveryPhrase,
  passkeyEnabled,
  passkeyError,
  readPasskeyRecord,
  signInPasskeyWallet,
} from "@/lib/passkey";
import { MERA_CONNECTOR_ID } from "@/lib/meraConnector";

type WalletEntryContextValue = {
  openEntry: () => void;
  openAccount: () => void;
  isPasskey: boolean;
};
const WalletEntryContext = createContext<WalletEntryContextValue | null>(null);

export function useWalletEntry() {
  const context = useContext(WalletEntryContext);
  if (!context) throw new Error("WalletEntryProvider is missing.");
  return context;
}

export function WalletEntryProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<"closed" | "choose" | "passkey" | "account">("closed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phrase, setPhrase] = useState("");
  const [copied, setCopied] = useState(false);
  const { address, connector } = useAccount();
  const isPasskey = connector?.id === MERA_CONNECTOR_ID;
  const { connectors, connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();

  const available = passkeyEnabled();
  useEffect(() => {
    if (view === "closed") dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [view]);

  const close = useCallback(() => {
    if (busy) return;
    setView("closed");
    setError("");
    setPhrase("");
    setCopied(false);
  }, [busy]);
  const openEntry = useCallback(() => {
    setError("");
    setView("choose");
  }, []);
  const openAccount = useCallback(() => {
    setError("");
    setView("account");
  }, []);

  async function enterPasskey(mode: "create" | "existing", another = false) {
    setBusy(true);
    setError("");
    try {
      if (mode === "create") await createPasskeyWallet();
      else await signInPasskeyWallet(another);
      if (connector?.id === MERA_CONNECTOR_ID || connector) await disconnectAsync();
      const passkeyConnector = connectors.find((item) => item.id === MERA_CONNECTOR_ID);
      if (!passkeyConnector) throw new Error("The passkey connector is unavailable.");
      await connectAsync({ connector: passkeyConnector, chainId: 143 });
      setView("closed");
    } catch (cause) {
      setError(passkeyError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revealPhrase() {
    if (!address) return;
    setBusy(true);
    setError("");
    setPhrase("");
    try {
      setPhrase(await exportPasskeyRecoveryPhrase(address));
    } catch (cause) {
      setError(passkeyError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await disconnectAsync();
      setView("closed");
      setPhrase("");
    } finally {
      setBusy(false);
    }
  }

  function externalWallet() {
    close();
    window.setTimeout(() => openConnectModal?.(), 0);
  }

  return (
    <WalletEntryContext.Provider value={{ openEntry, openAccount, isPasskey }}>
      {children}
      <dialog
        ref={dialog}
        onClose={close}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else close();
        }}
        className="border-line bg-paper text-ink m-auto w-[min(92vw,440px)] rounded-2xl border p-0 shadow-2xl backdrop:bg-black/65"
        aria-label={view === "account" ? "Account" : "Get started"}
      >
        <div className="border-line flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <p className="eyebrow">DeltaMon / Access</p>
            <h2 className="mt-1 text-xl font-semibold">
              {view === "account"
                ? "Your account"
                : view === "passkey"
                  ? "Passkey wallet"
                  : "Get started"}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="border-line text-muted hover:text-ink grid size-9 place-items-center rounded-lg border text-lg disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="space-y-3 p-6">
          {view === "choose" ? (
            <>
              <button
                type="button"
                disabled={!available}
                onClick={() => setView("passkey")}
                className="border-monad/40 bg-monad/10 hover:border-monad flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>
                  <strong className="block">Continue with passkey</strong>
                  <span className="text-muted mt-1 block text-xs">
                    Use your device or password manager. A new passkey creates a new wallet address.
                  </span>
                </span>
                <span aria-hidden="true" className="text-monad ml-3">
                  ↗
                </span>
              </button>
              {!available ? (
                <p className="text-muted text-xs">
                  Passkey wallets are available on app.deltamon.xyz after launch, or on localhost
                  when enabled.
                </p>
              ) : null}
              <button
                type="button"
                onClick={externalWallet}
                className="border-line hover:border-monad/50 flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left"
              >
                <span>
                  <strong className="block">Connect existing wallet</strong>
                  <span className="text-muted mt-1 block text-xs">
                    Keep using the address that already holds your vault position.
                  </span>
                </span>
                <span aria-hidden="true" className="text-muted ml-3">
                  ↗
                </span>
              </button>
            </>
          ) : view === "passkey" ? (
            <>
              <p className="text-muted text-sm">
                Each passkey opens its own wallet. Use the same passkey to return to an existing
                position.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void enterPasskey("existing")}
                className="button-primary w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-50"
              >
                {busy ? "Waiting for passkey…" : "Use existing passkey"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void enterPasskey("create")}
                className="border-line w-full rounded-lg border px-4 py-3 font-semibold disabled:opacity-50"
              >
                Create passkey wallet
              </button>
              {readPasskeyRecord() ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void enterPasskey("existing", true)}
                  className="text-monad text-sm underline disabled:opacity-50"
                >
                  Choose a different passkey
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => setView("choose")}
                className="text-muted block text-sm underline disabled:opacity-50"
              >
                Back to choices
              </button>
            </>
          ) : view === "account" ? (
            <>
              <div className="border-line rounded-xl border p-4">
                <p className="text-muted text-xs uppercase tracking-widest">
                  {isPasskey ? "Passkey wallet" : "Connected wallet"}
                </p>
                <p className="font-data mt-2 break-all text-sm">{address}</p>
              </div>
              {isPasskey ? (
                <>
                  <p className="text-muted text-sm">
                    If your passkey is lost and not synced, this wallet may be unrecoverable. You
                    can export a recovery phrase while you still have access.
                  </p>
                  {!phrase ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void revealPhrase()}
                      className="border-line w-full rounded-lg border px-4 py-3 text-left font-medium disabled:opacity-50"
                    >
                      {busy ? "Verifying passkey…" : "Export recovery phrase"}
                    </button>
                  ) : (
                    <div className="border-short/40 bg-short/5 rounded-xl border p-4">
                      <p className="font-semibold">Recovery phrase</p>
                      <p className="text-muted mt-1 text-xs">
                        Anyone with these words can take your funds. Store them privately. They are
                        never saved by DeltaMon.
                      </p>
                      <p
                        className="font-data mt-3 break-words text-sm leading-7"
                        aria-label="Recovery phrase"
                      >
                        {phrase}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setPhrase("");
                          setCopied(false);
                        }}
                        className="text-monad mt-3 text-sm underline"
                      >
                        Hide phrase
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(phrase)
                            .then(() => setCopied(true))
                            .catch(() =>
                              setError("Could not copy the phrase. Record it manually."),
                            );
                        }}
                        className="text-monad ml-4 text-sm underline"
                      >
                        {copied ? "Copied" : "Copy phrase"}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void enterPasskey("existing", true)}
                    className="text-monad block text-sm underline disabled:opacity-50"
                  >
                    Switch passkey wallet
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    window.setTimeout(() => openAccountModal?.(), 0);
                  }}
                  className="border-line w-full rounded-lg border px-4 py-3 text-left font-medium"
                >
                  Wallet details
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void signOut()}
                className="border-line w-full rounded-lg border px-4 py-3 text-left font-medium disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="text-short rounded-lg border border-short/30 p-3 text-sm">
              {error}
            </p>
          ) : null}
        </div>
      </dialog>
    </WalletEntryContext.Provider>
  );
}
