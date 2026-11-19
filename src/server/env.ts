import path from "node:path";

/**
 * Centralised, server-only environment configuration.
 * Every external integration is optional: missing credentials switch the app into a
 * documented local fallback instead of crashing.
 */
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === "" ? d : /^(1|true|yes)$/i.test(v));
const int = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const env = {
  get databaseUrl() { return process.env.DATABASE_URL?.trim() || undefined; },
  get pgliteDir() { return process.env.PGLITE_DATA_DIR?.trim() || path.join(process.cwd(), ".data", "pglite"); },
  get supabaseUrl() { return process.env.SUPABASE_URL?.trim() || undefined; },
  get supabaseServiceRoleKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined; },
  get storageBucket() { return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "invoices"; },
  get localStorageDir() { return process.env.LOCAL_STORAGE_DIR?.trim() || path.join(process.cwd(), ".data", "uploads"); },
  get anthropicApiKey() { return process.env.ANTHROPIC_API_KEY?.trim() || undefined; },
  get anthropicModel() { return process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5"; },
  get aiTimeoutMs() { return int(process.env.AI_TIMEOUT_MS, 30_000); },
  get ocrTimeoutMs() { return int(process.env.OCR_TIMEOUT_MS, 90_000); },
  get maxUploadMb() { return int(process.env.MAX_UPLOAD_MB, 10); },
  get runTimeoutMs() { return int(process.env.RUN_TIMEOUT_MS, 180_000); },
  /** Optional pacing so humans can follow each stage in a live demo. Stage status still reflects real backend state. */
  get stageDelayMs() { const n = Number(process.env.PIPELINE_STAGE_DELAY_MS); return Number.isFinite(n) && n >= 0 ? n : 400; },
  get resendApiKey() { return process.env.RESEND_API_KEY?.trim() || undefined; },
  get emailFrom() { return process.env.EMAIL_FROM?.trim() || undefined; },
  get emailReplyTo() { return process.env.EMAIL_REPLY_TO?.trim() || undefined; },
  get companyName() { return process.env.COMPANY_NAME?.trim() || "Contoso Manufacturing Corp."; },
  get emailConfigured() { return !!(this.resendApiKey && this.emailFrom); },
  get autoSeed() { return bool(process.env.AUTO_SEED, true); },
};

export function integrationStatus() {
  return {
    database: env.databaseUrl ? "postgres" : "pglite (local embedded Postgres)",
    storage: env.supabaseUrl && env.supabaseServiceRoleKey ? "supabase" : "local filesystem",
    ai: env.anthropicApiKey ? `claude (${env.anthropicModel})` : "disabled — deterministic parser + OCR only",
    email: env.emailConfigured ? `resend (from ${env.emailFrom})` : "not configured — drafts and copy-to-clipboard only",
  } as const;
}
