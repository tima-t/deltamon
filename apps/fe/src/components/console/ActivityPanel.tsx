"use client";

import { useQuery } from "@tanstack/react-query";
import type { Activity } from "@deltamon/shared";
import { AutomationError, fetchActivity } from "@/lib/automation";
import { shortAddr } from "@/lib/vault";
import { Card, Pill } from "./ui";

/**
 * Everything the vault has done, automated or not: pipeline steps, deposits and redemptions, admin
 * swaps and staking, and orders on Perpl. Read only and public, because a vault that shows its
 * work is the point.
 */

const SOURCE_LABEL: Record<Activity["source"], string> = {
  pipeline: "automation",
  onchain: "on chain",
  perp: "perpl",
};

function tone(status: Activity["status"]): "good" | "warn" | "flat" {
  return status === "ok" ? "good" : status === "failed" ? "warn" : "flat";
}

export function ActivityPanel() {
  const { data, error, isPending } = useQuery({
    queryKey: ["activity"],
    queryFn: () => fetchActivity(150),
    retry: false,
    refetchInterval: 10_000,
  });

  if (error) {
    return (
      <Card title="Activity">
        <p className="text-short text-sm">
          {error instanceof AutomationError ? error.message : "The activity log is unavailable."}
        </p>
      </Card>
    );
  }

  const entries = data?.entries ?? [];

  return (
    <Card title="Activity" subtitle="Every pipeline step and every hand-made change, newest first.">
      {isPending ? (
        <p className="text-muted text-sm">Reading the log…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted text-sm">
          Nothing recorded yet. Deposits, admin actions and pipeline steps appear here as they
          happen.
        </p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, i) => (
            <li
              key={`${entry.at}-${i}`}
              className="border-line flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 last:border-0"
            >
              <span className="text-muted w-36 shrink-0 font-mono text-xs">
                {entry.at.slice(0, 19).replace("T", " ")}
              </span>
              <Pill tone={tone(entry.status)}>{SOURCE_LABEL[entry.source]}</Pill>
              <span className="min-w-0 flex-1 text-sm">{entry.summary}</span>
              {entry.actor ? (
                <span className="text-muted font-mono text-xs">{shortAddr(entry.actor)}</span>
              ) : null}
              {entry.txHash ? (
                <a
                  href={`https://monadvision.com/tx/${entry.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-monad text-xs underline underline-offset-2"
                >
                  tx
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
