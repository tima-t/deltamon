"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { AutomationConfig, FlowPeriod } from "@deltamon/shared";
import {
  AutomationError,
  fetchAutomationConfig,
  fetchFlows,
  saveAutomationConfig,
} from "@/lib/automation";
import { isLive, usePerpSession } from "@/lib/perpSession";
import { shortAddr } from "@/lib/vault";
import { Card, Pill, Stat } from "./ui";

/**
 * The allocation pipeline's settings, and what its runs have done.
 *
 * Only the vault's owner can change anything here, proven by the same signature the perp tab uses.
 * Everyone else sees the settings read-only, because what the vault does automatically is not a
 * secret from the people whose money it is.
 */

const PERIODS: { value: FlowPeriod; label: string }[] = [
  { value: "deposit", label: "Every deposit" },
  { value: "12h", label: "Every 12 hours" },
  { value: "24h", label: "Every 24 hours" },
];

type Draft = Omit<AutomationConfig, "updatedAt" | "updatedBy">;

export function AutomationPanel() {
  const { address } = useAccount();
  const { session } = usePerpSession();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const { data, error, refetch } = useQuery({
    queryKey: ["automation-config"],
    queryFn: fetchAutomationConfig,
    retry: false,
    refetchInterval: 30_000,
  });
  const { data: flowData } = useQuery({
    queryKey: ["automation-flows"],
    queryFn: fetchFlows,
    retry: false,
    refetchInterval: 10_000,
  });

  const saved = data?.config;
  const current: Draft | null = draft ?? (saved ? stripMeta(saved) : null);
  const isAdmin = Boolean(
    address && data?.admin && address.toLowerCase() === data.admin.toLowerCase(),
  );
  const signedIn = isLive(session);
  const canEdit = isAdmin && signedIn;
  const dirty = Boolean(
    draft && saved && JSON.stringify(draft) !== JSON.stringify(stripMeta(saved)),
  );

  async function save() {
    if (!current) return;
    setBusy(true);
    setNotice(null);
    try {
      await saveAutomationConfig(current);
      await refetch();
      setDraft(null);
      setNotice({ tone: "ok", text: "Saved. The runner picks it up on its next tick." });
    } catch (err) {
      setNotice({
        tone: "bad",
        text: err instanceof AutomationError ? err.message : "Could not save the config.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Card title="Automation">
        <p className="text-short text-sm">
          {error instanceof AutomationError ? error.message : "Automation is unavailable."}
        </p>
        <p className="text-muted text-sm">
          The pipeline keeps its state in MongoDB. Set{" "}
          <code className="font-mono text-xs">MONGO_CONNECTION_STRING</code> in{" "}
          <code className="font-mono text-xs">apps/be/.env</code> and restart the backend.
        </p>
      </Card>
    );
  }

  if (!current) return <p className="text-muted text-sm">Reading the automation config…</p>;

  const set = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <Card
        title="Pipeline"
        subtitle="On each trigger: buy MON and AUSD, stake the MON, fund the manager, short the same size."
      >
        <div className="border-line flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="font-medium">Automation enabled</div>
            <div className="text-muted text-xs">
              {current.enabled
                ? "The backend signs vault transactions on its own."
                : "Nothing is signed while this is off."}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={current.enabled}
            aria-label="Automation enabled"
            disabled={!canEdit}
            onClick={() => set({ enabled: !current.enabled })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              current.enabled ? "bg-monad" : "bg-line"
            }`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
                current.enabled ? "left-[1.375rem]" : "left-0.5"
              }`}
            />
          </button>
        </div>

        <label className="block">
          <div className="flex items-baseline justify-between">
            <span className="text-sm">MON / AUSD split ratio</span>
            <span className="tabular-nums text-sm">
              {(current.monAusdSplitRatio * 100).toFixed(0)}% MON ·{" "}
              {(100 - current.monAusdSplitRatio * 100).toFixed(0)}% AUSD
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={current.monAusdSplitRatio}
            disabled={!canEdit}
            onChange={(e) => set({ monAusdSplitRatio: Number(e.target.value) })}
            className="mt-2 w-full disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="text-sm">Flow pipeline period</span>
          <select
            value={current.flowPipelinePeriod}
            disabled={!canEdit}
            onChange={(e) => set({ flowPipelinePeriod: e.target.value as FlowPeriod })}
            className="border-line focus:border-monad mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-muted mt-1 block text-xs">
            {current.flowPipelinePeriod === "deposit"
              ? "Runs on each deposit, for that deposit's USDC."
              : "Runs on a timer, for whatever idle USDC the vault holds."}
          </span>
        </label>

        <label className="block">
          <div className="flex items-baseline justify-between">
            <span className="text-sm">Unbond buffer level</span>
            <span className="tabular-nums text-sm">
              {current.unbondBufferLevel === 0 ? "off" : `${current.unbondBufferLevel}%`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={current.unbondBufferLevel}
            disabled={!canEdit}
            onChange={(e) => set({ unbondBufferLevel: Number(e.target.value) })}
            className="mt-2 w-full disabled:opacity-50"
          />
          <span className="text-muted mt-1 block text-xs">
            {current.unbondBufferLevel === 0
              ? "The monitor is off. Nothing unbonds automatically."
              : `Unbonds the whole stake when the short's liquidation buffer falls to ${current.unbondBufferLevel}%.`}
          </span>
        </label>

        <label className="block">
          <div className="flex items-baseline justify-between">
            <span className="text-sm">Short leverage</span>
            <span className="tabular-nums text-sm">{current.shortLeverage / 100}x</span>
          </div>
          <input
            type="range"
            min={100}
            max={1000}
            step={10}
            value={current.shortLeverage}
            disabled={!canEdit}
            onChange={(e) => set({ shortLeverage: Number(e.target.value) })}
            className="mt-2 w-full disabled:opacity-50"
          />
          <span className="text-muted mt-1 block text-xs">
            A {(current.monAusdSplitRatio * 100).toFixed(0)}/
            {(100 - current.monAusdSplitRatio * 100).toFixed(0)} split implies about{" "}
            {current.monAusdSplitRatio < 1
              ? (current.monAusdSplitRatio / (1 - current.monAusdSplitRatio)).toFixed(2)
              : "∞"}
            x. Perpl is funded outside the pipeline, so the short fails if its collateral cannot
            cover this.
          </span>
        </label>

        {canEdit ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => void save()}
              className="bg-monad hover:bg-monad-deep rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save config"}
            </button>
            {dirty ? (
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="border-line hover:border-ink rounded-md border px-3 py-2 text-sm"
              >
                Discard
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-muted text-sm">
            {!isAdmin
              ? `Read only: only the vault admin ${shortAddr(data?.admin ?? undefined)} can change this.`
              : "Sign in on the Perp position tab to edit."}
          </p>
        )}

        {notice ? (
          <p className={notice.tone === "ok" ? "text-long text-sm" : "text-short text-sm"}>
            {notice.text}
          </p>
        ) : null}

        <div className="border-line grid grid-cols-2 gap-4 border-t pt-4">
          <Stat
            label="Signing key"
            value={data?.ready ? <Pill tone="good">loaded</Pill> : <Pill tone="warn">missing</Pill>}
            hint={data?.ready ? undefined : "set ADMIN_PRIVATE_KEY"}
          />
          <Stat
            label="Last changed"
            value={saved?.updatedAt ? saved.updatedAt.slice(0, 19).replace("T", " ") : "never"}
            hint={saved?.updatedBy ? `by ${shortAddr(saved.updatedBy)}` : undefined}
          />
        </div>
      </Card>

      <Card title="Pipeline runs" subtitle="Each run, step by step, with why a step stopped.">
        {flowData?.flows.length ? (
          <div className="space-y-3">
            {flowData.flows.map((flow) => (
              <div key={flow.triggerKey} className="border-line rounded-lg border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">
                    {(Number(flow.usdcIn) / 1e6).toFixed(2)} USDC · {flow.trigger}
                  </span>
                  <Pill
                    tone={
                      flow.status === "done" ? "good" : flow.status === "failed" ? "warn" : "flat"
                    }
                  >
                    {flow.status}
                  </Pill>
                </div>
                <ol className="mt-2 space-y-1">
                  {flow.steps.map((step) => (
                    <li key={step.name} className="flex items-baseline gap-2 text-xs">
                      <span className="w-40 shrink-0 font-mono">{step.name}</span>
                      <span
                        className={
                          step.status === "done"
                            ? "text-long"
                            : step.status === "failed" || step.status === "needs-review"
                              ? "text-short"
                              : "text-muted"
                        }
                      >
                        {step.status}
                        {step.attempts > 1 ? ` (${step.attempts} tries)` : ""}
                      </span>
                      {step.error ? (
                        <span className="text-muted truncate">{step.error}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
                <div className="text-muted mt-1 text-[11px]">
                  {flow.createdAt.slice(0, 19).replace("T", " ")}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">
            No runs yet.{" "}
            {current.enabled
              ? "The next trigger will start one."
              : "Turn the automation on to start one."}
          </p>
        )}
      </Card>
    </div>
  );
}

/** The editable half of the config: everything except who last touched it. */
function stripMeta(config: AutomationConfig): Draft {
  return {
    enabled: config.enabled,
    monAusdSplitRatio: config.monAusdSplitRatio,
    flowPipelinePeriod: config.flowPipelinePeriod,
    unbondBufferLevel: config.unbondBufferLevel,
    shortLeverage: config.shortLeverage,
  };
}
