"use client";

import { erc20Abi, formatUnits, type Abi, type Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { VAULT_ABI, addr, big, bool, fmtShares, fmtUsdc, type VaultState } from "@/lib/vault";
import { ActionForm, Card, Stat } from "./ui";

interface Props {
  vault: Address;
  chainId: number;
  state: VaultState;
  busy: boolean;
  run: (
    fn: string,
    args: readonly unknown[],
    what: string,
    options?: { target?: Address; abi?: Abi },
  ) => void;
}

export function UserPanel({ vault, chainId, state, busy, run }: Props) {
  const { address } = useAccount();
  const usdc = addr(state.asset);
  const oracleLive = bool(state.oracleIsLive);

  const { data } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: vault, abi: VAULT_ABI, functionName: "balanceOf", args: [address], chainId },
      { address: vault, abi: VAULT_ABI, functionName: "costBasis", args: [address], chainId },
      { address: vault, abi: VAULT_ABI, functionName: "maxRedeem", args: [address], chainId },
      {
        address: usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as Address],
        chainId,
      },
      {
        address: usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address as Address, vault],
        chainId,
      },
    ],
    query: { enabled: Boolean(address && usdc), refetchInterval: 12_000 },
  });

  const value = (i: number) => {
    const entry = data?.[i];
    return entry && entry.status === "success" && typeof entry.result === "bigint"
      ? entry.result
      : 0n;
  };
  const shares = value(0);
  const costBasis = value(1);
  const maxRedeem = value(2);
  const walletUsdc = value(3);
  const allowance = value(4);

  const minDeposit = big(state.minDeposit);
  const queuedOnly = shares - maxRedeem;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card
        title="Deposit"
        subtitle={`Wallet holds ${fmtUsdc(walletUsdc)} USDC. Minimum ${fmtUsdc(minDeposit)}.`}
      >
        <ActionForm
          title="Approve USDC"
          note={`The vault may currently pull ${fmtUsdc(allowance)} USDC.`}
          fields={[{ name: "amount", label: "Amount (USDC)", kind: "usdc", placeholder: "1000" }]}
          button="Approve"
          busy={busy}
          disabled={!usdc}
          onRun={(v) =>
            run("approve", [vault, v.amount], "approve USDC", { target: usdc, abi: erc20Abi })
          }
        />
        <ActionForm
          title="Deposit USDC"
          note="You receive sdMON, your share of everything the vault holds."
          fields={[{ name: "amount", label: "Amount (USDC)", kind: "usdc", placeholder: "1000" }]}
          button="Deposit"
          busy={busy}
          onRun={(v) => run("deposit", [v.amount, address], "deposit USDC")}
        />
      </Card>

      <Card title="Your position">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="sdMON" value={fmtShares(shares)} />
          <Stat label="Paid in (cost basis)" value={`${fmtUsdc(costBasis)} USDC`} />
          <Stat
            label="Redeemable now"
            value={`${fmtShares(maxRedeem)} sdMON`}
            hint="Limited by the vault's idle USDC"
          />
          <Stat
            label="Needs the queue"
            value={`${fmtShares(queuedOnly > 0n ? queuedOnly : 0n)} sdMON`}
          />
        </div>

        <ActionForm
          title="Redeem now"
          note="Paid straight out of idle USDC. A performance fee applies to profit only."
          fields={[
            {
              name: "shares",
              label: "sdMON",
              kind: "shares",
              placeholder: formatUnits(maxRedeem, 18),
              defaultValue: maxRedeem > 0n ? formatUnits(maxRedeem, 18) : "",
            },
          ]}
          button="Redeem"
          busy={busy}
          onRun={(v) => run("redeem", [v.shares, address, address], "redeem sdMON")}
        />
        <ActionForm
          title="Queue a redemption"
          note="For anything the idle USDC cannot cover. The admin has 36 hours to fund it, then every allocation function freezes."
          fields={[{ name: "shares", label: "sdMON", kind: "shares", placeholder: "1000" }]}
          button="Request"
          busy={busy}
          onRun={(v) => run("requestRedeem", [v.shares], "queue a redemption")}
        />
        <ActionForm
          title="Exit in kind"
          note={
            oracleLive
              ? "Only open while the oracle cannot price MON. It is live right now."
              : "The oracle is down. Take your pro-rata share of idle USDC, wrapped MON and AUSD, with no fee. Your share of staked MON and the perp book stays behind."
          }
          fields={[{ name: "shares", label: "sdMON", kind: "shares", placeholder: "1000" }]}
          button="Redeem in kind"
          busy={busy}
          disabled={oracleLive}
          onRun={(v) => run("redeemInKind", [v.shares, address], "redeem in kind")}
        />
      </Card>
    </div>
  );
}
