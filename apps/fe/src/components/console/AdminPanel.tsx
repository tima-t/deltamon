"use client";

import { useState } from "react";
import { formatUnits, isAddress, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { VAULT_ABI, addr, big, bool, fmtUsdc, int, untilText, type VaultState } from "@/lib/vault";
import { ActionForm, Card, Pill } from "./ui";

interface Props {
  vault: Address;
  chainId: number;
  state: VaultState;
  busy: boolean;
  run: (fn: string, args: readonly unknown[], what: string) => void;
}

export function AdminPanel({ vault, chainId, state, busy, run }: Props) {
  const [manager, setManager] = useState("");
  const managerIsAddress = isAddress(manager);

  const { data: managerData } = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: vault,
        abi: VAULT_ABI,
        functionName: "isPerpManager",
        args: [manager as Address],
        chainId,
      },
      {
        address: vault,
        abi: VAULT_ABI,
        functionName: "perpManagerEffectiveAt",
        args: [manager as Address],
        chainId,
      },
      {
        address: vault,
        abi: VAULT_ABI,
        functionName: "perpManagerOutstanding",
        args: [manager as Address],
        chainId,
      },
    ],
    query: { enabled: managerIsAddress, refetchInterval: 12_000 },
  });

  const managerActive = managerData?.[0]?.status === "success" && managerData[0].result === true;
  const managerEffectiveAt =
    managerData?.[1]?.status === "success" && typeof managerData[1].result === "bigint"
      ? managerData[1].result
      : 0n;
  const managerOutstanding =
    managerData?.[2]?.status === "success" && typeof managerData[2].result === "bigint"
      ? managerData[2].result
      : 0n;

  const usdc = addr(state.asset);
  const ausd = addr(state.ausd);
  const commission = big(state.maxValidatorCommission);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
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
          title="USDC ↔ AUSD"
          note="AUSD cannot be bought on Kuru today; both routes revert at any size."
          fields={[
            { name: "amount", label: "Amount", kind: "usdc", placeholder: "100" },
            {
              name: "direction",
              label: "1 = USDC→AUSD, 0 = AUSD→USDC",
              kind: "int",
              defaultValue: "1",
            },
          ]}
          button="Swap"
          busy={busy}
          onRun={(v) =>
            run(
              v.direction === 1n ? "swapUsdcForAusd" : "swapAusdForUsdc",
              [v.amount, 0n],
              "swap stablecoins",
            )
          }
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
        subtitle="Custodial: what you send cannot be pulled back. Adding one waits three days."
      >
        <label className="block">
          <span className="text-muted text-xs">Manager address</span>
          <input
            value={manager}
            placeholder="0x…"
            onChange={(e) => setManager(e.target.value.trim())}
            className="border-line focus:border-monad mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
          />
        </label>
        {managerIsAddress ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {managerActive ? (
              <Pill tone="good">active</Pill>
            ) : (
              <Pill tone="flat">not a manager</Pill>
            )}
            <Pill tone="flat">{untilText(managerEffectiveAt)}</Pill>
            <span className="text-muted">holds {fmtUsdc(managerOutstanding)} of vault value</span>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !managerIsAddress}
            onClick={() =>
              run("controlPerpManagers", [manager as Address, true], "propose a perp manager")
            }
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Propose
          </button>
          <button
            type="button"
            disabled={busy || !managerIsAddress}
            onClick={() => run("applyPerpManager", [manager as Address], "activate a perp manager")}
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Activate
          </button>
          <button
            type="button"
            disabled={busy || !managerIsAddress}
            onClick={() =>
              run("controlPerpManagers", [manager as Address, false], "remove a perp manager")
            }
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Remove now
          </button>
        </div>
        <ActionForm
          title="Fund the manager"
          note="Keep the perp book under the ceiling, and make sure their book feed is live first."
          fields={[
            { name: "amount", label: "Amount", kind: "usdc", placeholder: "1000" },
            { name: "token", label: "1 = USDC, 0 = AUSD", kind: "int", defaultValue: "1" },
          ]}
          button="Send"
          busy={busy}
          disabled={!managerIsAddress}
          onRun={(v) =>
            run(
              "sendFundPerpManager",
              [manager as Address, v.token === 1n ? usdc : ausd, v.amount],
              "fund a perp manager",
            )
          }
        />
      </Card>

      <Card title="Limits, fee and risk">
        <ActionForm
          title="Deposit limits"
          note="The 50,000 default is well above what Kuru can unwind inside 36 hours."
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
