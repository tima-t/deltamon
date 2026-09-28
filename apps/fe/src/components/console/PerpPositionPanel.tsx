"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import {
  PerpApiError,
  closeShort,
  fetchPerpAccess,
  fetchPerpAccount,
  openShort,
  requestChallenge,
  signOutPerp,
  verifySignature,
  type PerpAccount,
} from "@/lib/perp";
import { hoursLeft, isLive, storeSession, usePerpSession } from "@/lib/perpSession";
import { fmtUsdc, shortAddr } from "@/lib/vault";
import { ActionForm, Card, Pill, Stat } from "./ui";

/**
 * A manager's Perpl account: what it holds, what is open, and the two orders worth a button.
 *
 * The backend brokers all of it. Perpl publishes balances and positions only over an authenticated
 * socket signed with an Ed25519 key, so that key lives in apps/be and this tab names an address.
 */
const usd = (v: number | null | undefined, signed = false) =>
  v === null || v === undefined
    ? "—"
    : `${signed && v > 0 ? "+" : signed && v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

const price = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 6 });

const signClass = (v: number | null | undefined) =>
  v === null || v === undefined || v === 0 ? "" : v > 0 ? "text-long" : "text-short";

/** Realised plus what has accrued since entry, as the backend already worked it out. */
const fundingTotal = (v: { fundingAccruedUsd: number | null } | undefined) =>
  v?.fundingAccruedUsd ?? null;

/** Minutes until a unix-ms instant, floored at zero. Module level: the clock is not read in render. */
function minutesUntil(atMs: number | null | undefined): number | null {
  if (atMs === null || atMs === undefined) return null;
  return Math.max(0, Math.round((atMs - Date.now()) / 60_000));
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <span className="inline-flex min-w-0 flex-col">
      <span className="text-muted text-[11px] tracking-wide uppercase">{label}</span>
      <span className={`tabular-nums ${className ?? ""}`}>{value}</span>
    </span>
  );
}

export function PerpPositionPanel() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { session, ready, signOut } = usePerpSession();

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const live = isLive(session);
  const { data: access } = useQuery({
    queryKey: ["perp-access"],
    queryFn: fetchPerpAccess,
    retry: false,
    staleTime: 60_000,
  });
  const signers = access?.managers ?? [];
  const maySignIn = Boolean(
    address && signers.some((s) => s.toLowerCase() === address.toLowerCase()),
  );

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setNotice(null);
    try {
      const challenge = await requestChallenge(address);
      const signature = await signMessageAsync({ message: challenge.message });
      const issued = await verifySignature(address, challenge.nonce, signature);
      storeSession({
        address: issued.address,
        token: issued.token,
        expiresAt: Date.parse(issued.expiresAt),
      });
      setNotice({ tone: "ok", text: "Signed in. This session lasts 24 hours." });
    } catch (err) {
      setNotice({
        tone: "bad",
        text:
          err instanceof PerpApiError
            ? err.message
            : "Sign in failed. The signature was rejected or cancelled.",
      });
    } finally {
      setBusy(false);
    }
  }

  // The socket lives on the backend, so the panel polls its last snapshot rather than holding one.
  const {
    data: account,
    error,
    refetch,
  } = useQuery<PerpAccount>({
    queryKey: ["perp-account"],
    queryFn: fetchPerpAccount,
    enabled: live,
    refetchInterval: 6_000,
    retry: false,
  });
  const loadError = error
    ? error instanceof PerpApiError
      ? error.message
      : "Could not read the account."
    : null;

  async function submit(what: string, run: () => Promise<{ sent: number }>) {
    setBusy(true);
    setNotice(null);
    try {
      const { sent } = await run();
      setNotice({ tone: "ok", text: `${what}: ${sent} order frame${sent === 1 ? "" : "s"} sent.` });
      await refetch();
    } catch (err) {
      setNotice({
        tone: "bad",
        text: err instanceof PerpApiError ? err.message : `${what} failed.`,
      });
    } finally {
      setBusy(false);
    }
  }

  if (ready && !live) {
    return (
      <Card title="Sign in to the perp console">
        <p className="text-muted text-sm">
          Reading balances or sending an order needs a signature from an address listed in{" "}
          <code className="font-mono text-xs">PERPL_MANAGERS</code>. Signing costs nothing and sends
          no transaction. The backend checks it and returns a token good for 24 hours.
        </p>
        {signers.length === 0 ? (
          <p className="text-short text-sm">
            No addresses are allowed yet. Set{" "}
            <code className="font-mono text-xs">PERPL_MANAGERS</code> in{" "}
            <code className="font-mono text-xs">apps/be/.env</code> to a comma separated list of
            public addresses, then restart the backend.
          </p>
        ) : !address ? (
          <p className="text-muted text-sm">Connect a wallet to sign in.</p>
        ) : !maySignIn ? (
          <p className="text-short text-sm">
            {shortAddr(address)} is not in the allow list. Connect one of:{" "}
            <span className="font-mono text-xs">{signers.map(shortAddr).join(", ")}</span>
          </p>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void signIn()}
            className="bg-monad hover:bg-monad-deep rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            {busy ? "Waiting for your signature…" : `Sign in as ${shortAddr(address)}`}
          </button>
        )}
        {notice ? (
          <p className={notice.tone === "ok" ? "text-long text-sm" : "text-short text-sm"}>
            {notice.text}
          </p>
        ) : null}
      </Card>
    );
  }

  if (access && !access.configured) {
    return (
      <Card title="Perp position">
        <p className="text-muted text-sm">
          The backend holds no Perpl credentials yet. Run{" "}
          <code className="font-mono text-xs">pnpm --filter @deltamon/be perpl:enroll</code>, then
          set <code className="font-mono text-xs">PERPL_API_KEY</code> and{" "}
          <code className="font-mono text-xs">PERPL_API_KEY_SECRET</code> in{" "}
          <code className="font-mono text-xs">apps/be/.env</code> and restart it. Everyone in{" "}
          <code className="font-mono text-xs">PERPL_MANAGERS</code> trades through that one account.
        </p>
      </Card>
    );
  }

  // Perpl reports collateral in the settlement token's units, which is USDC at six decimals.
  const units = (raw: string | null | undefined) => {
    if (raw === null || raw === undefined) return "—";
    try {
      return `${fmtUsdc(BigInt(raw))} USDC`;
    } catch {
      return raw;
    }
  };
  const utilization = account?.marginUtilizationPct;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <Card
        title="Account"
        subtitle={
          account?.accountAddress
            ? `Perpl account ${account.accountId ?? "?"} · ${shortAddr(account.accountAddress)} · shared by everyone in PERPL_MANAGERS`
            : "Shared by everyone in PERPL_MANAGERS."
        }
      >
        <div className="border-line flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="text-muted">
            Signed in as <span className="font-mono">{shortAddr(session?.address)}</span>
            {session ? ` · ${hoursLeft(session)}h left` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              void signOutPerp().catch(() => undefined);
              signOut();
            }}
            className="border-line hover:border-ink rounded-md border px-2 py-1 text-xs"
          >
            Sign out
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Stat
            label="Socket"
            value={
              account?.connected ? (
                <Pill tone="good">connected</Pill>
              ) : (
                <Pill tone="warn">offline</Pill>
              )
            }
            hint={account?.updatedAt ? `updated ${account.updatedAt.slice(11, 19)} UTC` : undefined}
          />
          <Stat
            label="Order forwarding"
            value={
              account?.forwarding === false ? (
                <Pill tone="warn">off</Pill>
              ) : account?.forwarding === true ? (
                <Pill tone="good">on</Pill>
              ) : (
                "—"
              )
            }
            hint="Perpl rejects orders while this is off"
          />
          <Stat label="Available balance" value={units(account?.availableBalance)} />
          <Stat label="Locked as margin" value={units(account?.lockedBalance)} />
          <Stat
            label="Margin utilization"
            value={utilization === null || utilization === undefined ? "—" : `${utilization}%`}
            hint="locked over total, derived: Perpl publishes no margin figure"
          />
          <Stat label="Open orders" value={account?.openOrders ?? "—"} />
        </div>

        {loadError ? <p className="text-short text-sm">{loadError}</p> : null}
        {account?.lastError ? (
          <p className="text-short text-sm">Perpl socket: {account.lastError}</p>
        ) : null}
      </Card>

      <Card title="Open positions">
        {account && account.positions.length > 0 ? (
          <div className="space-y-3">
            {account.positions.map((p, i) => {
              const v = p.view;
              const buffer = v?.liquidationBuffer ?? null;
              return (
                <div
                  key={v?.positionId ?? `${p.market}-${i}`}
                  className="border-line rounded-lg border p-3"
                >
                  {/* What the position is */}
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                    <span className="inline-flex items-baseline gap-1.5">
                      {v?.side === "short" ? (
                        <Pill tone="warn">short</Pill>
                      ) : v?.side === "long" ? (
                        <Pill tone="good">long</Pill>
                      ) : (
                        <Pill tone="flat">—</Pill>
                      )}
                      {v?.leverage ? (
                        <span className="text-muted text-xs">{v.leverage}x</span>
                      ) : null}
                    </span>
                    <Field
                      label="Size"
                      value={`${v?.size ?? "—"}${v?.marketName ? ` ${v.marketName}` : ""}`}
                    />
                    <Field label="Entry" value={price(v?.entryPrice)} />
                    <Field label="Mark" value={price(v?.markPrice)} />
                    <Field label="Notional" value={usd(v?.notionalUsd)} />
                    <Field label="Collateral" value={usd(v?.collateralUsd)} />
                  </div>

                  {/* How it is doing and how much room it has */}
                  <div className="border-line mt-2.5 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t pt-2.5">
                    <Field
                      label="Unrealised PnL"
                      value={usd(v?.unrealisedPnlUsd, true)}
                      className={signClass(v?.unrealisedPnlUsd)}
                    />
                    <Field
                      label="Funding"
                      value={usd(fundingTotal(v), true)}
                      className={signClass(fundingTotal(v))}
                    />
                    <Field label="Est. liquidation" value={price(v?.liquidationPrice)} />
                    <Field
                      label="Buffer to liquidation"
                      value={
                        buffer === null ? (
                          "—"
                        ) : (
                          <Pill tone={buffer < 0.1 ? "warn" : buffer < 0.25 ? "flat" : "good"}>
                            {(buffer * 100).toFixed(1)}%
                          </Pill>
                        )
                      }
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-muted text-xs">
              Perpl publishes no liquidation price, so it is derived from each position&apos;s
              collateral against the market&apos;s maintenance margin
              {account.positions[0]?.view?.maintenanceMargin !== null &&
              account.positions[0]?.view?.maintenanceMargin !== undefined
                ? ` (${(account.positions[0].view.maintenanceMargin * 100).toFixed(1)}%)`
                : ""}
              . Treat it as an estimate and check it against Perpl before relying on it.
            </p>
          </div>
        ) : (
          <p className="text-muted text-sm">
            {account?.connected ? "No open positions." : "Waiting for the Perpl socket."}
          </p>
        )}
      </Card>

      {account?.positions.length ? (
        <Card title="Funding" subtitle="What the position pays or earns to stay open.">
          {account.positions.map((p, i) => {
            const v = p.view;
            if (!v) return null;
            const due = minutesUntil(v.nextFundingAtMs);
            return (
              <div key={v.positionId ?? i} className="grid grid-cols-2 gap-4">
                <Stat
                  label="Accrued so far"
                  value={
                    <span className={signClass(v.fundingAccruedUsd)}>
                      {usd(v.fundingAccruedUsd, true)}
                    </span>
                  }
                  hint={`${usd(v.realisedFundingUsd, true)} settled · ${usd(v.unrealisedFundingUsd, true)} since entry`}
                />
                <Stat
                  label="Rate per interval"
                  value={v.fundingRate === null ? "—" : `${(v.fundingRate * 100).toFixed(4)}%`}
                  hint={
                    v.fundingRateAnnualised === null
                      ? undefined
                      : `${(v.fundingRateAnnualised * 100).toFixed(1)}% annualised`
                  }
                />
                <Stat
                  label="Next funding"
                  value={due === null ? "—" : due === 0 ? "due now" : `in ${due} min`}
                  hint={
                    v.fundingIntervalSec
                      ? `every ${Math.round(v.fundingIntervalSec / 60)} min`
                      : undefined
                  }
                />
                <Stat
                  label="Position"
                  value={`${v.size ?? "—"} ${v.side ?? ""}`}
                  hint={`entered at ${price(v.entryPrice)}`}
                />
              </div>
            );
          })}
          <p className="text-muted text-xs">
            Accrued funding is the market&apos;s cumulative funding sum less the sum recorded when
            this position opened, times its size. It moves only when funding settles, so it sits at
            zero between intervals.
          </p>
        </Card>
      ) : null}

      <Card title="Open short" subtitle="MON perpetual, market order.">
        <ActionForm
          title="Open short"
          note="Leverage is required by Perpl and defaults to 1x. Stop loss and take profit are optional; they post as linked trigger orders that close the short, and are cancelled with it."
          fields={[
            { name: "size", label: "Size (MON)", kind: "text", placeholder: "25" },
            { name: "leverage", label: "Leverage (x)", kind: "text", placeholder: "1" },
            {
              name: "stopLoss",
              label: "Stop loss price (optional)",
              kind: "text",
              placeholder: "0.030000",
            },
            {
              name: "takeProfit",
              label: "Take profit price (optional)",
              kind: "text",
              placeholder: "0.020000",
            },
          ]}
          button="Open short"
          busy={busy}
          disabled={!account?.connected}
          onRun={(v) => {
            const text = (k: string) => {
              const raw = v[k];
              return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
            };
            const size = text("size");
            if (!size) {
              setNotice({ tone: "bad", text: "Enter a size." });
              return;
            }
            // Perpl counts leverage in hundredths, so 1x is 100.
            const asked = text("leverage");
            const leverage = asked === undefined ? undefined : Math.round(Number(asked) * 100);
            if (leverage !== undefined && (!Number.isFinite(leverage) || leverage <= 0)) {
              setNotice({ tone: "bad", text: "Leverage must be a number above zero." });
              return;
            }
            void submit("Open short", () =>
              openShort({
                size,
                leverage,
                stopLoss: text("stopLoss"),
                takeProfit: text("takeProfit"),
              }),
            );
          }}
        />
      </Card>

      <Card title="Close short" subtitle="Buys the position back at market.">
        <ActionForm
          title="Close short"
          note="Closing the whole size also cancels any trigger orders linked to the position."
          fields={[{ name: "size", label: "Size (MON)", kind: "text", placeholder: "25" }]}
          button="Close short"
          busy={busy}
          disabled={!account?.connected}
          onRun={(v) => {
            const raw = v.size;
            const size = typeof raw === "string" ? raw.trim() : "";
            if (size === "") {
              setNotice({ tone: "bad", text: "Enter a size." });
              return;
            }
            void submit("Close short", () => closeShort(size));
          }}
        />
      </Card>

      {notice ? (
        <div className="lg:col-span-2">
          <p className={notice.tone === "ok" ? "text-long text-sm" : "text-short text-sm"}>
            {notice.text}
          </p>
        </div>
      ) : null}
    </div>
  );
}
