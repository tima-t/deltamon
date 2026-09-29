import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { AutomationConfigSchema, deltaMonVaultAbi } from "@deltamon/shared";
import type { Address } from "viem";
import { env } from "../config.js";
import { publicClient } from "../chain.js";
import { mongoConfigured } from "../lib/mongo.js";
import { listActivity, readConfig, writeConfig } from "../services/automationStore.js";
import { recentFlows } from "../services/flowEngine.js";
import { bearerFrom, sessionFor } from "../services/perpAuth.js";

/**
 * The automation's surface.
 *
 * Config is admin only, and "admin" means the vault's own owner, read from the chain rather than
 * from a list in the environment. Activity is public: it is a record of what has already happened,
 * and hiding it would make the vault less legible, not safer.
 */

const ConfigInput = AutomationConfigSchema.omit({ updatedAt: true, updatedBy: true });

let ownerCache: { at: number; owner: Address } | null = null;

async function vaultOwner(): Promise<Address | null> {
  const vault = env.VAULT_ADDRESS as Address | undefined;
  if (!vault) return null;
  if (ownerCache && Date.now() - ownerCache.at < 60_000) return ownerCache.owner;
  const owner = await publicClient.readContract({
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "owner",
  });
  ownerCache = { at: Date.now(), owner };
  return owner;
}

export const automationRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Writing the config needs a session proving control of the vault owner. The session itself is
   * minted by the /perp/auth pair, so there is one sign-in for the whole console.
   */
  const requireAdmin = async (
    req: FastifyRequest,
  ): Promise<{ ok: true; address: string } | { ok: false; status: number; error: string }> => {
    const session = await sessionFor(bearerFrom(req.headers.authorization));
    if (!session) return { ok: false, status: 401, error: "sign in to change the automation" };
    const owner = await vaultOwner();
    if (!owner) return { ok: false, status: 503, error: "no vault configured" };
    if (owner.toLowerCase() !== session.address.toLowerCase()) {
      return { ok: false, status: 403, error: "only the vault admin can change the automation" };
    }
    return { ok: true, address: session.address };
  };

  app.get("/automation/config", async (_req, reply) => {
    if (!mongoConfigured()) {
      return reply
        .code(503)
        .send({ error: "automation storage is not configured", hint: "set MONGO_CONNECTION_STRING" });
    }
    const config = await readConfig();
    const owner = await vaultOwner();
    // The config is not a secret, and the console needs it to render the tab before signing in.
    return { config, admin: owner, ready: Boolean(env.ADMIN_PRIVATE_KEY) };
  });

  app.put("/automation/config", async (req, reply) => {
    const allowed = await requireAdmin(req);
    if (!allowed.ok) return reply.code(allowed.status).send({ error: allowed.error });
    if (!mongoConfigured()) {
      return reply.code(503).send({ error: "automation storage is not configured" });
    }
    const body = ConfigInput.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const saved = await writeConfig(body.data, allowed.address);
    return { config: saved };
  });

  /** Read only, and deliberately public. */
  app.get<{ Querystring: { limit?: string; before?: string } }>(
    "/automation/activity",
    async (req, reply) => {
      if (!mongoConfigured()) return reply.code(503).send({ error: "activity log unavailable" });
      const limit = Number(req.query.limit ?? 100);
      const entries = await listActivity(
        Number.isFinite(limit) ? limit : 100,
        req.query.before,
      );
      return { entries };
    },
  );

  /** The pipeline runs themselves, so a stalled step is visible with its reason. */
  app.get("/automation/flows", async (_req, reply) => {
    if (!mongoConfigured()) return reply.code(503).send({ error: "automation storage unavailable" });
    return { flows: await recentFlows(20) };
  });
};
