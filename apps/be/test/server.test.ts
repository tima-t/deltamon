import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { VaultStatsSchema } from "@deltamon/shared";

process.env.NODE_ENV = "test";
process.env.VAULT_ADDRESS = "";

const { buildServer } = await import("../src/server.js");

describe("api", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.keeper.enabled).toBe(false);
  });

  it("serves demo vault stats that match the shared schema", async () => {
    const res = await app.inject({ method: "GET", url: "/api/vault" });
    expect(res.statusCode).toBe(200);
    const body = VaultStatsSchema.parse(res.json());
    expect(body.source).toBe("demo");
    expect(body.shareToken.symbol).toBe("sdMON");
    expect(body.allocation.targetMonBps).toBe(6000);
    expect(Math.abs(body.allocation.driftBps)).toBeLessThanOrEqual(
      body.allocation.rebalanceThresholdBps,
    );
  });

  it("rejects unknown price symbols", async () => {
    const res = await app.inject({ method: "GET", url: "/api/prices/DOGE-USD" });
    expect(res.statusCode).toBe(404);
  });
});
