import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Tests use an in-memory embedded Postgres and a temp directory for documents. No external services.
process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
process.env.PIPELINE_STAGE_DELAY_MS = "0";
process.env.AUTO_SEED = "false";
process.env.LOCAL_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "invoiceflow-test-"));
