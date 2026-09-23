"use client";

import { getDepositStages } from "@/lib/crosschain/progress";

export function DepositJourney({
  status,
  sourceName,
  sourceTxSent,
  mintConfirmed,
}: {
  status?: string;
  sourceName: string;
  sourceTxSent: boolean;
  mintConfirmed: boolean;
}) {
  const stages = getDepositStages(status, sourceName, sourceTxSent, mintConfirmed);
  const completed = stages.filter((item) => item.state === "complete").length;
  const current = stages.findIndex((item) => item.state === "active" || item.state === "failed");
  const progress = Math.min(100, (completed + (current >= 0 && stages[current]?.state === "active" ? 0.3 : 0)) * 25);

  return (
    <section aria-label="Deposit progress" className="border-line bg-surface/60 rounded-xl border px-4 py-4 shadow-[0_8px_28px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Deposit progress</h3>
        <span className="text-muted text-xs tabular-nums" aria-live="polite">
          {current >= 0 ? `Step ${current + 1} of 4` : "4 of 4 complete"}
        </span>
      </div>
      <div className="bg-line mt-3 h-1 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={completed} aria-label="Completed deposit steps">
        <div className={`deposit-progress-fill bg-monad h-full rounded-full ${current >= 0 && stages[current]?.state === "active" ? "deposit-progress-active" : ""}`} style={{ width: `${progress}%` }} />
      </div>
      <ol className="mt-4 space-y-1">
        {stages.map((item, index) => (
          <li key={item.title} className={`deposit-stage deposit-stage-${item.state} relative flex gap-3 rounded-lg px-2 py-2.5 ${item.state === "active" ? "bg-monad/10" : ""}`}>
            {index < stages.length - 1 ? <span aria-hidden="true" className={`absolute left-[23px] top-10 -bottom-3 w-px ${item.state === "complete" ? "bg-long/50" : "bg-line"}`} /> : null}
            <span aria-hidden="true" className={`deposit-stage-mark relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${
              item.state === "complete" ? "border-long/35 bg-long/15 text-long" :
              item.state === "active" ? "border-monad bg-monad text-white" :
              item.state === "failed" ? "border-short/40 bg-short/15 text-short" :
              "border-line bg-paper text-muted"
            }`}>
              {item.state === "complete" ? "✓" : item.state === "failed" ? "!" : index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-sm font-medium ${item.state === "waiting" ? "text-muted" : "text-ink"}`}>{item.title}</p>
              <p className={`mt-0.5 text-xs leading-5 text-pretty ${item.state === "failed" ? "text-short" : "text-muted"}`}>{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
