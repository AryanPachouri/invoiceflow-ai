import { getDb, type Db } from "./db";
import { env } from "./env";
import { failStaleRuns } from "./repositories/runs";
import { isSeeded, seedHistory, seedMasterData } from "./seed";

const g = globalThis as unknown as { __invoiceflowBoot?: Promise<Db> };

/**
 * Ensure the database is migrated (done in getDb), seeded on first boot, and that any runs
 * orphaned by a restart are recorded as FAILED. Safe to call on every request.
 */
export function ready(): Promise<Db> {
  if (!g.__invoiceflowBoot) {
    g.__invoiceflowBoot = (async () => {
      const db = await getDb();
      if (env.autoSeed && !(await isSeeded(db))) {
        console.log("[bootstrap] seeding master data and sample history…");
        await seedMasterData(db);
        await seedHistory(db);
      }
      return db;
    })().catch((e) => {
      g.__invoiceflowBoot = undefined;
      throw e;
    });
  }
  return g.__invoiceflowBoot.then(async (db) => {
    await failStaleRuns(db).catch(() => undefined);
    return db;
  });
}
