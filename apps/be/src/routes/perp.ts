import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  credentialsConfigured,
  findMarket,
  listMarkets,
  sharedSession,
} from "../services/perplAccounts.js";
import { describePosition } from "../services/perpPositionView.js";
import { recordActivity } from "../services/automationStore.js";
import { closeShortFrame, openShortFrames } from "../services/perplOrders.js";
import {
  TOKEN_TTL_MS,
  allowedManagers,
  bearerFrom,
  createChallenge,
  isAllowed,
  revoke,
  sessionFor as authSessionFor,
  verifyChallenge,
} from "../services/perpAuth.js";

/**
 * The console's view of the Perpl account, and the two orders it can send.
 *
 * One account, shared by everyone in PERPL_MANAGERS. Each signs in as themselves so orders can be
 * attributed in the log, but they all trade the same book, and the Ed25519 key behind it never
 * leaves the backend.
 */

const DEFAULT_MARKET = "MON";

const decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "expected a positive decimal")
  .refine((v) => Number(v) > 0, "must be above zero");

const ChallengeSchema = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });
const VerifySchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nonce: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

const OpenShortSchema = z.object({
  size: decimal,
  market: z.string().min(1).default(DEFAULT_MARKET),
  /** Hundredths, so 10x is 1000. Perpl requires it; the service defaults to 1x. */
  leverage: z.number().int().positive().max(100_000).optional(),
  stopLoss: decimal.optional(),
  takeProfit: decimal.optional(),
  positionId: z.number().int().nonnegative().optional(),
});

const CloseShortSchema = z.object({
  size: decimal,
  market: z.string().min(1).default(DEFAULT_MARKET),
});

export const perpRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Everything under /perp needs a bearer token, except the challenge pair that mints one and the
   * public market list. A token is only issued to an address in PERPL_MANAGERS.
   */
  const open = new Set([
    "/api/perp/auth/allowed", // the sign-in card needs this before any token exists
    "/api/perp/auth/challenge",
    "/api/perp/auth/verify",
    "/api/perp/markets",
  ]);
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/perp/")) return;
    const path = req.url.split("?")[0] ?? "";
    if (open.has(path)) return;
    const session = authSessionFor(bearerFrom(req.headers.authorization));
    if (!session) {
      return reply
        .code(401)
        .send({ error: "sign in with a PERPL_MANAGERS address to use the perp API" });
    }
    req.perpAddress = session.address;
  });

  /** Step one: the text to sign. Single use, five minutes. */
  app.post("/perp/auth/challenge", async (req, reply) => {
    const body = ChallengeSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "expected an address" });
    if (!isAllowed(body.data.address)) {
      return reply.code(403).send({ error: "address is not in PERPL_MANAGERS" });
    }
    return createChallenge(body.data.address);
  });

  /** Step two: the signature, for a token good for a day. */
  app.post("/perp/auth/verify", async (req, reply) => {
    const body = VerifySchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const result = await verifyChallenge(
      body.data.address,
      body.data.nonce,
      body.data.signature as `0x${string}`,
    );
    if (!result.ok) {
      app.log.warn({ address: body.data.address, reason: result.reason }, "perp sign in refused");
      return reply.code(401).send({ error: result.reason });
    }
    return {
      token: result.token,
      address: result.address,
      expiresAt: result.expiresAt,
      ttlMs: TOKEN_TTL_MS,
    };
  });

  app.post("/perp/auth/signout", async (req) => {
    const token = bearerFrom(req.headers.authorization);
    if (token) revoke(token);
    return { ok: true };
  });

  /**
   * Who may sign in, and whether the shared account is usable at all. Public, because the sign in
   * card needs both before any token exists.
   */
  app.get("/perp/auth/allowed", async () => ({
    managers: allowedManagers(),
    configured: credentialsConfigured(),
  }));

  app.get("/perp/account", async (_req, reply) => {
    const session = sharedSession();
    if (!session) {
      return reply.code(503).send({
        error: "no Perpl credentials on the backend",
        hint: "run perpl:enroll, then set PERPL_API_KEY and PERPL_API_KEY_SECRET in apps/be/.env",
      });
    }
    const account = session.account();
    // Positions arrive as scaled integers against a market the browser does not know, so the
    // entry, mark, notional, funding and liquidation estimate are worked out here.
    const markets = await listMarkets().catch(() => []);
    const byId = new Map(markets.map((m) => [m.id, m]));
    return {
      ...account,
      positions: account.positions.map((p) => {
        const market = p.market === null ? undefined : byId.get(p.market);
        return market ? { ...p, view: describePosition(p.raw, market) } : p;
      }),
    };
  });

  app.get("/perp/markets", async (_req, reply) => {
    try {
      const { listMarkets } = await import("../services/perplAccounts.js");
      return { markets: await listMarkets() };
    } catch (err) {
      app.log.warn({ err }, "perpl markets unavailable");
      return reply.code(503).send({ error: "markets unavailable" });
    }
  });

  app.post("/perp/short", async (req, reply) => {
    const body = OpenShortSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: z.prettifyError(body.error) });
    }
    const session = sharedSession();
    if (!session) return reply.code(503).send({ error: "no Perpl credentials on the backend" });

    const market = await findMarket(body.data.market);
    if (!market) return reply.code(404).send({ error: `unknown market ${body.data.market}` });

    try {
      const frames = openShortFrames(
        {
          market,
          size: body.data.size,
          leverage: body.data.leverage,
          stopLoss: body.data.stopLoss,
          takeProfit: body.data.takeProfit,
        },
        session.nextRequestId,
        session.nextSeq,
        body.data.positionId,
      );
      const statuses = await session.submit(frames);
      const refused = statuses.find((s) => !s.accepted);
      if (refused) {
        app.log.warn(
          { by: req.perpAddress, code: refused.code, error: refused.error },
          "perpl refused the short",
        );
        return reply.code(502).send({
          error: refused.error ?? `Perpl refused the order (code ${refused.code})`,
          code: refused.code,
        });
      }
      // One shared account, so who sent it only exists in this log.
      app.log.info(
        { by: req.perpAddress, size: body.data.size, market: market.name, accepted: statuses.length },
        "short opened",
      );
      await recordActivity({
        source: "perp",
        kind: "perp.openShort",
        status: "ok",
        summary: `Opened a ${body.data.size} ${market.name} short by hand`,
        actor: req.perpAddress ?? null,
        detail: {
          size: body.data.size,
          stopLoss: body.data.stopLoss ?? null,
          takeProfit: body.data.takeProfit ?? null,
        },
      });
      return { sent: statuses.length, requestIds: frames.map((f) => f.rq), market: market.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.warn({ err, by: req.perpAddress }, "open short refused");
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/perp/short/close", async (req, reply) => {
    const body = CloseShortSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const session = sharedSession();
    if (!session) return reply.code(503).send({ error: "no Perpl credentials on the backend" });

    const market = await findMarket(body.data.market);
    if (!market) return reply.code(404).send({ error: `unknown market ${body.data.market}` });

    try {
      const frame = closeShortFrame(market, body.data.size, session.nextRequestId, session.nextSeq);
      const [status] = await session.submit([frame]);
      if (!status?.accepted) {
        app.log.warn(
          { by: req.perpAddress, code: status?.code, error: status?.error },
          "perpl refused the close",
        );
        return reply.code(502).send({
          error: status?.error ?? "Perpl refused the order",
          code: status?.code,
        });
      }
      app.log.info(
        { by: req.perpAddress, size: body.data.size, market: market.name },
        "short closed",
      );
      await recordActivity({
        source: "perp",
        kind: "perp.closeShort",
        status: "ok",
        summary: `Closed ${body.data.size} ${market.name} of the short by hand`,
        actor: req.perpAddress ?? null,
      });
      return { sent: 1, requestIds: [frame.rq], market: market.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.warn({ err, by: req.perpAddress }, "close short refused");
      return reply.code(400).send({ error: message });
    }
  });
};
