import fs from "node:fs";
import path from "node:path";
import { env } from "../env";

/**
 * Database layer.
 *
 * Production: PostgreSQL via DATABASE_URL (e.g. Supabase Postgres, server-side only).
 * Local / tests: PGlite — real Postgres compiled to WASM, persisted to disk — so the exact
 * same SQL migrations, constraints, row locks and transactions are exercised everywhere.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  kind: "postgres" | "pglite";
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

async function createPgliteDb(dataDir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (!dataDir.startsWith("memory://")) fs.mkdirSync(dataDir, { recursive: true });
  // Keep DATE columns as 'YYYY-MM-DD' strings, matching the node-postgres config below.
  const pg = new PGlite(dataDir, { parsers: { 1082: (v: string) => v } });
  await pg.waitReady;
  // PGlite is a single connection; serialize transactions so interleaved async work can't
  // issue statements inside another caller's transaction.
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    kind: "pglite",
    query: (sql, params) => serialize(async () => {
      const r = await pg.query(sql, params as unknown[] | undefined);
      return { rows: r.rows as never[] };
    }),
    transaction: (fn) =>
      serialize(() =>
        pg.transaction(async (tx) =>
          fn({
            query: async (sql, params) => {
              const r = await tx.query(sql, params as unknown[] | undefined);
              return { rows: r.rows as never[] };
            },
          }),
        ),
      ),
    exec: (sql) => serialize(async () => { await pg.exec(sql); }),
    close: () => pg.close(),
  };
}

async function createPostgresDb(url: string): Promise<Db> {
  const { Pool, types } = await import("pg");
  // Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
  types.setTypeParser(1082, (v: string) => v);
  const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  pool.on("error", (err) => console.error("[db] idle client error", err.message));
  return {
    kind: "postgres",
    query: async (sql, params) => {
      const r = await pool.query(sql, params as unknown[]);
      return { rows: r.rows };
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async (sql, params) => {
            const r = await client.query(sql, params as unknown[]);
            return { rows: r.rows };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    exec: async (sql) => { await pool.query(sql); },
    close: () => pool.end(),
  };
}

export function migrationsDir() {
  return path.join(process.cwd(), "db", "migrations");
}

export async function runMigrations(db: Db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await db.exec(sql);
    await db.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
    newlyApplied.push(file);
  }
  return newlyApplied;
}

type DbGlobal = { __invoiceflowDb?: Promise<Db> };
const g = globalThis as unknown as DbGlobal;

/** Create a fresh database handle (used by tests and scripts). */
export async function createDb(opts: { url?: string; pgliteDir?: string } = {}): Promise<Db> {
  const url = opts.url ?? env.databaseUrl;
  const db = url ? await createPostgresDb(url) : await createPgliteDb(opts.pgliteDir ?? env.pgliteDir);
  await runMigrations(db);
  return db;
}

/** Process-wide database singleton. */
export function getDb(): Promise<Db> {
  if (!g.__invoiceflowDb) {
    g.__invoiceflowDb = createDb().catch((e) => {
      g.__invoiceflowDb = undefined;
      throw new DatabaseUnavailableError(e instanceof Error ? e.message : String(e));
    });
  }
  return g.__invoiceflowDb;
}

/** Test hook: install a specific db as the singleton. */
export function setDbForTesting(db: Db | undefined) {
  g.__invoiceflowDb = db ? Promise.resolve(db) : undefined;
}

export class DatabaseUnavailableError extends Error {
  constructor(detail: string) {
    super(`Database unavailable: ${detail}`);
    this.name = "DatabaseUnavailableError";
  }
}

export const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
