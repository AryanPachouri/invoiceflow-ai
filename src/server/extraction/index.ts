import { env } from "../env";
import { extractPdfText, PdfParseError } from "./pdf-text";
import { ocrPdf, OcrError } from "./ocr";
import { missingFieldWarnings, overallConfidence, parseInvoiceText } from "./parser";
import { aiAvailable, extractWithClaude, isGrounded } from "./ai";
import type { ExtractionResult, FieldKey, FieldWarning } from "./types";

export { PdfParseError, OcrError };

/** Minimum characters in the text layer before we trust it instead of running OCR. */
const MIN_TEXT_CHARS = 60;

export interface ExtractOptions {
  log?: (msg: string) => void;
  forceOcr?: boolean;
  aiMode?: "auto" | "off" | "always";
}

/**
 * Stage 2 implementation:
 *   1. pdf.js text layer  →  2. OCR fallback (scanned PDFs)  →  3. deterministic parser
 *   →  4. optional Claude pass for low-confidence results (grounded, schema-validated).
 */
export async function extractInvoice(data: Uint8Array, opts: ExtractOptions = {}): Promise<ExtractionResult> {
  const log = opts.log ?? (() => undefined);
  const warnings: FieldWarning[] = [];

  const textLayer = await extractPdfText(data);
  const chars = textLayer.pages.reduce((a, p) => a + p.charCount, 0);
  log(`PDF parsed: ${textLayer.pageCount} page(s), ${chars} characters in text layer`);

  let lines = textLayer.pages.flatMap((p) => p.lines);
  let method: ExtractionResult["method"] = "PDF_TEXT";
  let ocrConfidence: number | undefined;
  let rawText = textLayer.text;

  if (chars < MIN_TEXT_CHARS || opts.forceOcr) {
    log(chars < MIN_TEXT_CHARS ? "Text layer insufficient — document appears to be scanned. Running OCR…" : "Forced OCR");
    const ocr = await ocrPdf(data, env.ocrTimeoutMs);
    log(`OCR complete: ${ocr.lines.length} lines, mean confidence ${ocr.confidence}%`);
    lines = ocr.lines;
    rawText = ocr.text;
    method = "OCR";
    ocrConfidence = ocr.confidence;
    if (ocr.confidence < 75) warnings.push({ field: "document", severity: "WARNING", message: `Low OCR quality (${ocr.confidence}% confidence). Values may contain recognition errors` });
    else warnings.push({ field: "document", severity: "INFO", message: `Extracted via OCR (${ocr.confidence}% confidence)` });
  }

  const parsed = parseInvoiceText(lines, { ocrConfidence });
  parsed.notes.forEach((n) => log(n));
  let invoice = parsed.invoice;
  const fieldConfidence = parsed.fieldConfidence;
  let confidence = overallConfidence(invoice, fieldConfidence);
  log(`Deterministic parser confidence: ${confidence}%`);

  let ai: ExtractionResult["ai"] = { used: false, status: aiAvailable() ? "not needed" : "disabled (no ANTHROPIC_API_KEY) — deterministic parser only" };
  const mode = opts.aiMode ?? "auto";
  const criticalMissing = missingFieldWarnings(invoice).some((w) => w.severity === "CRITICAL");
  if (aiAvailable() && mode !== "off" && (mode === "always" || confidence < 85 || criticalMissing)) {
    log("Requesting Claude structured extraction for low-confidence fields…");
    try {
      const res = await extractWithClaude(rawText);
      const accepted: string[] = [];
      const rejected: string[] = [];
      const merged = { ...invoice };
      const fields = Object.keys(res.invoice).filter((k) => k !== "lineItems") as FieldKey[];
      for (const f of fields) {
        const aiVal = res.invoice[f];
        const cur = merged[f];
        if (aiVal === null || (cur !== null && (fieldConfidence[f] ?? 0) >= 0.8)) continue;
        if (!isGrounded(aiVal as string | number, rawText)) { rejected.push(f); continue; }
        if (cur !== null && cur === aiVal) continue;
        (merged as Record<string, unknown>)[f] = aiVal;
        fieldConfidence[f] = 0.75;
        accepted.push(f);
      }
      if (!merged.lineItems.length && res.invoice.lineItems.length) {
        const grounded = res.invoice.lineItems.filter((li) => isGrounded(li.amount, rawText));
        if (grounded.length) { merged.lineItems = grounded; fieldConfidence.lineItems = 0.7; accepted.push("lineItems"); }
      }
      invoice = merged;
      method = method === "OCR" ? "OCR+AI" : "PDF_TEXT+AI";
      ai = { used: true, model: res.model, status: "completed", acceptedFields: accepted, rejectedFields: rejected };
      log(`Claude proposed values; accepted ${accepted.length} grounded field(s), rejected ${rejected.length} ungrounded`);
      confidence = overallConfidence(invoice, fieldConfidence);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ai = { used: false, status: `failed: ${msg}` };
      warnings.push({ field: "document", severity: "INFO", message: `AI-assisted extraction unavailable (${msg}); deterministic result used` });
      log(`Claude extraction failed (${msg}). Continuing with deterministic result`);
    }
  }

  const finalWarnings = [...warnings, ...parsed.warnings, ...missingFieldWarnings(invoice)];

  return {
    invoice, method, confidence, fieldConfidence, warnings: finalWarnings, rawText,
    pageCount: textLayer.pageCount, ocrConfidence, ai,
  };
}
