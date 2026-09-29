import { env } from "./config.js";
import { buildServer } from "./server.js";
import { keeper } from "./services/keeper.js";
import { stopAllSessions } from "./services/perplAccounts.js";
import { automation } from "./services/automationRunner.js";
import { closeMongo } from "./lib/mongo.js";

const app = await buildServer();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  if (env.KEEPER_ENABLED) keeper.start();
  automation.start();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    keeper.stop();
    automation.stop();
    stopAllSessions();
    await closeMongo();
    await app.close();
    process.exit(0);
  });
}
