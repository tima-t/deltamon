"use client";

import {
  agoText,
  big,
  bool,
  fmtSignedUsdc,
  fmtUsdc,
  int,
  maybeBig,
  type VaultState,
} from "@/lib/vault";
import { ActionForm, Card, Pill, Stat } from "./ui";

interface Props {
  state: VaultState;
  busy: boolean;
  isOwner: boolean;
  run: (fn: string, args: readonly unknown[], what: string) => void;
}

export function KeeperPanel({ state, busy, isOwner, run }: Props) {
  const deployed = big(state.perpDeployed);
  const band = (deployed * BigInt(int(state.perpPnlBandBps))) / 10_000n;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card
        title="Perp book mark"
        subtitle="What the managers hold, minus what they were sent. Deposits need this to be fresh."
      >
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Sent to managers" value={`${fmtUsdc(deployed)} USDC`} />
          <Stat label="Counted value" value={`${fmtUsdc(big(state.perpEquity))} USDC`} />
          <Stat
            label="Current mark"
            value={fmtSignedUsdc(maybeBig(state.perpReportedPnl))}
            hint={`marked ${agoText(big(state.perpReportedAt))}`}
          />
          <Stat
            label="Freshness"
            value={
              bool(state.perpReportIsStale) ? (
                <Pill tone="warn">stale, deposits paused</Pill>
              ) : (
                <Pill tone="good">fresh</Pill>
              )
            }
          />
        </div>
        <ActionForm
          title="Report the mark"
          note={`Inside ±${fmtUsdc(band)} USDC for the keeper.${isOwner ? " As owner you may also mark a loss down to the whole book." : ""} Use a minus sign for a loss.`}
          fields={[
            { name: "pnl", label: "Result (USDC)", kind: "signedUsdc", placeholder: "-25.5" },
          ]}
          button="Report"
          busy={busy}
          disabled={deployed === 0n}
          onRun={(v) => run("reportPerpPnl", [v.pnl], "report the perp mark")}
        />
      </Card>

      <Card
        title="Staking rewards"
        subtitle="Only the keeper or the owner may claim, so no one can sandwich it."
      >
        <ActionForm
          title="Claim rewards"
          note="Claim often: every claim steps the share price up, and small steps are not worth front-running."
          fields={[{ name: "validator", label: "Validator id", kind: "int", placeholder: "5" }]}
          button="Claim"
          busy={busy}
          onRun={(v) => run("claimStakingRewards", [v.validator], "claim staking rewards")}
        />
      </Card>
    </div>
  );
}
