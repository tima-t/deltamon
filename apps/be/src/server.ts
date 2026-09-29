import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config.js";
import { loggerOptions } from "./lib/logger.js";
import { healthRoutes } from "./routes/health.js";
import { vaultRoutes } from "./routes/vault.js";
import { marketRoutes } from "./routes/markets.js";
import { perpRoutes } from "./routes/perp.js";
import { automationRoutes } from "./routes/automation.js";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions });

  await app.register(helmet, { contentSecurityPolicy: false });
  // @fastify/cors allows only GET, HEAD and POST by default, so a browser's preflight for a PUT
  // is refused before the request is sent and the console sees an unreachable backend.
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  await app.register(healthRoutes);
  await app.register(vaultRoutes, { prefix: "/api" });
  await app.register(marketRoutes, { prefix: "/api" });
  await app.register(perpRoutes, { prefix: "/api" });
  await app.register(automationRoutes, { prefix: "/api" });

  return app;
}
