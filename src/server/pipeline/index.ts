import crypto from "node:crypto";
import { getDb, type Db } from "../db";
import { env } from "../env";
import { getStorage, withRetry } from "../storage";
import { extractInvoice, OcrError, PdfParseError } from "../extraction";
import { netAmount, type ExtractionResult } from "../extraction/types";
import { getRules } from "../repositories/settings";
import { getPurchaseOrdersWithBalances, getVendorsForMatching } from "../repositories/master-data";
import { claimKeys, commitDecision, releaseClaims, type ClaimKey } from "../repositories/claims";
import { STAGES, createRun, createRunTx, getRun, resetStages, updateRun, updateStage, type StageKey } from "../repositories/runs";
import { recordEvent } from "../repositories/events";
import type { BusinessRules } from "../seed/data";
import { validateInvoice } from "../rules/validation";
import { matchVendor, verifyVendor, type VendorMatch } from "../rules/vendor";
import { matchPurchaseOrder, type PoMatchResult } from "../rules/po";
import { reconcile, type ReconciliationSummary } from "../rules/reconciliation";
import { decide, type Decision } from "../rules/decision";
import { fail, money, normalizeInvoiceNumber, normalizeName, pass, round2, type Check } from "../rules/types";

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

/** Fast, synchronous checks applied before a run is created. */
export function validateUpload(filename: string, data: Buffer, maxMb = env.maxUploadMb) {
  if (!data.length) throw new UploadValidationError("The file is empty.");
  if (data.length > maxMb * 1024 * 1024) throw new UploadValidationError(`File is ${(data.length / 1048576).toFixed(1)} MB. The maximum allowed size is ${maxMb} MB.`);
  if (!/\.pdf$/i.test(filename)) throw new UploadValidationError("Only PDF files are accepted (.pdf).");
  if (data.subarray(0, 1024).indexOf("%PDF-") === -1) throw new UploadValidationError("This file is not a valid PDF (missing PDF header). It may be corrupted or renamed.");
}

interface LogEntry { t: string; level: "info" | "warn" | "error"; msg: string }

interface Ctx {
  db: Db;
  runId: string;
  rules: BusinessRules;
  checks: Check[];
  runLog: LogEntry[];
  aborted: boolean;
  pacingMs: number;
  data?: Buffer;
  fingerprint?: string;
  extraction?: ExtractionResult;
  vendorMatch?: VendorMatch;
  duplicate?: boolean;
  poMatch?: PoMatchResult;
  reconciliation?: ReconciliationSummary;
  decision?: Decision;
}

class AbortedError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stageOutcome(checks: Check[]): "PASS" | "WARN" | "FAIL" {
  if (checks.some((c) => c.status === "FAIL")) return "FAIL";
  if (checks.some((c) => c.status === "WARN" && c.action !== "NONE")) return "WARN";
  return "PASS";
}

/**
 * Run a stage: mark RUNNING (persisted) → execute real logic → persist COMPLETED/FAILED
 * with output, logs, timings. The UI only ever reflects what is in the database.
 */
async function runStage(
  ctx: Ctx,
  key: StageKey,
  input: unknown,
  fn: (log: (msg: string, level?: LogEntry["level"]) => void) => Promise<{ output: unknown; checks?: Check[]; summary: string; outcome?: "PASS" | "WARN" | "FAIL" }>,
) {
  if (ctx.aborted) throw new AbortedError();
  const logs: LogEntry[] = [];
  const log = (msg: string, level: LogEntry["level"] = "info") => {
    const e = { t: new Date().toISOString(), level, msg };
    logs.push(e);
    ctx.runLog.push({ ...e, msg: `[${key}] ${msg}` });
  };
  const started = new Date();
  await updateStage(ctx.db, ctx.runId, key, { stage_status: "RUNNING", started_at: started, input_data: input });
  const t0 = performance.now();
  try {
    const res = await fn(log);
    const duration = Math.round(performance.now() - t0);
    const completed = new Date();
    const checks = res.checks ?? [];
    ctx.checks.push(...checks);
    const outcome = res.outcome ?? stageOutcome(checks);
    if (ctx.pacingMs > duration) await sleep(ctx.pacingMs - duration); // demo pacing only; timings stay real
    if (ctx.aborted) throw new AbortedError();
    const failedMsgs = checks.filter((c) => c.status === "FAIL").map((c) => c.message);
    await updateStage(ctx.db, ctx.runId, key, {
      stage_status: outcome === "FAIL" ? "FAILED" : "COMPLETED",
      outcome, summary: res.summary,
      output_data: { ...(res.output as object), checks },
      error_message: outcome === "FAIL" ? failedMsgs.join(" | ") || res.summary : null,
      logs, completed_at: completed, duration,
    });
    return res;
  } catch (e) {
    if (e instanceof AbortedError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    log(msg, "error");
    await updateStage(ctx.db, ctx.runId, key, {
      stage_status: "FAILED", outcome: "FAIL", summary: "System error", error_message: msg, logs,
      completed_at: new Date(), duration: Math.round(performance.now() - t0),
    }).catch(() => undefined);
    throw e;
  }
}

async function skipStage(ctx: Ctx, key: StageKey, reason: string) {
  await updateStage(ctx.db, ctx.runId, key, {
    stage_status: "SKIPPED", summary: reason, output_data: { skipped: true, reason },
    logs: [{ t: new Date().toISOString(), level: "info", msg: `Skipped: ${reason}` }],
    started_at: new Date(), completed_at: new Date(), duration: 0,
  });
  ctx.runLog.push({ t: new Date().toISOString(), level: "info", msg: `[${key}] Skipped: ${reason}` });
}

// ---------------------------------------------------------------- stages

async function stageIngestion(ctx: Ctx, filename: string) {
  const data = ctx.data!;
  return runStage(ctx, "INGESTION", { filename, bytes: data.length }, async (log) => {
    validateUpload(filename, data);
    log(`Accepted ${filename} (${(data.length / 1024).toFixed(1)} KB)`);
    const fingerprint = crypto.createHash("sha256").update(data).digest("hex");
    ctx.fingerprint = fingerprint;
    log(`SHA-256 fingerprint ${fingerprint.slice(0, 16)}…`);
    const storage = getStorage();
    const key = `runs/${ctx.runId}/${filename.replace(/[^\w.\-]+/g, "_")}`;
    await withRetry(() => storage.put(key, data, "application/pdf"));
    log(`Stored original document in ${storage.kind === "supabase" ? `Supabase Storage (bucket "${env.storageBucket}")` : "local storage"} at ${key}`);
    await updateRun(ctx.db, ctx.runId, { file_path: key, file_fingerprint: fingerprint });
    return {
      summary: `Run created, document fingerprinted and stored (${storage.kind})`,
      output: { runId: ctx.runId, filename, sizeBytes: data.length, fingerprint, storage: storage.kind, storagePath: key },
      checks: [pass({ code: "FILE_VALID", stage: "INGESTION", label: "Valid PDF within size limit", severity: "CRITICAL", message: `PDF header present, ${(data.length / 1024).toFixed(1)} KB ≤ ${env.maxUploadMb} MB` })],
    };
  });
}

async function stageExtraction(ctx: Ctx) {
  return runStage(ctx, "EXTRACTION", { method: "pdf-text → OCR fallback → parser" + (env.anthropicApiKey ? " → Claude (low confidence only)" : "") }, async (log) => {
    try {
      const r = await extractInvoice(new Uint8Array(ctx.data!), { log: (m) => log(m) });
      ctx.extraction = r;
      const inv = r.invoice;
      await updateRun(ctx.db, ctx.runId, {
        extraction_method: r.method, extraction_confidence: r.confidence, invoice_number: inv.invoiceNumber,
        vendor_name_extracted: inv.vendorName, po_reference: inv.poReference, invoice_date: inv.invoiceDate, due_date: inv.dueDate,
        currency: inv.currency, subtotal: inv.subtotal, tax_amount: inv.taxAmount, total_amount: inv.totalAmount,
        extracted_data: { invoice: inv, fieldConfidence: r.fieldConfidence, warnings: r.warnings, method: r.method, confidence: r.confidence, ai: r.ai, ocrConfidence: r.ocrConfidence },
      });
      const critical = r.warnings.filter((w) => w.severity === "CRITICAL");
      critical.forEach((w) => log(w.message, "warn"));
      const found = Object.entries(inv).filter(([k, v]) => k !== "lineItems" && v !== null).length;
      return {
        summary: `${r.method.replace("_", " ")} · ${found}/12 fields · ${inv.lineItems.length} line item(s) · confidence ${r.confidence}%${critical.length ? ` · ${critical.length} critical field(s) missing` : ""}`,
        outcome: critical.length ? "WARN" : "PASS",
        output: {
          method: r.method, confidence: r.confidence, ocrConfidence: r.ocrConfidence ?? null, pageCount: r.pageCount,
          invoice: inv, fieldConfidence: r.fieldConfidence, warnings: r.warnings, ai: r.ai,
          rawTextPreview: r.rawText.slice(0, 4000),
        },
      };
    } catch (e) {
      if (e instanceof PdfParseError || e instanceof OcrError) {
        log(e.message, "error");
        return {
          summary: "Document could not be read",
          output: { error: e.message },
          checks: [fail({ code: "DOCUMENT_READABLE", stage: "EXTRACTION", label: "Document is machine-readable", severity: "CRITICAL", action: "REVIEW", message: `${e.message}. Manual data entry is required` })],
        };
      }
      throw e;
    }
  });
}

async function stageValidation(ctx: Ctx) {
  const inv = ctx.extraction!.invoice;
  return runStage(ctx, "VALIDATION", { fields: inv }, async (log) => {
    const checks = validateInvoice(inv, ctx.rules, { extractionConfidence: ctx.extraction!.confidence });
    checks.filter((c) => c.status !== "PASS").forEach((c) => log(`${c.status}: ${c.message}`, c.status === "FAIL" ? "warn" : "info"));
    const p = checks.filter((c) => c.status === "PASS").length;
    return { summary: `${p}/${checks.length} validation checks passed`, output: { passed: p, total: checks.length }, checks };
  });
}

async function stageVendor(ctx: Ctx) {
  const inv = ctx.extraction?.invoice;
  return runStage(ctx, "VENDOR_VERIFICATION", { vendorName: inv?.vendorName ?? null, vendorTaxId: inv?.vendorTaxId ?? null }, async (log) => {
    const vendors = await getVendorsForMatching(ctx.db);
    log(`Searching ${vendors.length} vendors in vendor master`);
    const match = matchVendor(inv?.vendorName ?? null, inv?.vendorTaxId ?? null, vendors);
    ctx.vendorMatch = match;
    const checks = verifyVendor(match, { vendorName: inv?.vendorName ?? null, vendorTaxId: inv?.vendorTaxId ?? null }, ctx.rules);
    if (match.vendor) await updateRun(ctx.db, ctx.runId, { vendor_id: match.vendor.id });
    return {
      summary: match.vendor ? `${match.vendor.vendor_name} (${match.vendor.vendor_code}) · ${match.vendor.status}` : "Vendor not found in vendor master",
      output: {
        matched: !!match.vendor, matchedBy: match.matchedBy, nameSimilarity: match.nameSimilarity,
        vendor: match.vendor ? { id: match.vendor.id, code: match.vendor.vendor_code, name: match.vendor.vendor_name, taxId: match.vendor.vendor_tax_id, status: match.vendor.status, address: match.vendor.address } : null,
        closestCandidates: match.candidates,
      },
      checks,
    };
  });
}

async function stageDuplicates(ctx: Ctx) {
  const inv = ctx.extraction?.invoice;
  const vendorKey = ctx.vendorMatch?.vendor?.id ?? (inv?.vendorName ? `name:${normalizeName(inv.vendorName)}` : null);
  const keys: ClaimKey[] = [];
  if (ctx.rules.duplicateDetection.byVendorAndInvoiceNumber && vendorKey && inv?.invoiceNumber) {
    keys.push({ key: `vi:${vendorKey}:${normalizeInvoiceNumber(inv.invoiceNumber)}`, type: "VENDOR_INVOICE", label: `vendor + invoice number ${inv.invoiceNumber}` });
  }
  if (ctx.rules.duplicateDetection.byFingerprint && ctx.fingerprint) {
    keys.push({ key: `fp:${ctx.fingerprint}`, type: "FINGERPRINT", label: "identical document fingerprint" });
  }
  return runStage(ctx, "DUPLICATE_DETECTION", { keys: keys.map((k) => ({ type: k.type, label: k.label })) }, async (log) => {
    const checks: Check[] = [];
    if (!keys.length) {
      checks.push({ code: "DUPLICATE_INVOICE", stage: "DUPLICATE_DETECTION", label: "No duplicate invoice", status: "WARN", severity: "MAJOR", action: "REVIEW", message: "Duplicate check could not run: invoice number/vendor missing and fingerprinting disabled" });
      return { summary: "Duplicate check incomplete", output: { duplicate: false, checkedKeys: [] }, checks };
    }
    log(`Claiming ${keys.length} key(s) atomically: ${keys.map((k) => k.label).join(", ")}`);
    const hits = await claimKeys(ctx.db, ctx.runId, keys);
    if (!keys.some((k) => k.type === "VENDOR_INVOICE")) log("Invoice number unavailable. Only the document fingerprint was checked", "warn");
    if (hits.length) {
      ctx.duplicate = true;
      const o = hits[0].originalRun;
      await updateRun(ctx.db, ctx.runId, { duplicate_of_run_id: o.id });
      const reason = hits.map((h) => h.claim.label).join(" and ");
      log(`Duplicate of run #${o.run_number} (${o.filename}) matched on ${reason}`, "warn");
      checks.push(fail({
        code: "DUPLICATE_INVOICE", stage: "DUPLICATE_DETECTION", label: "No duplicate invoice", severity: "CRITICAL",
        action: ctx.rules.duplicateDetection.action,
        message: `Duplicate of run #${o.run_number} (invoice ${o.invoice_number ?? "—"}, ${o.run_status === "COMPLETED" ? o.final_status : "still processing"}), matched on ${reason}`,
        expected: "unique", actual: `run #${o.run_number}`,
      }));
      return {
        summary: `Duplicate detected: original is run #${o.run_number}`,
        output: { duplicate: true, matchedOn: hits.map((h) => h.claim.type), originalRun: o, reason },
        checks,
      };
    }
    checks.push(pass({ code: "DUPLICATE_INVOICE", stage: "DUPLICATE_DETECTION", label: "No duplicate invoice", severity: "CRITICAL", message: `No prior or in-flight run shares ${keys.map((k) => k.label).join(" or ")}` }));
    return { summary: "No duplicates. Keys claimed for this run", output: { duplicate: false, checkedKeys: keys.map((k) => k.type) }, checks };
  });
}

async function stagePo(ctx: Ctx) {
  const inv = ctx.extraction!.invoice;
  return runStage(ctx, "PO_MATCHING", { poReference: inv.poReference, vendorId: ctx.vendorMatch?.vendor?.id ?? null, currency: inv.currency, subtotal: inv.subtotal }, async (log) => {
    const pos = await getPurchaseOrdersWithBalances(ctx.db);
    log(inv.poReference ? `Looking up explicit PO reference ${inv.poReference}` : "No PO reference on invoice. Searching the vendor's open POs");
    const { result, checks } = matchPurchaseOrder(inv, ctx.vendorMatch?.vendor?.id ?? null, pos, ctx.rules);
    ctx.poMatch = result;
    log(result.explanation);
    if (result.status === "MATCHED" && result.po) await updateRun(ctx.db, ctx.runId, { po_id: result.po.id });
    const po = result.po;
    return {
      summary: po ? `${result.status === "INFERRED" ? "Suggested" : result.status === "MATCHED" ? "Matched" : "Found"} ${po.po_number} · remaining ${money(po.remaining_balance, po.currency)}` : result.explanation,
      output: {
        status: result.status, method: result.method, confidence: result.confidence, explanation: result.explanation,
        po: po ? { id: po.id, poNumber: po.po_number, vendor: po.vendor_name, amount: po.total_amount, currency: po.currency, previouslyInvoiced: po.invoiced_amount, remainingBalance: po.remaining_balance, invoiceCount: po.invoice_count, status: po.status, items: po.items } : null,
        candidates: result.candidates,
      },
      checks,
    };
  });
}

async function stageReconciliation(ctx: Ctx) {
  const inv = ctx.extraction!.invoice;
  const po = ctx.poMatch!.po!;
  return runStage(ctx, "RECONCILIATION", { po: po.po_number, tolerancePercent: ctx.rules.tolerancePercent }, async (log) => {
    const { checks, summary } = reconcile(inv, po, ctx.rules);
    ctx.reconciliation = summary;
    log(`PO ${po.po_number}: total ${money(po.total_amount, po.currency)}, invoiced ${money(po.invoiced_amount, po.currency)}, remaining ${money(po.remaining_balance, po.currency)}`);
    if (summary.difference !== null) log(`Invoice subtotal vs remaining: difference ${money(summary.difference, po.currency)} (${summary.differencePct ?? "n/a"}%); tolerance ${money(summary.toleranceAmount, po.currency)}`);
    if (ctx.poMatch!.status === "INFERRED") log("Note: reconciled against an inferred PO for information. The PO still requires confirmation", "warn");
    const failed = checks.filter((c) => c.status === "FAIL").length;
    return {
      summary: failed ? `${failed} reconciliation check(s) failed` : `Reconciled within ${ctx.rules.tolerancePercent}% tolerance`,
      output: { ...summary, inferredPo: ctx.poMatch!.status === "INFERRED" },
      checks,
    };
  });
}

async function stageDecision(ctx: Ctx) {
  return runStage(ctx, "DECISION", { checks: ctx.checks.length, rulesVersion: ctx.rules.version }, async (log) => {
    const inv = ctx.extraction?.invoice;
    let decision = decide(ctx.checks, ctx.rules, { totalAmount: inv?.totalAmount ?? null, currency: inv?.currency ?? null });
    decision.ruleTrace.forEach((t) => log(t));
    const net = inv ? netAmount(inv) : null;
    const allocate = decision.status === "APPROVED" && ctx.poMatch?.po && net !== null;
    if (decision.status === "APPROVED" && !allocate) {
      // Defensive: never approve without a PO to allocate against.
      ctx.checks.push(fail({ code: "PO_ALLOCATION", stage: "DECISION", label: "PO allocation", severity: "CRITICAL", action: "REVIEW", message: "No purchase order available to allocate this invoice against" }));
      decision = decide(ctx.checks, ctx.rules, { totalAmount: inv?.totalAmount ?? null, currency: inv?.currency ?? null });
    }
    const payload = () => ({ ...decision, comparisons: ctx.reconciliation ?? null });
    let commit = await commitDecision(ctx.db, {
      runId: ctx.runId, status: decision.status, reasons: decision.reasons, decision: payload(),
      allocation: allocate ? { poId: ctx.poMatch!.po!.id, amount: net!, toleranceAmount: ctx.reconciliation?.toleranceAmount ?? 0 } : undefined,
    });
    if (!commit.committed) {
      log(`Approval blocked at commit: ${commit.reason}`, "warn");
      ctx.checks.push(fail({ code: "PO_BALANCE_AT_COMMIT", stage: "DECISION", label: "PO balance still available at commit", severity: "CRITICAL", action: "REVIEW", message: `${commit.reason}. Live remaining balance ${money(round2(commit.remainingBefore), inv?.currency)}`, expected: round2(commit.remainingBefore), actual: net }));
      decision = decide(ctx.checks, ctx.rules, { totalAmount: inv?.totalAmount ?? null, currency: inv?.currency ?? null });
      commit = await commitDecision(ctx.db, { runId: ctx.runId, status: decision.status, reasons: decision.reasons, decision: payload() });
    } else if (allocate) {
      log(`Allocated ${money(net!, inv!.currency)} to ${ctx.poMatch!.po!.po_number} under row lock`);
    }
    ctx.decision = decision;
    log(`Final decision: ${decision.status}`);
    return {
      summary: `${decision.status.replace("_", " ")}: ${decision.headline}`,
      outcome: decision.status === "APPROVED" ? "PASS" : decision.status === "NEEDS_REVIEW" ? "WARN" : "FAIL",
      output: {
        status: decision.status, headline: decision.headline, reasons: decision.reasons, ruleTrace: decision.ruleTrace,
        passed: decision.passedChecks.length, failed: decision.failedChecks.length, warnings: decision.warnings.length,
        allocation: decision.status === "APPROVED" && allocate ? { po: ctx.poMatch!.po!.po_number, amount: net } : null,
      },
    };
  });
}

async function stageReport(ctx: Ctx, startedAt: number) {
  return runStage(ctx, "REPORT", {}, async (log) => {
    const duration = Date.now() - startedAt;
    log(`Report assembled: ${ctx.checks.length} checks recorded; downloadable as PDF and JSON`);
    return {
      summary: `Report ready · ${ctx.checks.length} checks · ${(duration / 1000).toFixed(1)}s`,
      outcome: "PASS",
      output: { finalStatus: ctx.decision?.status, totalChecks: ctx.checks.length, durationMs: duration, reportJson: `/api/runs/${ctx.runId}/report?format=json`, reportPdf: `/api/runs/${ctx.runId}/report?format=pdf` },
    };
  });
}

// ---------------------------------------------------------------- orchestration

export async function executeRun(runId: string, data: Buffer, filename: string, opts: { paced?: boolean } = {}) {
  const db = await getDb();
  const ctx: Ctx = { db, runId, rules: await getRules(db), checks: [], runLog: [], aborted: false, data, pacingMs: opts.paced === false ? 0 : env.stageDelayMs };
  const startedAt = Date.now();
  await updateRun(db, runId, { run_status: "PROCESSING", started_at: new Date(startedAt), rules_snapshot: ctx.rules, error_message: null });

  const work = (async () => {
    await stageIngestion(ctx, filename);
    await stageExtraction(ctx);
    const readable = !ctx.checks.some((c) => c.code === "DOCUMENT_READABLE" && c.status === "FAIL");
    if (readable) await stageValidation(ctx);
    else await skipStage(ctx, "VALIDATION", "Document could not be read");
    if (readable) await stageVendor(ctx);
    else await skipStage(ctx, "VENDOR_VERIFICATION", "Document could not be read");
    await stageDuplicates(ctx);
    if (ctx.duplicate) {
      await skipStage(ctx, "PO_MATCHING", "Duplicate invoice: processing does not continue toward approval");
      await skipStage(ctx, "RECONCILIATION", "Duplicate invoice: processing does not continue toward approval");
    } else if (!readable) {
      await skipStage(ctx, "PO_MATCHING", "Document could not be read");
      await skipStage(ctx, "RECONCILIATION", "Document could not be read");
    } else {
      await stagePo(ctx);
      if (ctx.poMatch?.po && (ctx.poMatch.status === "MATCHED" || ctx.poMatch.status === "INFERRED")) await stageReconciliation(ctx);
      else await skipStage(ctx, "RECONCILIATION", ctx.poMatch?.status === "VENDOR_MISMATCH" ? "PO belongs to another vendor; amounts not reconciled" : "No purchase order matched; nothing to reconcile against");
    }
    await stageDecision(ctx);
    await stageReport(ctx, startedAt);
    // Finalise only after stage 9 is persisted, so the UI never sees a completed run with a running stage.
    await updateRun(db, runId, { run_status: "COMPLETED", completed_at: new Date(), duration: Date.now() - startedAt, current_stage: "REPORT" });
  })();

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`Processing exceeded the ${Math.round(env.runTimeoutMs / 1000)}s timeout`)), env.runTimeoutMs);
  });
  try {
    await Promise.race([work, timeout]);
  } catch (e) {
    ctx.aborted = true;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pipeline] run ${runId} failed:`, msg);
    try {
      await releaseClaims(db, runId);
      await db.query("DELETE FROM po_allocations WHERE run_id = $1", [runId]);
      await db.query(`UPDATE processing_stages SET stage_status = 'FAILED', error_message = coalesce(error_message, $2), completed_at = coalesce(completed_at, now())
                      WHERE run_id = $1 AND stage_status = 'RUNNING'`, [runId, msg]);
      await db.query(`UPDATE processing_stages SET stage_status = 'SKIPPED', summary = 'Not executed: run failed earlier'
                      WHERE run_id = $1 AND stage_status = 'PENDING'`, [runId]);
      await updateRun(db, runId, { run_status: "FAILED", final_status: null, error_message: msg, completed_at: new Date(), duration: Date.now() - startedAt });
    } catch (inner) {
      console.error("[pipeline] could not record failure", inner);
    }
  } finally {
    clearTimeout(timer);
    work.catch(() => undefined);
  }
}

/** Create a run record. Execution is scheduled by the caller (background in the API, awaited in tests/seed). */
export async function startRun(input: { filename: string; data: Buffer; isSample?: boolean }) {
  validateUpload(input.filename, input.data);
  const db = await getDb();
  const run = await createRun(db, { filename: input.filename, fileSize: input.data.length, isSample: input.isSample });
  return run;
}

/** Process synchronously (used by seed + tests). */
export async function processInvoice(input: { filename: string; data: Buffer; isSample?: boolean; paced?: boolean }) {
  const run = await startRun(input);
  await executeRun(run.id, input.data, input.filename, { paced: input.paced ?? false });
  const db = await getDb();
  return (await getRun(db, run.id))!;
}

/**
 * Retry a FAILED run using the stored original document. Safe: claims and PO allocations
 * are keyed by run ID, so a retry can never create duplicate financial records.
 */
export async function prepareRetry(runId: string) {
  const db = await getDb();
  const run = await getRun(db, runId);
  if (!run) throw new UploadValidationError("Run not found");
  if (run.run_status !== "FAILED") throw new UploadValidationError("Only failed runs can be retried");
  if (!run.file_path) throw new UploadValidationError("The original document was never stored. Please upload it again");
  const data = await withRetry(() => getStorage().get(run.file_path as string));
  await releaseClaims(db, runId);
  await db.query("DELETE FROM po_allocations WHERE run_id = $1", [runId]);
  await resetStages(db, runId);
  await updateRun(db, runId, {
    run_status: "QUEUED", final_status: null, decision: null, decision_reasons: [], error_message: null, completed_at: null,
    duration: null, duplicate_of_run_id: null, vendor_id: null, po_id: null, attempt: Number(run.attempt) + 1,
  });
  return { data, filename: run.filename as string };
}

/**
 * Re-run verification, matching and the decision for a completed run (e.g. after its vendor was
 * registered). History is never overwritten: a NEW run is created from the stored document and the
 * original is marked as superseded, in one transaction. The new run's decision is computed by the
 * same deterministic rules, so registering a vendor can never approve an invoice by itself.
 */
export async function prepareReprocess(runId: string, reason: string) {
  const db = await getDb();
  const run = await getRun(db, runId);
  if (!run) throw new UploadValidationError("Run not found");
  if (run.run_status !== "COMPLETED") throw new UploadValidationError("Only completed runs can be re-processed. Use Retry for failed runs");
  if (run.superseded_by_run_id) throw new UploadValidationError(`This run was already re-processed as run #${run.superseded_by_run_number}`);
  if (run.final_status === "APPROVED") throw new UploadValidationError("Approved invoices are not re-processed");
  if (run.duplicate_of_run_id) throw new UploadValidationError("Duplicate submissions can't be re-processed. Review the original run instead");
  if (!run.file_path) throw new UploadValidationError("The original document is not available for re-processing");
  const data = await withRetry(() => getStorage().get(run.file_path as string));
  const created = await db.transaction(async (tx) => {
    const next = await createRunTx(tx, { filename: run.filename as string, fileSize: data.length, isSample: !!run.is_sample, reprocessedFrom: runId });
    const { rows } = await tx.query("UPDATE processing_runs SET superseded_by_run_id = $2 WHERE id = $1 AND superseded_by_run_id IS NULL RETURNING id", [runId, next.id]);
    if (!rows.length) throw new UploadValidationError("This run is already being re-processed");
    // The superseding run takes over duplicate protection for this invoice.
    await tx.query("DELETE FROM invoice_claims WHERE run_id = $1", [runId]);
    await tx.query("UPDATE processing_runs SET file_path = $2, file_fingerprint = $3 WHERE id = $1", [next.id, run.file_path, run.file_fingerprint]);
    await recordEvent(tx, runId, "SUPERSEDED", `Re-processed as run #${next.runNumber}: ${reason}. This run's decision (${run.final_status}) is preserved for audit.`, { newRunId: next.id, reason, previousStatus: run.final_status });
    await recordEvent(tx, next.id, "REPROCESSED_FROM", `Re-processed from run #${run.run_number} (${run.final_status}): ${reason}`, { previousRunId: runId, previousStatus: run.final_status, reason });
    return next;
  });
  return { ...created, data, filename: run.filename as string };
}

export { STAGES };
