import { createDb, setDbForTesting } from "../src/server/db";
import { seedHistory, seedMasterData } from "../src/server/seed";

/** Seeds vendors, purchase orders and sample history (processed through the real pipeline). Idempotent. */
async function main() {
  process.env.PIPELINE_STAGE_DELAY_MS = "0";
  const db = await createDb();
  setDbForTesting(db);
  console.log("Seeding master data…", await seedMasterData(db));
  console.log("Processing sample history invoices…", JSON.stringify(await seedHistory(db)));
  await db.close();
}
main().catch((e) => { console.error("Seed failed:", e.message); process.exit(1); });
