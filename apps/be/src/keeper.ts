// Standalone keeper entry point (`pnpm --filter @deltamon/be keeper`).
// Runs the same loop as the API process, without the HTTP server.
import { keeper } from "./services/keeper.js";
import { logger } from "./lib/logger.js";

keeper.start();
logger.info("keeper running standalone; Ctrl+C to stop");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    keeper.stop();
    process.exit(0);
  });
}
