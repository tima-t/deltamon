import type { FastifyPluginAsync } from "fastify";
import { getVaultStats } from "../services/vault.js";
import { keeper } from "../services/keeper.js";

export const vaultRoutes: FastifyPluginAsync = async (app) => {
  app.get("/vault", async () => getVaultStats());

  app.get("/vault/allocation", async () => {
    const stats = await getVaultStats();
    return { allocation: stats.allocation, updatedAt: stats.updatedAt, source: stats.source };
  });

  app.get("/keeper", async () => keeper.getStatus());
};
