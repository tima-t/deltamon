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
import { WalletEntryArt } from "./WalletEntryArt";

type WalletEntryContextValue = {
  openEntry: () => void;
  openAccount: () => void;
  isPasskey: boolean;
};
type View = "closed" | "choose" | "passkey" | "account";
type BusyAction = "existing" | "create" | "switch" | "export" | "disconnect" | null;
type ErrorAction = Exclude<BusyAction, null> | "copy" | null;

const WalletEntryContext = createContext<WalletEntryContextValue | null>(null);

export function useWalletEntry() {
  const context = useContext(WalletEntryContext);
  if (!context) throw new Error("WalletEntryProvider is missing.");
  return context;
}

function ChoiceArrow() {
  return (
    <span className="wallet-entry-arrow" aria-hidden="true">
      ↗
    </span>
  );
}

export function WalletEntryProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<View>("closed");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState<ErrorAction>(null);
  const [phraseRecord, setPhraseRecord] = useState<{ address: string; words: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { address, connector } = useAccount();
  const isPasskey = connector?.id === MERA_CONNECTOR_ID;
  const { connectors, connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();

  const available = passkeyEnabled();
  const busy = busyAction !== null;
  const phrase = phraseRecord && phraseRecord.address === address ? phraseRecord.words : "";

  useEffect(() => {
    if (view === "closed") dialog.current?.close();
    else {
      if (!dialog.current?.open) dialog.current?.showModal();
      heading.current?.focus();
    }
  }, [view]);

  const close = useCallback(() => {
    if (busy) return;
    setView("closed");
    setError("");
    setErrorAction(null);
    setPhraseRecord(null);
    setCopied(false);
  }, [busy]);

  const openEntry = useCallback(() => {
    setError("");
    setErrorAction(null);
    setPhraseRecord(null);
    setCopied(false);
    setView("choose");
  }, []);

  const openAccount = useCallback(() => {
    setError("");
    setErrorAction(null);
    setPhraseRecord(null);
    setCopied(false);
    setView("account");
  }, []);

  async function enterPasskey(mode: "create" | "existing", another = false) {
    setBusyAction(another ? "switch" : mode);
    setError("");
    setErrorAction(null);
    setPhraseRecord(null);
    setCopied(false);
    let disconnected = false;
    try {
      if (mode === "create") await createPasskeyWallet();
      else await signInPasskeyWallet(another);
      if (connector) {
        await disconnectAsync();
        disconnected = true;
      }
      const passkeyConnector = connectors.find((item) => item.id === MERA_CONNECTOR_ID);
      if (!passkeyConnector) throw new Error("The passkey connector is unavailable.");
      await connectAsync({ connector: passkeyConnector, chainId: 143 });
      setView("closed");
    } catch (cause) {
      setError(passkeyError(cause));
      setErrorAction(another ? "switch" : mode);
      if (disconnected) setView("passkey");
    } finally {
      setBusyAction(null);
    }
  }

  async function revealPhrase() {
    if (!address) return;
    setBusyAction("export");
    setError("");
    setErrorAction(null);
    setPhraseRecord(null);
    setCopied(false);
    try {
      setPhraseRecord({ address, words: await exportPasskeyRecoveryPhrase(address) });
    } catch (cause) {
      setError(passkeyError(cause));
      setErrorAction("export");
    } finally {
      setBusyAction(null);
    }
  }

  async function signOut() {
    setBusyAction("disconnect");
    setError("");
    setErrorAction(null);
    try {
      await disconnectAsync();
      setView("closed");
      setPhraseRecord(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect this wallet.");
      setErrorAction("disconnect");
    } finally {
      setBusyAction(null);
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
        className="wallet-entry-dialog"
        data-view={view}
        aria-label={
          view === "account"
            ? "Your account"
            : view === "passkey"
              ? "Passkey wallet"
              : "Get started"
        }
      >
        <div className="wallet-entry-layout">
          <WalletEntryArt />
          <div className="wallet-entry-content">
            <div className="wallet-entry-topline">
              <span>DELTAMON / {view === "account" ? "YOUR ACCOUNT" : "GET STARTED"}</span>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="wallet-entry-close"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {view === "choose" ? (
              <div className="wallet-entry-view wallet-entry-view-choose">
                <div className="wallet-entry-intro">
                  <h2 ref={heading} tabIndex={-1}>
                    A way in,
                    <br />
                    made yours.
                  </h2>
                  <p>Choose the address you want to use. Your position stays with that address.</p>
                </div>
                <div className="wallet-entry-choices">
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => setView("passkey")}
                    className="wallet-entry-choice"
                  >
                    <span>
                      <strong>Continue with passkey</strong>
                      <small>Use your device or password manager.</small>
                    </span>
                    <ChoiceArrow />
                  </button>
                  <button type="button" onClick={externalWallet} className="wallet-entry-choice">
                    <span>
                      <strong>Connect existing wallet</strong>
                      <small>Keep using an address you already hold.</small>
                    </span>
                    <ChoiceArrow />
                  </button>
                  {!available ? (
                    <p className="wallet-entry-availability">
                      Passkey wallets are available on app.deltamon.xyz after launch, or on
                      localhost when enabled.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : view === "passkey" ? (
              <div className="wallet-entry-view wallet-entry-view-passkey">
                <div className="wallet-entry-intro">
                  <span className="wallet-entry-step">01 / PASSKEY</span>
                  <h2 ref={heading} tabIndex={-1}>
                    Your passkey
                    <br />
                    wallet.
                  </h2>
                  <p>
                    Use the same passkey to return to your position. Creating a new passkey opens a
                    new wallet address.
                  </p>
                </div>
                <div className="wallet-entry-actions" aria-busy={busy}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void enterPasskey("existing")}
                    className="wallet-entry-action wallet-entry-action-primary"
                  >
                    <span>
                      <strong>Use existing passkey</strong>
                      <small>Return to its wallet address</small>
                    </span>
                    <ChoiceArrow />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void enterPasskey("create")}
                    className="wallet-entry-action"
                  >
                    <span>
                      <strong>Create passkey wallet</strong>
                      <small>Open a new wallet address</small>
                    </span>
                    <ChoiceArrow />
                  </button>
                  {busyAction === "existing" || busyAction === "create" ? (
                    <p className="wallet-entry-status" role="status">
                      Waiting for your passkey confirmation…
                    </p>
                  ) : null}
                  {error && errorAction !== null ? (
                    <p role="alert" className="wallet-entry-error">
                      {error}
                    </p>
                  ) : null}
                  {readPasskeyRecord() ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void enterPasskey("existing", true)}
                      className="wallet-entry-text-action"
                    >
                      Choose a different passkey <span aria-hidden="true">↗</span>
                    </button>
                  ) : null}
                  {busyAction === "switch" ? (
                    <p className="wallet-entry-status" role="status">
                      Waiting for the other passkey…
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setErrorAction(null);
                      setView("choose");
                    }}
                    className="wallet-entry-text-action wallet-entry-back"
                  >
                    <span aria-hidden="true">←</span> Back to choices
                  </button>
                </div>
              </div>
            ) : view === "account" ? (
              <div className="wallet-entry-view wallet-entry-view-account">
                <div className="wallet-entry-intro">
                  <span className="wallet-entry-step">01 / ACTIVE ADDRESS</span>
                  <h2 ref={heading} tabIndex={-1}>
                    Your account.
                  </h2>
                  <p>Use this address to return to your position.</p>
                </div>
                <section
                  className="wallet-entry-address"
                  aria-label={isPasskey ? "Passkey wallet address" : "Connected wallet address"}
                >
                  <span>{isPasskey ? "PASSKEY WALLET" : "CONNECTED WALLET"}</span>
                  <p className="font-data">{address ?? "Address unavailable"}</p>
                </section>
                {isPasskey ? (
                  <div className="wallet-entry-account-actions">
                    <p className="wallet-entry-recovery-explain">
                      If your passkey is lost and not synced, this wallet may be unrecoverable. You
                      can export a recovery phrase while you still have access.
                    </p>
                    {!phrase ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void revealPhrase()}
                        className="wallet-entry-action"
                      >
                        <span>
                          <strong>Export recovery phrase</strong>
                          <small>Requires a fresh passkey check</small>
                        </span>
                        <ChoiceArrow />
                      </button>
                    ) : (
                      <section className="wallet-entry-recovery" aria-label="Recovery phrase">
                        <h3>Recovery phrase</h3>
                        <p>
                          Anyone with these words can take your funds. Store them privately. They
                          are never saved by DeltaMon.
                        </p>
                        <p
                          className="wallet-entry-phrase font-data"
                          aria-label="Recovery phrase words"
                        >
                          {phrase}
                        </p>
                        <div className="wallet-entry-recovery-controls">
                          <button
                            type="button"
                            onClick={() => {
                              setPhraseRecord(null);
                              setCopied(false);
                              setError("");
                              setErrorAction(null);
                            }}
                            className="wallet-entry-text-action"
                          >
                            Hide phrase
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCopied(false);
                              setError("");
                              setErrorAction(null);
                              void navigator.clipboard
                                .writeText(phrase)
                                .then(() => setCopied(true))
                                .catch(() => {
                                  setError("Could not copy the phrase. Record it manually.");
                                  setErrorAction("copy");
                                });
                            }}
                            className="wallet-entry-text-action"
                          >
                            {copied ? "Copied" : "Copy phrase"}
                          </button>
                        </div>
                        {copied ? (
                          <p className="wallet-entry-status" role="status">
                            Recovery phrase copied.
                          </p>
                        ) : null}
                        {error && errorAction === "copy" ? (
                          <p role="alert" className="wallet-entry-error">
                            {error}
                          </p>
                        ) : null}
                      </section>
                    )}
                    {busyAction === "export" ? (
                      <p className="wallet-entry-status" role="status">
                        Verifying your passkey…
                      </p>
                    ) : null}
                    {error && errorAction === "export" ? (
                      <p role="alert" className="wallet-entry-error">
                        {error}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void enterPasskey("existing", true)}
                      className="wallet-entry-text-action"
                    >
                      Switch passkey wallet <span aria-hidden="true">↗</span>
                    </button>
                    {busyAction === "switch" ? (
                      <p className="wallet-entry-status" role="status">
                        Waiting for the other passkey…
                      </p>
                    ) : null}
                    {error && errorAction === "switch" ? (
                      <p role="alert" className="wallet-entry-error">
                        {error}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      close();
                      window.setTimeout(() => openAccountModal?.(), 0);
                    }}
                    className="wallet-entry-action"
                  >
                    <span>
                      <strong>Wallet details</strong>
                      <small>Open connected wallet controls</small>
                    </span>
                    <ChoiceArrow />
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void signOut()}
                  className="wallet-entry-disconnect"
                >
                  {busyAction === "disconnect" ? "Disconnecting…" : "Disconnect"}
                  <span aria-hidden="true">↗</span>
                </button>
                {busyAction === "disconnect" ? (
                  <p className="wallet-entry-status" role="status">
                    Disconnecting this wallet…
                  </p>
                ) : null}
                {error && errorAction === "disconnect" ? (
                  <p role="alert" className="wallet-entry-error">
                    {error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </dialog>
    </WalletEntryContext.Provider>
  );
}
