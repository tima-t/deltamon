import { DepositError } from "./server";

export function errorResponse(error: unknown): Response {
  const status = error instanceof DepositError ? error.status : 502;
  const message = error instanceof Error ? error.message : "Cross-chain service unavailable";
  return Response.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 });
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DepositError("Invalid request body");
  }
  return body as Record<string, unknown>;
}
