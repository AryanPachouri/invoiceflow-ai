import { createDb, runMigrations } from "../src/server/db";
import { env } from "../src/server/env";

async function main() {
  console.log(`Migrating ${env.databaseUrl ? "PostgreSQL (DATABASE_URL)" : `PGlite at ${env.pgliteDir}`}…`);
  const db = await createDb(); // createDb applies pending migrations
  const again = await runMigrations(db);
  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
  console.log(`Applied migrations: ${rows.map((r) => r.name).join(", ")}${again.length ? "" : " (up to date)"}`);
  await db.close();
}
main().catch((e) => { console.error("Migration failed:", e.message); process.exit(1); });
