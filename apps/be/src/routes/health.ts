import type { FastifyPluginAsync } from "fastify";
import type { Health } from "@deltamon/shared";
import { publicClient } from "../chain.js";
import { env } from "../config.js";
import { keeper } from "../services/keeper.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (): Promise<Health> => {
    let blockNumber: string | null = null;
    try {
      blockNumber = (await publicClient.getBlockNumber()).toString();
    } catch (err) {
      app.log.warn({ err }, "rpc unreachable");
    }
    return {
      status: "ok",
      chainId: env.CHAIN_ID,
      blockNumber,
      keeper: keeper.getStatus(),
      version: process.env.npm_package_version ?? "0.1.0",
    };
  });
};
