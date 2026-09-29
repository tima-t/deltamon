import type { Activity, AutomationConfig } from "@deltamon/shared";
import { currentToken } from "./perpSession";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * The console's client for the automation. Reading the config and the activity log needs nothing;
 * writing the config needs the same signed session the perp tab mints, and the backend checks that
 * it belongs to the vault's owner.
 */

export class AutomationError extends Error {}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const token = currentToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: {
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AutomationError(`The backend is not answering at ${API_URL}.`);
  }
  const text = await res.text();
  const body: unknown = text === "" ? null : JSON.parse(text);
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `request failed (${res.status})`;
    throw new AutomationError(message);
  }
  return body;
}

export interface ConfigResponse {
  config: AutomationConfig;
  /** The vault owner, the only address allowed to change any of this. */
  admin: string | null;
  /** Whether the backend holds a key to sign with. */
  ready: boolean;
}

export const fetchAutomationConfig = () =>
  call("/automation/config") as Promise<ConfigResponse>;

export const saveAutomationConfig = (config: Omit<AutomationConfig, "updatedAt" | "updatedBy">) =>
  call("/automation/config", { method: "PUT", body: JSON.stringify(config) }) as Promise<{
    config: AutomationConfig;
  }>;

export const fetchActivity = (limit = 100) =>
  call(`/automation/activity?limit=${limit}`) as Promise<{ entries: Activity[] }>;

export interface FlowStepView {
  name: string;
  status: string;
  attempts: number;
  txHash?: string;
  error?: string;
  result?: Record<string, string>;
}

export interface FlowView {
  triggerKey: string;
  trigger: string;
  usdcIn: string;
  status: string;
  steps: FlowStepView[];
  createdAt: string;
}

export const fetchFlows = () => call("/automation/flows") as Promise<{ flows: FlowView[] }>;
