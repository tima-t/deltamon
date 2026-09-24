"use client";

import { useState } from "react";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import {
  VAULT_ABI,
  addr,
  big,
  bool,
  fmtUsdc,
  int,
  shortAddr,
  untilText,
  type VaultState,
} from "@/lib/vault";
// Five sections here, so each one folds and you open the one you need.
import { ActionForm, CollapsibleCard as Card, Pill } from "./ui";

interface Props {
  vault: Address;
  chainId: number;
  state: VaultState;
  busy: boolean;
  run: (fn: string, args: readonly unknown[], what: string) => void;
}

export function AdminPanel({ vault, chainId, state, busy, run }: Props) {
  const [manager, setManager] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const managerIsAddress = isAddress(manager);

  // Everyone the vault has ever cleared, in one read, then their state one row at a time.
  const { data: listed } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "perpManagers",
    chainId,
    query: { refetchInterval: 12_000 },
  });
  const known: Address[] = Array.isArray(listed) ? (listed as Address[]) : [];

  const { data: rows } = useReadContracts({
    allowFailure: true,
    contracts: known.flatMap((m) => [
      { address: vault, abi: VAULT_ABI, functionName: "isPerpManager", args: [m], chainId },
      {
        address: vault,
        abi: VAULT_ABI,
        functionName: "perpManagerOutstanding",
        args: [m],
        chainId,
      },
    ]),
    query: { enabled: known.length > 0, refetchInterval: 12_000 },
  });

  const resultAt = (k: number): unknown => {
    const entry = rows?.[k];
    return entry && entry.status === "success" ? entry.result : undefined;
  };
  const managers = known.map((address, i) => {
    const outstanding = resultAt(i * 2 + 1);
    return {
      address,
      active: resultAt(i * 2) === true,
      outstanding: typeof outstanding === "bigint" ? outstanding : 0n,
    };
  });
  const selected = managers.find((m) => m.address.toLowerCase() === manager.toLowerCase());

  const usdc = addr(state.asset);
  const ausd = addr(state.ausd);
  const commission = big(state.maxValidatorCommission);

  const amountLooksNumeric = /^\d+(\.\d+)?$/.test(fundAmount.trim());
  function fund(token: Address | undefined) {
    if (!token || !managerIsAddress || !amountLooksNumeric) return;
    run(
      "sendFundPerpManager",
      [manager as Address, token, parseUnits(fundAmount.trim(), 6)],
      `fund ${shortAddr(manager)}`,
    );
  }

  return (
    // items-start: without it a grid row stretches both cards to match the taller one, so opening
    // one leaves a tall empty box beside it.
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <Card title="Allocate" subtitle="Kuru's MON book is thin: swap a few hundred USDC at a time.">
        <ActionForm
          title="USDC → MON"
          note="The vault floors the price against Chainlink itself, so a bad fill reverts."
          fields={[{ name: "amount", label: "USDC in", kind: "usdc", placeholder: "250" }]}
          button="Swap"
          busy={busy}
          onRun={(v) => run("swapUsdcForMon", [v.amount, 0n], "swap USDC for MON")}
        />
        <ActionForm
          title="MON → USDC"
          fields={[{ name: "amount", label: "MON in", kind: "mon", placeholder: "10000" }]}
          button="Swap"
          busy={busy}
          onRun={(v) => run("swapMonForUsdc", [v.amount, 0n], "swap MON for USDC")}
        />
        <ActionForm
          title="USDC → AUSD"
          note="Kuru's AUSD books are empty, so this goes through the stable pool its own front end uses. The vault floors it against parity."
          fields={[{ name: "amount", label: "USDC in", kind: "usdc", placeholder: "100" }]}
          button="Swap"
          busy={busy}
          onRun={(v) => run("swapUsdcForAusd", [v.amount, 0n], "swap USDC for AUSD")}
        />
        <ActionForm
          title="AUSD → USDC"
          fields={[{ name: "amount", label: "AUSD in", kind: "usdc", placeholder: "100" }]}
          button="Swap"
          busy={busy}
          onRun={(v) => run("swapAusdForUsdc", [v.amount, 0n], "swap AUSD for USDC")}
        />
      </Card>

      <Card
        title="Stake"
        subtitle="Native MON staking. Validator commission must be under the cap."
      >
        <ActionForm
          title="Stake MON"
          note={`Commission cap is ${formatUnits(commission, 18)} (1 = 100%). Validator 5 charges 10%.`}
          fields={[
            { name: "validator", label: "Validator id", kind: "int", placeholder: "5" },
            { name: "amount", label: "MON", kind: "mon", placeholder: "10000" },
          ]}
          button="Stake"
          busy={busy}
          onRun={(v) => run("stake", [v.validator, v.amount], "stake MON")}
        />
        <ActionForm
          title="Unstake MON"
          note="Unbonding takes an epoch. A fresh delegation cannot be unstaked in the same epoch."
          fields={[
            { name: "validator", label: "Validator id", kind: "int", placeholder: "5" },
            { name: "amount", label: "MON", kind: "mon", placeholder: "10000" },
          ]}
          button="Unstake"
          busy={busy}
          onRun={(v) => run("unstake", [v.validator, v.amount], "unstake MON")}
        />
        <ActionForm
          title="Claim unbonded MON"
          note="Permissionless once matured. The keeper does this automatically."
          fields={[
            { name: "validator", label: "Validator id", kind: "int", placeholder: "5" },
            { name: "withdrawId", label: "Withdraw id", kind: "int", placeholder: "0" },
          ]}
          button="Claim"
          busy={busy}
          onRun={(v) => run("claimUnstaked", [v.validator, v.withdrawId], "claim unbonded MON")}
        />
      </Card>

      <Card
        title="Perp managers"
        subtitle="Custodial: what you send cannot be pulled back. Adding and removing take effect immediately."
      >
        {managers.length === 0 ? (
          <p className="text-muted text-sm">No managers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted text-left">
                <tr>
                  <th className="py-2 pr-3 font-normal">Manager</th>
                  <th className="py-2 pr-3 font-normal">State</th>
                  <th className="py-2 pr-3 font-normal">Holds</th>
                  <th className="py-2 pr-3 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => (
                  <tr key={m.address} className="border-line border-t">
                    <td className="py-2 pr-3 font-mono">
                      <button
                        type="button"
                        onClick={() => setManager(m.address)}
                        className="underline-offset-2 hover:underline"
                        title="Use this address below"
                      >
                        {shortAddr(m.address)}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      {m.active ? (
                        <Pill tone="good">active</Pill>
                      ) : (
                        <Pill tone="flat">removed</Pill>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{fmtUsdc(m.outstanding)}</td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            "controlPerpManagers",
                            [m.address, !m.active],
                            `${m.active ? "remove" : "restore"} ${shortAddr(m.address)}`,
                          )
                        }
                        className="border-line hover:border-ink rounded-md border px-2 py-1 disabled:opacity-50"
                      >
                        {m.active ? "Remove" : "Add back"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-line rounded-lg border p-4">
          <div className="font-medium">Add or fund a manager</div>
          <p className="text-muted mt-1 text-sm">
            {selected
              ? selected.active
                ? "This address is a manager and can be funded now."
                : "This address is listed but not active. Add it back before funding."
              : "Paste an address to clear it, or pick one from the table above."}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-muted text-xs">Manager address</span>
              <input
                value={manager}
                placeholder="0x…"
                onChange={(e) => setManager(e.target.value.trim())}
                className="border-line focus:border-monad mt-1 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm outline-none"
              />
            </label>
            <label className="block">
              <span className="text-muted text-xs">Amount to send</span>
              <input
                value={fundAmount}
                placeholder="1000"
                onChange={(e) => setFundAmount(e.target.value.trim())}
                className="border-line focus:border-monad mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !managerIsAddress || selected?.active === true}
              onClick={() =>
                run("controlPerpManagers", [manager as Address, true], "add a perp manager")
              }
              className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Add manager
            </button>
            <button
              type="button"
              disabled={busy || !selected?.active || !amountLooksNumeric || !usdc}
              onClick={() => fund(usdc)}
              className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Send USDC
            </button>
            <button
              type="button"
              disabled={busy || !selected?.active || !amountLooksNumeric || !ausd}
              onClick={() => fund(ausd)}
              className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Send AUSD
            </button>
          </div>
          <p className="text-muted mt-2 text-xs">
            Both tokens are accepted. Keep the book under the ceiling
            {` (${int(state.maxPerpAllocationBps) / 100}% of the vault)`}, and make sure their book
            feed is live first, or deposits pause six hours later.
          </p>
        </div>
      </Card>

      <Card title="Limits, fee and risk">
        <ActionForm
          title="Deposit limits"
          note="The 50,000 default is well above what Kuru can unwind in a sitting, so keep the cap in proportion to how fast you can bring USDC back."
          key={`limits-${String(state.depositCap)}-${String(state.minDeposit)}`}
          fields={[
            {
              name: "cap",
              label: "Deposit cap (USDC)",
              kind: "usdc",
              defaultValue: formatUnits(big(state.depositCap), 6),
            },
            {
              name: "min",
              label: "Minimum deposit (USDC)",
              kind: "usdc",
              defaultValue: formatUnits(big(state.minDeposit), 6),
            },
          ]}
          button="Set limits"
          busy={busy}
          onRun={(v) => run("setLimits", [v.cap, v.min], "set deposit limits")}
        />
        <ActionForm
          title="Performance fee"
          note={`Now ${int(state.performanceFeeBps) / 100}%. A rise waits three days; a cut applies at once. ${untilText(big(state.pendingFeeEffectiveAt))}.`}
          fields={[{ name: "bps", label: "Fee (bps, max 1000)", kind: "int", placeholder: "1000" }]}
          button="Propose"
          busy={busy}
          onRun={(v) => run("proposePerformanceFee", [v.bps], "propose a performance fee")}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run("applyPerformanceFee", [], "apply the fee change")}
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Apply fee
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run("applyMaxPerpAllocation", [], "apply the perp ceiling")}
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Apply perp ceiling
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run("applyRiskParams", [], "apply the risk limits")}
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Apply risk limits
          </button>
        </div>
        <ActionForm
          title="Perp ceiling"
          note={`Now ${int(state.maxPerpAllocationBps) / 100}% of the vault. Raising it waits three days; lowering applies at once. ${untilText(big(state.pendingMaxPerpAllocationAt))}.`}
          fields={[{ name: "bps", label: "Ceiling (bps)", kind: "int", placeholder: "5000" }]}
          button="Set ceiling"
          busy={busy}
          onRun={(v) => run("setMaxPerpAllocation", [v.bps], "set the perp ceiling")}
        />
        <ActionForm
          title="Risk limits"
          note={`Loosening any one of these waits three days; tightening applies at once. ${untilText(big(state.pendingRiskParamsAt))}.`}
          key={`risk-${String(state.maxSwapSlippageBps)}-${String(state.perpReportMaxAge)}`}
          fields={[
            {
              name: "slippage",
              label: "Swap slippage (bps)",
              kind: "int",
              defaultValue: String(int(state.maxSwapSlippageBps)),
            },
            {
              name: "parity",
              label: "Stable parity band (bps)",
              kind: "int",
              defaultValue: String(int(state.stableParityBandBps)),
            },
            {
              name: "commission",
              label: "Validator commission cap (1 = 100%)",
              kind: "wad",
              defaultValue: formatUnits(commission, 18),
            },
            {
              name: "band",
              label: "Perp mark band (bps)",
              kind: "int",
              defaultValue: String(int(state.perpPnlBandBps)),
            },
            {
              name: "maxAge",
              label: "Perp mark max age (seconds)",
              kind: "int",
              defaultValue: String(int(state.perpReportMaxAge)),
            },
          ]}
          button="Set risk limits"
          busy={busy}
          onRun={(v) =>
            run(
              "setRiskParams",
              [v.slippage, v.parity, v.commission, v.band, v.maxAge],
              "set risk limits",
            )
          }
        />
      </Card>

      <Card title="Access and fees">
        <ActionForm
          title="Withdraw accrued fees"
          note={`${fmtUsdc(big(state.accruedFees))} USDC accrued. This is the only value the admin can move out.`}
          fields={[
            { name: "to", label: "To", kind: "address", placeholder: "0x…" },
            { name: "amount", label: "USDC", kind: "usdc", placeholder: "0" },
          ]}
          button="Withdraw"
          busy={busy}
          onRun={(v) => run("withdrawFees", [v.to, v.amount], "withdraw fees")}
        />
        <ActionForm
          title="Set the keeper"
          note="It can mark the perp book inside the band and claim staking rewards, nothing else."
          fields={[
            { name: "keeper", label: "Keeper address", kind: "address", placeholder: "0x…" },
          ]}
          button="Set keeper"
          busy={busy}
          onRun={(v) => run("setKeeper", [v.keeper], "set the keeper")}
        />
        <ActionForm
          title="Whitelist depositors"
          note={`Whitelist mode is ${bool(state.whitelistEnabled) ? "on" : "off"}. Addresses comma separated.`}
          fields={[
            { name: "accounts", label: "Addresses", kind: "addressList", placeholder: "0x…,0x…" },
            { name: "allowed", label: "1 = allow, 0 = block", kind: "int", defaultValue: "1" },
          ]}
          button="Update list"
          busy={busy}
          onRun={(v) =>
            run("setDepositors", [v.accounts, v.allowed === 1n], "update the depositor list")
          }
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run("setWhitelistEnabled", [!bool(state.whitelistEnabled)], "toggle whitelist mode")
            }
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {bool(state.whitelistEnabled) ? "Turn whitelist off" : "Turn whitelist on"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(bool(state.paused) ? "unpause" : "pause", [], "change pause state")}
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {bool(state.paused) ? "Unpause" : "Pause new risk"}
          </button>
        </div>
        <ActionForm
          title="Hand the vault to a multisig"
          note="Two steps: the new owner must call acceptOwnership afterwards. Ownership cannot be renounced."
          fields={[
            { name: "owner", label: "New owner", kind: "address", placeholder: "0x… (Safe)" },
          ]}
          button="Transfer ownership"
          busy={busy}
          onRun={(v) => run("transferOwnership", [v.owner], "transfer ownership")}
        />
      </Card>
    </div>
  );
}
