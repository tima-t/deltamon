"use client";

import { erc20Abi, formatUnits, type Abi, type Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { VAULT_ABI, addr, fmtUsdc, shortAddr, type VaultState } from "@/lib/vault";
import { ActionForm, Card, Pill, Stat } from "./ui";

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

/**
 * The counterpart to the admin's "fund a manager": a manager returning capital. It calls
 * perpManagerDeposit, which mints nothing, so returned value simply lands back in the book and
 * lifts the price per share. A removed manager still sees this panel while they owe something.
 */
export function ManagerPanel({ vault, chainId, state, busy, run }: Props) {
  const { address } = useAccount();
  const usdc = addr(state.asset);
  const ausd = addr(state.ausd);

  const { data } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: vault, abi: VAULT_ABI, functionName: "isPerpManager", args: [address], chainId },
      {
        address: vault,
        abi: VAULT_ABI,
        functionName: "perpManagerOutstanding",
        args: [address],
        chainId,
      },
      { address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId },
      { address: usdc, abi: erc20Abi, functionName: "allowance", args: [address!, vault], chainId },
      { address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId },
      { address: ausd, abi: erc20Abi, functionName: "allowance", args: [address!, vault], chainId },
    ],
    query: { enabled: Boolean(address && usdc && ausd), refetchInterval: 12_000 },
  });

  const amountAt = (i: number): bigint => {
    const entry = data?.[i];
    return entry?.status === "success" && typeof entry.result === "bigint" ? entry.result : 0n;
  };
  const listed = data?.[0]?.status === "success" && data[0].result === true;
  const outstanding = amountAt(1);

  const tokens = [
    { name: "USDC", address: usdc, held: amountAt(2), allowance: amountAt(3) },
    { name: "AUSD", address: ausd, held: amountAt(4), allowance: amountAt(5) },
  ];

  if (!listed && outstanding === 0n) {
    return (
      <Card title="Return capital">
        <p className="text-muted text-sm">
          {shortAddr(address)} is not a perp manager on this vault and owes it nothing, so there is
          nothing to return. The admin lists managers from the Admin tab.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <Card title="Your standing" subtitle={shortAddr(address)}>
        <div className="grid grid-cols-2 gap-4">
          <Stat
            label="Listed"
            value={
              listed ? <Pill tone="good">active manager</Pill> : <Pill tone="warn">removed</Pill>
            }
            hint={listed ? "the admin can fund you" : "you can still return what you hold"}
          />
          <Stat
            label="Outstanding"
            value={`${fmtUsdc(outstanding)}`}
            hint="what the vault still counts as yours"
          />
          <Stat label="Your USDC" value={fmtUsdc(tokens[0]!.held)} />
          <Stat label="Your AUSD" value={fmtUsdc(tokens[1]!.held)} />
        </div>
        <p className="text-muted text-sm">
          Returning is not a deposit: no sdMON is minted and you get nothing back for it. The value
          lands in the book and lifts the price per share for holders. Anything above your
          outstanding balance counts as realised profit and marks the perp book stale until it is
          reported again.
        </p>
      </Card>

      {tokens.map((token) => (
        <Card
          key={token.name}
          title={`Return ${token.name}`}
          subtitle={`You hold ${fmtUsdc(token.held)}. The vault may currently pull ${fmtUsdc(token.allowance)}.`}
        >
          <ActionForm
            title={`Approve ${token.name}`}
            note="The vault pulls the tokens, so it needs an allowance first."
            fields={[
              {
                name: "amount",
                label: `Amount (${token.name})`,
                kind: "usdc",
                placeholder: formatUnits(outstanding, 6),
              },
            ]}
            button="Approve"
            busy={busy}
            disabled={!token.address}
            onRun={(v) =>
              run("approve", [vault, v.amount], `approve ${token.name}`, {
                target: token.address,
                abi: erc20Abi,
              })
            }
          />
          <ActionForm
            title={`Return ${token.name}`}
            note={
              outstanding > 0n
                ? `Repays your outstanding balance first, up to ${fmtUsdc(outstanding)}.`
                : "You owe nothing, so all of this counts as profit for holders."
            }
            fields={[
              {
                name: "amount",
                label: `Amount (${token.name})`,
                kind: "usdc",
                placeholder: formatUnits(outstanding, 6),
              },
            ]}
            button="Return"
            busy={busy}
            disabled={!token.address}
            onRun={(v) =>
              run(
                "perpManagerDeposit",
                [token.address, v.amount],
                `return ${token.name} to the vault`,
              )
            }
          />
        </Card>
      ))}
    </div>
  );
}
