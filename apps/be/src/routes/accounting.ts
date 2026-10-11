import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { accounting, getAccountingHistory } from "../services/accounting.js";

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

export const accountingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/vault/history/status", async () => accounting.status());
  app.get("/vault/history", async (req, reply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "days must be an integer from 1 to 90" });
    try {
      return await getAccountingHistory(parsed.data.days);
    } catch (err) {
      app.log.warn({ err }, "vault accounting history unavailable");
      return reply.code(503).send({ error: "accounting history unavailable" });
    }
  });
};
