"use client";

import { type Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { VAULT_ABI, big, bool, fmtShares, shortAddr, type VaultState } from "@/lib/vault";
import { ActionForm, Card, Pill, Stat } from "./ui";

interface Props {
  vault: Address;
  chainId: number;
  state: VaultState;
  busy: boolean;
  run: (fn: string, args: readonly unknown[], what: string) => void;
}

/** One page of the queue, starting at the head. Matches the vault's own 64-entry scan. */
const WINDOW = 64n;

export function QueuePanel({ vault, chainId, state, busy, run }: Props) {
  const { address } = useAccount();
  const head = big(state.queueHead);
  const count = big(state.redemptionCount);
  const end = head + WINDOW < count ? head + WINDOW : count;
  const ids: bigint[] = [];
  for (let id = head; id < end; id++) ids.push(id);

  const { data } = useReadContracts({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: vault,
      abi: VAULT_ABI,
      functionName: "redemptions",
      args: [id],
      chainId,
    })),
    query: { enabled: ids.length > 0, refetchInterval: 12_000 },
  });

  const rows = ids.map((id, i) => {
    const entry = data?.[i];
    const raw =
      entry && entry.status === "success" && Array.isArray(entry.result)
        ? (entry.result as unknown[])
        : undefined;
    return {
      id,
      owner: typeof raw?.[0] === "string" ? (raw[0] as Address) : undefined,
      shares: typeof raw?.[1] === "bigint" ? raw[1] : 0n,
      requestedAt: typeof raw?.[3] === "bigint" ? raw[3] : 0n,
      settled: raw?.[4] === true,
    };
  });

  const deadline = big(state.REDEMPTION_DEADLINE);

  return (
    <div className="grid gap-5">
      <Card title="Redemption queue">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Head" value={head.toString()} />
          <Stat label="Requests" value={count.toString()} />
          <Stat label="Shares queued" value={fmtShares(big(state.queuedShares))} />
          <Stat
            label="Status"
            value={
              bool(state.hasOverdueRedemptions) ? (
                <Pill tone="warn">overdue or head behind</Pill>
              ) : (
                <Pill tone="good">healthy</Pill>
              )
            }
          />
        </div>

        {rows.length === 0 ? (
          <p className="text-muted text-sm">Nothing queued.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted text-left">
                <tr>
                  <th className="py-2 pr-3 font-normal">#</th>
                  <th className="py-2 pr-3 font-normal">Owner</th>
                  <th className="py-2 pr-3 font-normal">sdMON</th>
                  <th className="py-2 pr-3 font-normal">Due</th>
                  <th className="py-2 pr-3 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const due = row.requestedAt + deadline;
                  const mine = Boolean(
                    address && row.owner && address.toLowerCase() === row.owner.toLowerCase(),
                  );
                  return (
                    <tr key={row.id.toString()} className="border-line border-t">
                      <td className="py-2 pr-3 tabular-nums">{row.id.toString()}</td>
                      <td className="py-2 pr-3">
                        {shortAddr(row.owner)}{" "}
                        {mine ? <span className="text-muted">(you)</span> : null}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{fmtShares(row.shares)}</td>
                      <td className="py-2 pr-3">
                        {row.settled
                          ? "settled"
                          : new Date(Number(due) * 1000).toLocaleString(undefined, {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                      </td>
                      <td className="py-2 pr-3">
                        {row.settled ? null : (
                          <span className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                run("claimRedemption", [row.id], `settle redemption ${row.id}`)
                              }
                              className="border-line hover:border-ink rounded-md border px-2 py-1 disabled:opacity-50"
                            >
                              Settle
                            </button>
                            {mine ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  run("cancelRedemption", [row.id], `cancel redemption ${row.id}`)
                                }
                                className="border-line hover:border-ink rounded-md border px-2 py-1 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            ) : null}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <ActionForm
          title="Advance the queue head"
          note="Anyone may do this. It steps the head past settled requests, which the vault caps at 64 per call."
          fields={[
            {
              name: "steps",
              label: "Steps",
              kind: "int",
              placeholder: "2000",
              defaultValue: "2000",
            },
          ]}
          button="Advance"
          busy={busy}
          onRun={(v) => run("advanceQueue", [v.steps], "advance the queue head")}
        />
      </Card>
    </div>
  );
}
