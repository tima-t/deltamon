import { accounting } from "../src/services/accounting.js";
import { closeMongo } from "../src/lib/mongo.js";

try {
  if (!accounting.status().configured || !accounting.status().enabled) {
    throw new Error("accounting requires ACCOUNTING_ENABLED, VAULT_ADDRESS and MongoDB");
  }
  await accounting.tick();
  const status = accounting.status();
  console.log(JSON.stringify(status, null, 2));
  if (status.errors.length) process.exitCode = 1;
} finally {
  await accounting.stop();
  await closeMongo();
}
