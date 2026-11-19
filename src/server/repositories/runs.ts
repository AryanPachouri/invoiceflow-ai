import { num, type Db, type Queryable } from "../db";
import { env } from "../env";

export const STAGES = [
  { order: 1, key: "INGESTION", name: "Document Ingestion", description: "Validate the PDF, assign a run ID, fingerprint and store the original file" },
  { order: 2, key: "EXTRACTION", name: "Document Extraction", description: "Read the text layer (OCR for scanned pages) and extract structured invoice fields" },
  { order: 3, key: "VALIDATION", name: "Data Validation", description: "Check required fields, formats, dates, currency and invoice arithmetic" },
  { order: 4, key: "VENDOR_VERIFICATION", name: "Vendor Verification", description: "Match the vendor against the approved vendor master" },
  { order: 5, key: "DUPLICATE_DETECTION", name: "Duplicate Detection", description: "Atomically claim vendor + invoice number and document fingerprint" },
  { order: 6, key: "PO_MATCHING", name: "Purchase Order Matching", description: "Find the purchase order by reference, or search for candidate POs" },
  { order: 7, key: "RECONCILIATION", name: "Financial Reconciliation", description: "Compare amounts, currency and lines against the PO balance within tolerance" },
  { order: 8, key: "DECISION", name: "Decision Engine", description: "Apply deterministic business rules and commit the PO allocation" },
  { order: 9, key: "REPORT", name: "Final Output", description: "Assemble the processing report and persist the outcome" },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];
export type StageStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";

export async function createRun(db: Db, input: { filename: string; fileSize: number; isSample?: boolean }) {
  return db.transaction((tx) => createRunTx(tx, input));
}

/** Insert a run plus its nine PENDING stages inside an existing transaction. */
export async function createRunTx(tx: Queryable, input: { filename: string; fileSize: number; isSample?: boolean; reprocessedFrom?: string | null }) {
  const { rows } = await tx.query<{ id: string; run_number: string }>(
    `INSERT INTO processing_runs (filename, file_size, run_status, is_sample, reprocessed_from_run_id) VALUES ($1, $2, 'QUEUED', $3, $4) RETURNING id, run_number`,
    [input.filename, input.fileSize, !!input.isSample, input.reprocessedFrom ?? null],
  );
  const run = rows[0];
  for (const s of STAGES) {
    await tx.query(
      `INSERT INTO processing_stages (run_id, stage_order, stage_key, stage_name) VALUES ($1, $2, $3, $4)`,
      [run.id, s.order, s.key, s.name],
    );
  }
  return { id: run.id, runNumber: Number(run.run_number) };
}

export async function updateRun(db: Queryable, id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const values = keys.map((k) => {
    const v = fields[k];
    return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  await db.query(`UPDATE processing_runs SET ${sets}, heartbeat_at = now() WHERE id = $1`, [id, ...values]);
}

export async function updateStage(db: Queryable, runId: string, key: StageKey, fields: {
  stage_status?: StageStatus; outcome?: "PASS" | "WARN" | "FAIL" | null; summary?: string | null;
  input_data?: unknown; output_data?: unknown; error_message?: string | null; logs?: unknown;
  started_at?: Date | null; completed_at?: Date | null; duration?: number | null;
}) {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
  const values = keys.map((k) => {
    const v = fields[k];
    return ["input_data", "output_data", "logs"].includes(k) && v !== null && v !== undefined ? JSON.stringify(v) : v;
  });
  await db.query(`UPDATE processing_stages SET ${sets} WHERE run_id = $1 AND stage_key = $2`, [runId, key, ...values]);
  await db.query(`UPDATE processing_runs SET heartbeat_at = now(), current_stage = $2 WHERE id = $1`, [runId, key]);
}

export async function resetStages(db: Queryable, runId: string) {
  await db.query(
    `UPDATE processing_stages SET stage_status='PENDING', outcome=NULL, summary=NULL, input_data=NULL, output_data=NULL,
       error_message=NULL, logs='[]'::jsonb, started_at=NULL, completed_at=NULL, duration=NULL WHERE run_id = $1`,
    [runId],
  );
}

/** Mark runs that stopped sending heartbeats (server restart, crash) as FAILED so nothing is silently lost. */
export async function failStaleRuns(db: Queryable) {
  const secs = Math.ceil(env.runTimeoutMs / 1000);
  const { rows } = await db.query<{ id: string }>(
    `UPDATE processing_runs SET run_status = 'FAILED', completed_at = now(),
       error_message = coalesce(error_message, 'Processing timed out or the server restarted mid-run. Safe to retry')
     WHERE run_status IN ('QUEUED','PROCESSING') AND heartbeat_at < now() - ($1 || ' seconds')::interval
     RETURNING id`,
    [String(secs)],
  );
  for (const r of rows) {
    await db.query(`UPDATE processing_stages SET stage_status = 'FAILED', error_message = 'Interrupted', completed_at = now()
                    WHERE run_id = $1 AND stage_status = 'RUNNING'`, [r.id]);
    await db.query("DELETE FROM invoice_claims WHERE run_id = $1", [r.id]);
  }
  return rows.length;
}

const RUN_COLUMNS = `r.id, r.run_number, r.filename, r.file_size, r.run_status, r.current_stage, r.extraction_method, r.extraction_confidence,
  r.invoice_number, r.vendor_name_extracted, r.vendor_id, v.vendor_name, v.vendor_code, r.po_reference, r.po_id, p.po_number,
  r.invoice_date, r.due_date, r.currency, r.subtotal, r.tax_amount, r.total_amount, r.final_status, r.decision_reasons,
  r.duplicate_of_run_id, r.error_message, r.attempt, r.is_sample, r.started_at, r.completed_at, r.duration,
  r.reprocessed_from_run_id, r.superseded_by_run_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RunRow = Record<string, any> & { id: string; run_number: number; subtotal: number | null; tax_amount: number | null; total_amount: number | null };

export function mapRun(r: Record<string, unknown>): RunRow {
  return {
    ...r,
    run_number: Number(r.run_number),
    extraction_confidence: num(r.extraction_confidence),
    subtotal: num(r.subtotal), tax_amount: num(r.tax_amount), total_amount: num(r.total_amount),
  } as unknown as RunRow;
}

export interface RunFilters {
  q?: string; status?: string; from?: string; to?: string; includeSamples?: boolean;
  sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number;
}

const SORTABLE: Record<string, string> = {
  started_at: "r.started_at", total_amount: "r.total_amount", invoice_number: "r.invoice_number",
  vendor: "coalesce(v.vendor_name, r.vendor_name_extracted)", final_status: "r.final_status", duration: "r.duration", run_number: "r.run_number",
};

export async function listRuns(db: Queryable, f: RunFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.includeSamples === false) where.push("r.is_sample = false");
  if (f.q?.trim()) {
    const ph = p(`%${f.q.trim().toLowerCase()}%`);
    where.push(`(lower(coalesce(r.invoice_number,'')) LIKE ${ph} OR lower(r.filename) LIKE ${ph} OR lower(coalesce(v.vendor_name, r.vendor_name_extracted, '')) LIKE ${ph} OR lower(coalesce(p.po_number, r.po_reference, '')) LIKE ${ph} OR CAST(r.run_number AS TEXT) = ${p(f.q.trim().replace(/^#/, ""))})`);
  }
  if (f.status && f.status !== "ALL") {
    if (["APPROVED", "NEEDS_REVIEW", "REJECTED"].includes(f.status)) where.push(`r.final_status = ${p(f.status)}`);
    else if (f.status === "FAILED") where.push("r.run_status = 'FAILED'");
    else if (f.status === "PROCESSING") where.push("r.run_status IN ('QUEUED','PROCESSING')");
  }
  if (f.from) where.push(`r.started_at >= ${p(f.from)}::date`);
  if (f.to) where.push(`r.started_at < (${p(f.to)}::date + interval '1 day')`);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortCol = SORTABLE[f.sort ?? "started_at"] ?? "r.started_at";
  const dir = f.dir === "asc" ? "ASC" : "DESC";
  const pageSize = Math.min(Math.max(f.pageSize ?? 10, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const from = `FROM processing_runs r LEFT JOIN vendors v ON v.id = r.vendor_id LEFT JOIN purchase_orders p ON p.id = r.po_id`;
  const { rows: countRows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n ${from} ${w}`, params);
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT ${RUN_COLUMNS} ${from} ${w} ORDER BY ${sortCol} ${dir} NULLS LAST, r.run_number DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  return { rows: rows.map(mapRun), total: Number(countRows[0].n), page, pageSize };
}

export async function getRun(db: Queryable, id: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT ${RUN_COLUMNS}, r.file_fingerprint, r.file_path, r.decision, r.extracted_data, r.rules_snapshot, r.heartbeat_at,
       d.run_number AS duplicate_of_run_number, rf.run_number AS reprocessed_from_run_number, sb.run_number AS superseded_by_run_number,
       v.status AS vendor_status, v.email AS vendor_email
     FROM processing_runs r LEFT JOIN vendors v ON v.id = r.vendor_id LEFT JOIN purchase_orders p ON p.id = r.po_id
     LEFT JOIN processing_runs d ON d.id = r.duplicate_of_run_id
     LEFT JOIN processing_runs rf ON rf.id = r.reprocessed_from_run_id
     LEFT JOIN processing_runs sb ON sb.id = r.superseded_by_run_id
     WHERE r.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: stages } = await db.query<Record<string, unknown>>(
    `SELECT stage_order, stage_key, stage_name, stage_status, outcome, summary, input_data, output_data, error_message, logs,
       started_at, completed_at, duration FROM processing_stages WHERE run_id = $1 ORDER BY stage_order`,
    [id],
  );
  const run: RunRow = mapRun(rows[0]);
  run.duplicate_of_run_number = rows[0].duplicate_of_run_number ? Number(rows[0].duplicate_of_run_number) : null;
  run.reprocessed_from_run_number = rows[0].reprocessed_from_run_number ? Number(rows[0].reprocessed_from_run_number) : null;
  run.superseded_by_run_number = rows[0].superseded_by_run_number ? Number(rows[0].superseded_by_run_number) : null;
  run.stages = stages;
  return run;
}

export async function getMetrics(db: Queryable, includeSamples: boolean) {
  // Superseded runs stay in history but are not double-counted in KPIs.
  const w = includeSamples ? "WHERE superseded_by_run_id IS NULL" : "WHERE is_sample = false AND superseded_by_run_id IS NULL";
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT count(*)::int AS total_runs,
       count(*) FILTER (WHERE run_status = 'COMPLETED')::int AS processed,
       count(*) FILTER (WHERE final_status = 'APPROVED')::int AS approved,
       count(*) FILTER (WHERE final_status = 'NEEDS_REVIEW')::int AS needs_review,
       count(*) FILTER (WHERE final_status = 'REJECTED')::int AS rejected,
       count(*) FILTER (WHERE run_status = 'FAILED')::int AS failed,
       count(*) FILTER (WHERE run_status IN ('QUEUED','PROCESSING'))::int AS in_progress,
       count(*) FILTER (WHERE is_sample)::int AS sample_runs,
       coalesce(avg(duration) FILTER (WHERE run_status = 'COMPLETED'), 0)::int AS avg_duration
     FROM processing_runs ${w}`,
  );
  const { rows: byCcy } = await db.query<Record<string, unknown>>(
    `SELECT currency, sum(total_amount) AS total, sum(total_amount) FILTER (WHERE final_status = 'APPROVED') AS approved_total, count(*)::int AS n
     FROM processing_runs ${w ? w + " AND" : "WHERE"} run_status = 'COMPLETED' AND currency IS NOT NULL GROUP BY currency ORDER BY sum(total_amount) DESC`,
  );
  const { rows: daily } = await db.query<Record<string, unknown>>(
    `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
       count(*) FILTER (WHERE final_status = 'APPROVED')::int AS approved,
       count(*) FILTER (WHERE final_status = 'NEEDS_REVIEW')::int AS needs_review,
       count(*) FILTER (WHERE final_status = 'REJECTED')::int AS rejected,
       count(*) FILTER (WHERE run_status = 'FAILED')::int AS failed
     FROM processing_runs ${w ? w + " AND" : "WHERE"} started_at > now() - interval '14 days'
     GROUP BY 1 ORDER BY 1`,
  );
  const m = rows[0];
  const processed = Number(m.processed);
  return {
    totalRuns: Number(m.total_runs), processed, approved: Number(m.approved), needsReview: Number(m.needs_review),
    rejected: Number(m.rejected), failed: Number(m.failed), inProgress: Number(m.in_progress), sampleRuns: Number(m.sample_runs),
    avgDurationMs: Number(m.avg_duration),
    approvalRate: processed ? Math.round((Number(m.approved) / processed) * 1000) / 10 : 0,
    valueByCurrency: byCcy.map((r) => ({ currency: r.currency as string, total: num(r.total) ?? 0, approvedTotal: num(r.approved_total) ?? 0, count: Number(r.n) })),
    daily: daily.map((d) => ({ day: d.day as string, approved: Number(d.approved), needsReview: Number(d.needs_review), rejected: Number(d.rejected), failed: Number(d.failed) })),
  };
}

/** Delete all non-sample runs (and their claims/allocations via cascade). Master data and seeded history stay. */
export async function resetDemoRuns(db: Db) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ file_path: string | null }>("DELETE FROM processing_runs WHERE is_sample = false RETURNING file_path");
    return rows.map((r) => r.file_path).filter((p): p is string => !!p);
  });
}
