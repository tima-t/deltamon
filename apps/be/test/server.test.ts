import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

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

  it("serves demo vault stats when no vault is deployed", async () => {
    const res = await app.inject({ method: "GET", url: "/api/vault" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("demo");
    expect(body.apy.net).toBeCloseTo(15.2, 1);
    expect(Math.abs(body.netDeltaBps)).toBeLessThan(200);
  });

  it("rejects unknown price symbols", async () => {
    const res = await app.inject({ method: "GET", url: "/api/prices/DOGE-USD" });
    expect(res.statusCode).toBe(404);
  });
});
