"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { useBalance } from "wagmi";
import { formatUnits, type Address } from "viem";
import { ADDRESSES } from "@deltamon/shared";
import type { FundedAsset } from "@/lib/crosschain/catalog";
import { sourceChainById } from "@/lib/crosschain/chains";

export function ReceiveFunds({
  address,
  sources = [],
  selectedChainId = 143,
  onRefresh,
}: {
  address: Address;
  sources?: FundedAsset[];
  selectedChainId?: number;
  onRefresh?: () => void;
}) {
  const [selected, setSelected] = useState(selectedChainId);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState<"address" | "token" | null>(null);
  const [copyError, setCopyError] = useState("");
  const asset = sources.find((item) => item.chainId === selected);
  const chain = sourceChainById(selected);
  const token = selected === 143 ? ADDRESSES[143].tokens.USDC : asset?.contractAddress;
  const { data: native, refetch: refetchNative } = useBalance({
    address,
    chainId: selected,
    query: { refetchInterval: 12_000 },
  });

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(address, {
      margin: 1,
      width: 196,
      color: { dark: "#182128", light: "#fffefa" },
    }).then((value) => {
      if (active) setQr(value);
    });
    return () => {
      active = false;
    };
  }, [address]);

  async function copy(value: string, kind: "address" | "token") {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopyError("Could not copy. Select and copy the text instead.");
    }
  }

  return (
    <div className="border-monad/40 bg-monad/5 rounded-xl border p-4 sm:p-5">
      <p className="eyebrow">Fund your passkey wallet</p>
      <h3 className="mt-1 text-lg font-semibold">Receive USDC and network gas</h3>
      <p className="text-muted mt-1 text-sm">
        Send funds to this new address from another wallet or exchange. Your existing wallet and
        vault position stay at their original address.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Funding network">
        {[143, ...new Set(sources.map((item) => item.chainId).filter((id) => id !== 143))].map(
          (id) => {
            const name = sourceChainById(id)?.name ?? `Chain ${id}`;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected === id}
                onClick={() => {
                  setSelected(id);
                  setCopied(null);
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${selected === id ? "border-monad bg-monad/15 text-ink" : "border-line text-muted hover:border-monad/50"}`}
              >
                {name}
              </button>
            );
          },
        )}
      </div>
      <div className="border-line bg-paper/50 mt-4 grid gap-4 rounded-xl border p-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="text-muted text-xs uppercase tracking-widest">
            Your address on {chain?.name ?? "this network"}
          </p>
          <p className="font-data mt-2 break-all text-sm">{address}</p>
          <button
            type="button"
            onClick={() => void copy(address, "address")}
            className="text-monad mt-2 text-sm font-semibold underline underline-offset-4"
          >
            {copied === "address" ? "Address copied" : "Copy address"}
          </button>
          <p className="text-muted mt-4 text-xs">
            Send USDC on {chain?.name ?? "this network"} using the contract below. Send{" "}
            {chain?.nativeCurrency.symbol ?? "native currency"} on the same network for transaction
            gas. Other tokens will not fund a deposit.
          </p>
          {token ? (
            <>
              <p className="text-muted mt-3 text-xs">USDC contract</p>
              <p className="font-data mt-1 break-all text-xs">{token}</p>
              <button
                type="button"
                onClick={() => void copy(token, "token")}
                className="text-monad mt-1 text-xs underline"
              >
                {copied === "token" ? "Contract copied" : "Copy contract"}
              </button>
            </>
          ) : null}
          <p className="text-muted mt-3 text-xs tabular-nums">
            Gas balance:{" "}
            {native
              ? `${Number(formatUnits(native.value, native.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${native.symbol}`
              : "Checking…"}
          </p>
        </div>
        {qr ? (
          <Image
            src={qr}
            alt={`QR code for ${address}`}
            width={150}
            height={150}
            unoptimized
            className="border-line rounded-lg border bg-white p-1"
          />
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          void refetchNative();
          onRefresh?.();
        }}
        className="border-line mt-3 rounded-lg border px-3 py-2 text-sm font-medium"
      >
        Refresh balances
      </button>
      {copyError ? (
        <p role="alert" className="text-short mt-2 text-xs">
          {copyError}
        </p>
      ) : null}
    </div>
  );
}
