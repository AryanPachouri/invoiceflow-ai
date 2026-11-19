import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createDb, setDbForTesting } from "@/server/db";
import { executeRun, prepareRetry, processInvoice } from "@/server/pipeline";
import { createRun, failStaleRuns, getMetrics, getRun, listRuns } from "@/server/repositories/runs";
import { getStorage } from "@/server/storage";
import { saveRules } from "@/server/repositories/settings";
import { DEFAULT_RULES } from "@/server/seed/data";
import { freshDb, pdf, vendor } from "../helpers";

const sample = (f: string) => fs.readFileSync(path.join(process.cwd(), "public", "samples", f));
const stage = (run: Awaited<ReturnType<typeof getRun>>, key: string) => (run!.stages as Record<string, unknown>[]).find((s) => s.stage_key === key)! as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const checks = (run: Awaited<ReturnType<typeof getRun>>) => (run!.stages as Record<string, any>[]).flatMap((s) => s.output_data?.checks ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any
const run$ = (filename: string, data: Buffer) => processInvoice({ filename, data });
const allocations = async (db: Db, poNumber: string) =>
  (await db.query<{ amount: string }>("SELECT a.amount FROM po_allocations a JOIN purchase_orders p ON p.id = a.po_id WHERE p.po_number = $1", [poNumber])).rows.map((r) => Number(r.amount));

describe("end-to-end pipeline (real PDFs, real database)", () => {
  let db: Db;
  beforeAll(async () => { db = await freshDb(); });

  it("seeded history is real pipeline output and is flagged as sample data", async () => {
    const { rows } = await listRuns(db, {});
    expect(rows.length).toBe(4);
    expect(rows.every((r) => r.is_sample && r.final_status === "APPROVED")).toBe(true);
  });

  it("1. processes a clean invoice to APPROVED with all nine stages persisted", async () => {
    const before = await getMetrics(db, true);
    const run = await run$("01-apex-happy-path.pdf", sample("01-apex-happy-path.pdf"));
    expect(run.run_status).toBe("COMPLETED");
    expect(run.final_status).toBe("APPROVED");
    expect(run.invoice_number).toBe("INV-APX-2026-0412");
    expect(run.total_amount).toBe(12744);
    expect((run.stages as unknown[]).length).toBe(9);
    expect((run.stages as Record<string, unknown>[]).every((s) => s.stage_status === "COMPLETED" && s.started_at && s.completed_at)).toBe(true);
    expect(await allocations(db, "PO-2026-0141")).toEqual([9000, 11800]);
    // dashboard metrics update from persisted records
    const after = await getMetrics(db, true);
    expect(after.processed).toBe(before.processed + 1);
    expect(after.approved).toBe(before.approved + 1);
    expect(after.valueByCurrency.find((c) => c.currency === "USD")!.total).toBeCloseTo(before.valueByCurrency.find((c) => c.currency === "USD")!.total + 12744);
  });

  it("2. EDGE CASE 1: rejects a duplicate and identifies the original run", async () => {
    const run = await run$("03-apex-duplicate.pdf", sample("03-apex-duplicate.pdf"));
    expect(run.final_status).toBe("REJECTED");
    expect(stage(run, "DUPLICATE_DETECTION").stage_status).toBe("FAILED");
    const original = stage(run, "DUPLICATE_DETECTION").output_data.originalRun;
    expect(original.invoice_number).toBe("INV-APX-2026-0398");
    expect(run.duplicate_of_run_id).toBe(original.id);
    expect(stage(run, "PO_MATCHING").stage_status).toBe("SKIPPED");
    expect(stage(run, "RECONCILIATION").stage_status).toBe("SKIPPED");
    expect(await allocations(db, "PO-2026-0141")).toEqual([9000, 11800]); // no allocation from the duplicate
  });

  it("also rejects the exact same file uploaded twice (fingerprint)", async () => {
    const run = await run$("01-apex-happy-path (copy).pdf", sample("01-apex-happy-path.pdf"));
    expect(run.final_status).toBe("REJECTED");
    expect(stage(run, "DUPLICATE_DETECTION").output_data.matchedOn).toContain("FINGERPRINT");
  });

  it("3. EDGE CASE 2: amount over PO balance → NEEDS_REVIEW with exact difference", async () => {
    const run = await run$("04-summit-amount-mismatch.pdf", sample("04-summit-amount-mismatch.pdf"));
    expect(run.final_status).toBe("NEEDS_REVIEW");
    const rec = stage(run, "RECONCILIATION");
    expect(rec.stage_status).toBe("FAILED");
    expect(rec.output_data.remainingBefore).toBe(4500);
    expect(rec.output_data.difference).toBe(1250);
    expect(rec.output_data.differencePct).toBe(27.78);
  });

  it("4. EDGE CASE 3: missing PO → candidate search, ambiguity explained, NEEDS_REVIEW", async () => {
    const run = await run$("05-brightline-missing-po.pdf", sample("05-brightline-missing-po.pdf"));
    expect(run.final_status).toBe("NEEDS_REVIEW");
    const po = stage(run, "PO_MATCHING").output_data;
    expect(po.status).toBe("AMBIGUOUS");
    expect(po.po).toBeNull();
    expect(po.candidates.map((c: { po_number: string }) => c.po_number).sort()).toEqual(["PO-2026-0157", "PO-2026-0166"]);
    expect(run.po_id).toBeNull();
  });

  it("5. EDGE CASE 4: missing invoice number and date → warnings recorded, NEEDS_REVIEW", async () => {
    const run = await run$("06-orion-missing-fields.pdf", sample("06-orion-missing-fields.pdf"));
    expect(run.final_status).toBe("NEEDS_REVIEW");
    expect(run.invoice_number).toBeNull();
    const warnings = stage(run, "EXTRACTION").output_data.warnings.filter((w: { severity: string }) => w.severity === "CRITICAL").map((w: { field: string }) => w.field);
    expect(warnings).toEqual(expect.arrayContaining(["invoiceNumber", "invoiceDate"]));
    expect(checks(run).find((c) => c.code === "REQUIRED_INVOICENUMBER").status).toBe("FAIL");
  });

  it("6. invalid (unknown) vendor never auto-approves; inactive vendor is rejected", async () => {
    const unknown = await run$("globex.pdf", await pdf({
      layout: "classic", vendor: { name: "Globex Trading Corporation", address: "1 Fake Street, Springfield, USA", taxId: "55-5555555" },
      invoiceNumber: "GX-001", invoiceDate: "2026-11-10", poNumber: "PO-2026-0141", currency: "USD", taxRate: 0,
      items: [{ description: "Safety Helmet, Class E", quantity: 1, unitPrice: 45 }],
    }));
    expect(unknown.final_status).toBe("NEEDS_REVIEW");
    expect(checks(unknown).find((c) => c.code === "VENDOR_EXISTS").status).toBe("FAIL");
    const inactive = await run$("07-meridian-inactive-vendor.pdf", sample("07-meridian-inactive-vendor.pdf"));
    expect(inactive.final_status).toBe("REJECTED");
  });

  it("7. incorrect tax calculation → NEEDS_REVIEW", async () => {
    const run = await run$("08-brightline-tax-error.pdf", sample("08-brightline-tax-error.pdf"));
    expect(run.final_status).toBe("NEEDS_REVIEW");
    const tax = checks(run).find((c) => c.code === "TAX_CALC");
    expect(tax).toMatchObject({ status: "FAIL", expected: 240, actual: 300, difference: 60 });
  });

  it("8. scanned PDF is extracted with OCR and approved", async () => {
    const run = await run$("02-nordic-scanned-ocr.pdf", sample("02-nordic-scanned-ocr.pdf"));
    expect(run.extraction_method).toBe("OCR");
    expect(run.invoice_number).toBe("NFL-26-07781");
    expect(run.total_amount).toBe(8806);
    expect(run.final_status).toBe("APPROVED");
  });

  it("9. multiple invoices against one PO cannot collectively exceed it", async () => {
    // PO-2026-0166: 9,600 support retainer, nothing invoiced yet
    const inv = (n: number) => pdf({
      layout: "classic", vendor: vendor("V-1002"), invoiceNumber: `BCS-SUP-${n}`, invoiceDate: "2026-11-10", poNumber: "PO-2026-0166", currency: "USD",
      items: [{ description: "Premium Support Retainer - Monthly", quantity: 5, unitPrice: 800 }],
    });
    const a = await run$("sup-1.pdf", await inv(1));
    const b = await run$("sup-2.pdf", await inv(2));
    const c = await run$("sup-3.pdf", await inv(3));
    // 4,000 + 4,000 fit within 9,600; the third (4,000 > remaining 1,600) must not be approved
    expect([a.final_status, b.final_status]).toEqual(["APPROVED", "APPROVED"]);
    expect(c.final_status).toBe("NEEDS_REVIEW");
    expect(stage(c, "RECONCILIATION").output_data.remainingBefore).toBe(1600);
    expect(await allocations(db, "PO-2026-0166")).toEqual([4000, 4000]);
  });

  it("10. concurrent duplicate submissions: exactly one can proceed", async () => {
    const data = await pdf({
      layout: "compact", vendor: vendor("V-1005"), invoiceNumber: "SFM-RACE-1", invoiceDate: "2026-11-12", poNumber: "PO-2026-0172", currency: "USD", taxRate: 0,
      items: [{ description: "Monthly Janitorial Service", quantity: 1, unitPrice: 1500 }],
    });
    const runs = await Promise.all([run$("race-a.pdf", data), run$("race-b.pdf", data), run$("race-c.pdf", data)]);
    const statuses = runs.map((r) => r.final_status).sort();
    expect(statuses.filter((s) => s === "REJECTED")).toHaveLength(2);
    expect(statuses.filter((s) => s !== "REJECTED")).toHaveLength(1);
  });

  it("concurrent approvals against one PO never over-allocate", async () => {
    // PO-2026-0188 (GBP 12,000) — two different invoices of 7,200 each submitted at once
    const inv = (n: number) => pdf({
      layout: "modern", vendor: vendor("V-1006"), invoiceNumber: `ODS-${n}`, invoiceDate: "2026-11-11", poNumber: "PO-2026-0188", currency: "GBP", taxRate: 20,
      items: [{ description: "Analytics Platform Licence - Annual", quantity: 3, unitPrice: 2400 }],
    });
    const [x, y] = await Promise.all([run$("ods-1.pdf", await inv(1)), run$("ods-2.pdf", await inv(2))]);
    expect([x.final_status, y.final_status].sort()).toEqual(["APPROVED", "NEEDS_REVIEW"]);
    const total = (await allocations(db, "PO-2026-0188")).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(12000);
  });

  it("records an unreadable document instead of discarding it", async () => {
    const run = await run$("broken.pdf", Buffer.from("%PDF-1.4\nthis is not really a pdf"));
    expect(run.run_status).toBe("COMPLETED");
    expect(run.final_status).toBe("NEEDS_REVIEW");
    expect(stage(run, "EXTRACTION").stage_status).toBe("FAILED");
    expect(checks(run).find((c) => c.code === "DOCUMENT_READABLE").status).toBe("FAIL");
  });

  it("rejects non-PDF uploads before creating a run", async () => {
    await expect(processInvoice({ filename: "invoice.pdf", data: Buffer.from("hello") })).rejects.toThrow(/not a valid PDF/);
    await expect(processInvoice({ filename: "invoice.png", data: Buffer.from("%PDF-1.4") })).rejects.toThrow(/Only PDF/);
  });

  it("retrying a failed run is safe and creates no duplicate financial records", async () => {
    const data = await pdf({
      layout: "classic", vendor: vendor("V-1002"), invoiceNumber: "BCS-RETRY-1", invoiceDate: "2026-11-12", poNumber: "PO-2026-0157", currency: "USD",
      items: [{ description: "Managed Cloud Hosting - Monthly", quantity: 1, unitPrice: 3000 }],
    });
    // Simulate a run that was interrupted (server restart) after its document was stored.
    const run = await createRun(db, { filename: "retry.pdf", fileSize: data.length });
    const key = `runs/${run.id}/retry.pdf`;
    await getStorage().put(key, data, "application/pdf");
    await db.query("UPDATE processing_runs SET run_status = 'PROCESSING', file_path = $2, heartbeat_at = now() - interval '1 hour' WHERE id = $1", [run.id, key]);
    expect(await failStaleRuns(db)).toBeGreaterThanOrEqual(1);
    expect((await getRun(db, run.id))!.run_status).toBe("FAILED");

    const r1 = await prepareRetry(run.id);
    await executeRun(run.id, r1.data, r1.filename, { paced: false });
    const done = (await getRun(db, run.id))!;
    expect(done.final_status).toBe("APPROVED");
    expect(done.attempt).toBe(2);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM po_allocations WHERE run_id = $1", [run.id]);
    expect(Number(rows[0].n)).toBe(1);
    await expect(prepareRetry(run.id)).rejects.toThrow(/Only failed runs/);
  });

  it("uses validated, configurable business rules", async () => {
    const bad = await saveRules(db, { ...DEFAULT_RULES, tolerancePercent: -1, duplicateDetection: { byVendorAndInvoiceNumber: false, byFingerprint: false, action: "REJECT" } });
    expect(bad.ok).toBe(false);
    expect(await saveRules(db, { ...DEFAULT_RULES, tolerancePercent: 30 })).toMatchObject({ ok: false }); // capped at 20%
    const good = await saveRules(db, { ...DEFAULT_RULES, tolerancePercent: 10 });
    expect(good).toMatchObject({ ok: true });
    // New runs snapshot the active configuration
    const data = await pdf({
      layout: "compact", vendor: vendor("V-1005"), invoiceNumber: "SFM-TOL-1", invoiceDate: "2026-11-12", poNumber: "PO-2026-0172", currency: "USD", taxRate: 0,
      items: [{ description: "Monthly Janitorial Service", quantity: 1, unitPrice: 1500 }],
    });
    const run = await run$("tol.pdf", data);
    expect(run.rules_snapshot.tolerancePercent).toBe(10);
    await saveRules(db, DEFAULT_RULES);
  });
});

describe("persistence across restarts", () => {
  it("historical runs remain accessible after the process restarts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "invoiceflow-persist-"));
    const db1 = await createDb({ pgliteDir: dir });
    setDbForTesting(db1);
    const { seedMasterData } = await import("@/server/seed");
    await seedMasterData(db1);
    const run = await processInvoice({ filename: "01.pdf", data: sample("01-apex-happy-path.pdf") });
    await db1.close();

    const db2 = await createDb({ pgliteDir: dir }); // simulates a fresh server process / page refresh
    setDbForTesting(db2);
    const again = await getRun(db2, run.id as string);
    expect(again?.final_status).toBe("APPROVED");
    expect((again!.stages as unknown[]).length).toBe(9);
    await db2.close();
  });
});
