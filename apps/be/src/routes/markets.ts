import type { FastifyPluginAsync } from "fastify";
import { PYTH_FEEDS } from "@deltamon/shared";
import { getFundingSnapshots } from "../services/perpl.js";
import { getPythPrice } from "../services/pyth.js";

export const marketRoutes: FastifyPluginAsync = async (app) => {
  app.get("/markets/funding", async (_req, reply) => {
    try {
      return await getFundingSnapshots();
    } catch (err) {
      app.log.warn({ err }, "perpl funding unavailable");
      return reply.code(503).send({ error: "funding data unavailable" });
    }
  });

  app.get<{ Params: { symbol: string } }>("/prices/:symbol", async (req, reply) => {
    const symbol = req.params.symbol.toUpperCase().replace("-", "_");
    if (!(symbol in PYTH_FEEDS)) {
      return reply
        .code(404)
        .send({ error: `unknown symbol; try ${Object.keys(PYTH_FEEDS).join(", ")}` });
    }
    try {
      return await getPythPrice(symbol as keyof typeof PYTH_FEEDS);
    } catch (err) {
      app.log.warn({ err, symbol }, "pyth price unavailable");
      return reply.code(503).send({ error: "price unavailable" });
    }
  });
};
