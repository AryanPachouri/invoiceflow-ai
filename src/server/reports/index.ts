import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { getRun } from "../repositories/runs";

type RunDetail = NonNullable<Awaited<ReturnType<typeof getRun>>>;
type Stage = { stage_order: number; stage_key: string; stage_name: string; stage_status: string; outcome: string | null; summary: string | null; output_data: Record<string, unknown> | null; error_message: string | null; started_at: unknown; completed_at: unknown; duration: number | null };

export function buildReport(run: RunDetail) {
  const stages = run.stages as unknown as Stage[];
  const out = (k: string) => (stages.find((s) => s.stage_key === k)?.output_data ?? null) as Record<string, unknown> | null;
  const decision = (run.decision ?? null) as Record<string, unknown> | null;
  const allChecks = stages.flatMap((s) => ((s.output_data?.checks as unknown[]) ?? []));
  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id, runNumber: run.run_number, status: run.run_status, attempt: run.attempt, isSampleData: run.is_sample,
      startedAt: run.started_at, completedAt: run.completed_at, durationMs: run.duration, error: run.error_message,
    },
    document: { filename: run.filename, sizeBytes: run.file_size, fingerprintSha256: run.file_fingerprint, storagePath: run.file_path, downloadUrl: `/api/runs/${run.id}/document` },
    finalDecision: {
      status: run.final_status, headline: decision?.headline ?? null, reasons: run.decision_reasons,
      ruleTrace: decision?.ruleTrace ?? [], passedChecks: (decision?.passedChecks as unknown[] | undefined)?.length ?? 0,
      failedChecks: decision?.failedChecks ?? [], warnings: decision?.warnings ?? [],
    },
    extraction: out("EXTRACTION"),
    validation: { checks: allChecks.filter((c) => (c as { stage: string }).stage === "VALIDATION") },
    vendorVerification: out("VENDOR_VERIFICATION"),
    duplicateDetection: out("DUPLICATE_DETECTION"),
    purchaseOrder: out("PO_MATCHING"),
    reconciliation: out("RECONCILIATION"),
    stages: stages.map((s) => ({ order: s.stage_order, key: s.stage_key, name: s.stage_name, status: s.stage_status, outcome: s.outcome, summary: s.summary, error: s.error_message, startedAt: s.started_at, completedAt: s.completed_at, durationMs: s.duration })),
    allChecks,
    rulesSnapshot: run.rules_snapshot,
  };
}

const NAVY = rgb(0.06, 0.12, 0.25);
const GREY = rgb(0.42, 0.45, 0.52);
const STATUS_COLOR: Record<string, ReturnType<typeof rgb>> = {
  APPROVED: rgb(0.09, 0.55, 0.3), NEEDS_REVIEW: rgb(0.8, 0.5, 0.02), REJECTED: rgb(0.8, 0.15, 0.15),
};

// WinAnsi-safe text for the standard fonts
const safe = (s: unknown) => String(s ?? "—").replace(/[≤]/g, "<=").replace(/[≥]/g, ">=").replace(/[≠]/g, "!=").replace(/[×]/g, "x").replace(/[→]/g, "->").replace(/[−–—]/g, "-").replace(/[…]/g, "...").replace(/[^\x20-\x7E -ÿ€•]/g, "");

export async function renderReportPdf(run: RunDetail): Promise<Uint8Array> {
  const r = buildReport(run);
  const doc = await PDFDocument.create();
  doc.setTitle(`InvoiceFlow report: run #${r.run.runNumber}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([612, 792]);
  let y = 750;
  const ensure = (h: number) => { if (y - h < 50) { page = doc.addPage([612, 792]); y = 750; } };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const words = safe(text).split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const text = (s: string, o: { x?: number; size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; width?: number } = {}) => {
    const size = o.size ?? 9.5, f = o.f ?? font, x = o.x ?? 50;
    for (const line of wrap(s, f, size, o.width ?? 512 - (x - 50))) {
      ensure(size + 4);
      page.drawText(line, { x, y, size, font: f, color: o.color ?? rgb(0.1, 0.1, 0.15) });
      y -= size + 4;
    }
  };
  const heading = (s: string) => { y -= 8; ensure(30); page.drawText(safe(s), { x: 50, y, size: 12, font: bold, color: NAVY }); y -= 6; page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.6, color: rgb(0.85, 0.87, 0.9) }); y -= 14; };
  const kv = (k: string, v: unknown) => { ensure(14); page.drawText(safe(k), { x: 50, y, size: 9, font: bold, color: GREY }); const lines = wrap(String(v ?? "—"), font, 9.5, 380); lines.forEach((l, i) => { if (i) { y -= 13; ensure(13); } page.drawText(l, { x: 180, y, size: 9.5, font }); }); y -= 14; };

  page.drawText("InvoiceFlow AI", { x: 50, y, size: 18, font: bold, color: NAVY });
  page.drawText("Invoice Processing Report", { x: 50, y: y - 18, size: 10, font, color: GREY });
  const st = r.finalDecision.status ?? (r.run.status === "FAILED" ? "FAILED" : "PROCESSING");
  const w = bold.widthOfTextAtSize(st.replace("_", " "), 12) + 20;
  page.drawRectangle({ x: 562 - w, y: y - 8, width: w, height: 24, color: STATUS_COLOR[st] ?? GREY });
  page.drawText(st.replace("_", " "), { x: 572 - w, y: y, size: 12, font: bold, color: rgb(1, 1, 1) });
  y -= 44;
  if (r.run.isSampleData) text("Sample data: seeded demonstration history processed through the real pipeline.", { size: 8.5, color: GREY });
  if (r.finalDecision.headline) text(String(r.finalDecision.headline), { f: bold, size: 10.5 });

  heading("Run");
  kv("Run", `#${r.run.runNumber} (${r.run.id})`);
  kv("Document", `${r.document.filename} · ${((r.document.sizeBytes ?? 0) / 1024).toFixed(1)} KB`);
  kv("Fingerprint", r.document.fingerprintSha256);
  kv("Started", r.run.startedAt ? new Date(String(r.run.startedAt)).toISOString() : "—");
  kv("Duration", r.run.durationMs !== null ? `${((r.run.durationMs as number) / 1000).toFixed(2)} s` : "—");
  if (r.run.error) kv("Error", r.run.error);

  const ex = r.extraction as Record<string, unknown> | null;
  const inv = (ex?.invoice ?? null) as Record<string, unknown> | null;
  if (inv) {
    heading("Extracted Information");
    kv("Method / confidence", `${ex?.method} · ${ex?.confidence}%`);
    kv("Vendor", `${inv.vendorName ?? "—"}${inv.vendorTaxId ? ` (Tax ID ${inv.vendorTaxId})` : ""}`);
    kv("Vendor address", inv.vendorAddress);
    kv("Invoice number", inv.invoiceNumber);
    kv("Invoice / due date", `${inv.invoiceDate ?? "—"} / ${inv.dueDate ?? "—"}`);
    kv("PO reference", inv.poReference);
    kv("Currency", inv.currency);
    kv("Subtotal / discount / tax / total", `${inv.subtotal ?? "—"} / ${inv.discountAmount ?? "—"} / ${inv.taxAmount ?? "—"}${inv.taxRate !== null ? ` (${inv.taxRate}%)` : ""} / ${inv.totalAmount ?? "—"}`);
    for (const li of (inv.lineItems as Record<string, unknown>[]) ?? []) text(`• ${li.description}: ${li.quantity} x ${li.unitPrice} = ${li.amount}`, { x: 60, size: 9 });
  }

  heading("Decision Reasons");
  for (const reason of (r.finalDecision.reasons as string[]) ?? []) text(`• ${reason}`, { x: 55 });
  for (const t of r.finalDecision.ruleTrace as string[]) text(t, { x: 55, size: 8.5, color: GREY });

  const po = r.purchaseOrder as Record<string, unknown> | null;
  if (po && !po.skipped) {
    heading("Purchase Order Matching");
    kv("Result", `${po.status} · ${po.explanation}`);
    const p = po.po as Record<string, unknown> | null;
    if (p) kv("PO", `${p.poNumber} · ${p.vendor} · ${p.currency} ${p.amount} · invoiced ${p.previouslyInvoiced} · remaining ${p.remainingBalance}`);
    for (const c of (po.candidates as Record<string, unknown>[]) ?? []) text(`Candidate ${c.po_number}: score ${c.score} (${(c.reasons as string[]).join(", ")})`, { x: 55, size: 8.5 });
  }
  const rec = r.reconciliation as Record<string, unknown> | null;
  if (rec && !rec.skipped) {
    heading("Financial Reconciliation");
    kv("Remaining before", `${rec.currency} ${rec.remainingBefore}`);
    kv("Invoice subtotal", `${rec.currency} ${rec.invoiceSubtotal}`);
    kv("Difference", `${rec.difference ?? "—"} (${rec.differencePct ?? "—"}%) · tolerance ${rec.tolerancePercent}% = ${rec.toleranceAmount}`);
    kv("Remaining after", rec.remainingAfter);
  }

  heading("All Checks");
  for (const c of r.allChecks as Record<string, unknown>[]) {
    const color = c.status === "PASS" ? STATUS_COLOR.APPROVED : c.status === "FAIL" ? STATUS_COLOR.REJECTED : c.status === "WARN" ? STATUS_COLOR.NEEDS_REVIEW : GREY;
    ensure(14);
    page.drawText(safe(c.status), { x: 50, y, size: 8.5, font: bold, color });
    const save = y;
    text(`${c.label}: ${c.message}`, { x: 90, size: 8.5 });
    if (y === save) y -= 12;
  }

  heading("Stage Timeline");
  for (const s of r.stages) text(`${s.order}. ${s.name}: ${s.status}${s.durationMs !== null ? ` (${s.durationMs} ms)` : ""}. ${s.summary ?? ""}`, { size: 8.5 });

  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(safe(`Run ${r.run.id} · generated ${r.generatedAt} · page ${i + 1}/${pages.length}`), { x: 50, y: 25, size: 7, font, color: GREY }));
  return doc.save();
}
