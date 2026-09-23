"use client";

import { useState, type ReactNode } from "react";
import { parseField, parseSignedUsdc, type FieldKind } from "@/lib/vault";

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-line bg-surface rounded-xl border p-5">
      <h3 className="text-lg font-semibold">{title}</h3>
      {subtitle ? <p className="text-muted mt-1 text-sm">{subtitle}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-muted text-sm">{label}</div>
      <div className="mt-0.5 text-lg tabular-nums">{value}</div>
      {hint ? <div className="text-muted text-xs">{hint}</div> : null}
    </div>
  );
}

export function Pill({ tone, children }: { tone: "good" | "warn" | "flat"; children: ReactNode }) {
  const colour =
    tone === "good"
      ? "text-long border-long/40"
      : tone === "warn"
        ? "text-short border-short/40"
        : "text-muted border-line";
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${colour}`}>{children}</span>;
}

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind | "signedUsdc";
  placeholder?: string;
  defaultValue?: string;
}

export type FieldValues = Record<string, bigint | string | string[]>;

/**
 * One vault call: a few inputs and a button. Values are parsed by kind, so a bad amount is caught
 * before the wallet ever opens.
 */
export function ActionForm({
  title,
  note,
  fields = [],
  button,
  disabled,
  busy,
  onRun,
}: {
  title: string;
  note?: string;
  fields?: FieldSpec[];
  button: string;
  disabled?: boolean;
  busy?: boolean;
  onRun: (values: FieldValues) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ""])),
  );
  const [error, setError] = useState<string | null>(null);

  function submit() {
    try {
      const parsed: FieldValues = {};
      for (const field of fields) {
        parsed[field.name] =
          field.kind === "signedUsdc"
            ? parseSignedUsdc(values[field.name] ?? "")
            : parseField(field.kind, values[field.name] ?? "");
      }
      setError(null);
      onRun(parsed);
    } catch {
      setError("Check the values above.");
    }
  }

  return (
    <div className="border-line rounded-lg border p-4">
      <div className="font-medium">{title}</div>
      {note ? <p className="text-muted mt-1 text-sm">{note}</p> : null}
      {fields.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.name} className="block">
              <span className="text-muted text-xs">{field.label}</span>
              <input
                value={values[field.name] ?? ""}
                placeholder={field.placeholder}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                className="border-line focus:border-monad mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-short mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={disabled || busy}
        onClick={submit}
        className="border-line hover:border-ink mt-3 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Working…" : button}
      </button>
    </div>
  );
}

export function TxBanner({
  label,
  hash,
  error,
  confirmed,
  explorer,
}: {
  label?: string;
  hash?: string;
  error?: string;
  confirmed?: boolean;
  explorer?: string;
}) {
  if (!label && !error) return null;
  return (
    <div className="border-line bg-surface sticky bottom-4 z-10 mt-6 rounded-lg border p-3 text-sm">
      {error ? (
        <span className="text-short">{error}</span>
      ) : (
        <span>
          {confirmed ? "Done: " : hash ? "Sent: " : "Preparing: "}
          {label}
          {hash && explorer ? (
            <>
              {" · "}
              <a
                href={`${explorer}/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                view transaction
              </a>
            </>
          ) : null}
        </span>
      )}
    </div>
  );
}
