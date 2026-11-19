import { netAmount, type ExtractedInvoice } from "../extraction/types";
import type { BusinessRules } from "../seed/data";
import { fail, money, pass, round2, similarity, warn, skip, type Check } from "./types";

export interface PoItem { description: string; quantity: number; unit_price: number; total_amount: number }
export interface PoRecord {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  total_amount: number;
  currency: string;
  status: string;
  invoiced_amount: number;
  remaining_balance: number;
  invoice_count: number;
  items: PoItem[];
}

export type PoMatchStatus = "MATCHED" | "INFERRED" | "AMBIGUOUS" | "NOT_FOUND" | "NO_CANDIDATES" | "VENDOR_MISMATCH" | "SKIPPED";

export interface PoMatchResult {
  status: PoMatchStatus;
  po: PoRecord | null;
  confidence: number; // 0..100
  method: "EXPLICIT_REFERENCE" | "CANDIDATE_SEARCH" | null;
  candidates: { po_number: string; remaining_balance: number; currency: string; score: number; reasons: string[] }[];
  explanation: string;
}

const S = "PO_MATCHING";
const normPo = (s: string) => s.replace(/[^A-Z0-9]/gi, "").toUpperCase();

function lineSimilarity(inv: ExtractedInvoice, po: PoRecord) {
  if (!inv.lineItems.length || !po.items.length) return 0;
  const best = inv.lineItems.map((l) => Math.max(...po.items.map((i) => similarity(l.description, i.description))));
  return best.reduce((a, b) => a + b, 0) / best.length;
}

/**
 * Stage 6 — purchase order matching.
 * Explicit PO reference first; otherwise candidate search by vendor + currency + amount fit.
 * An ambiguous candidate is never auto-selected.
 */
export function matchPurchaseOrder(
  inv: ExtractedInvoice,
  vendorId: string | null,
  allPos: PoRecord[],
  rules: BusinessRules,
): { result: PoMatchResult; checks: Check[] } {
  const checks: Check[] = [];
  const subtotal = netAmount(inv) ?? inv.totalAmount;

  if (inv.poReference) {
    const po = allPos.find((p) => normPo(p.po_number) === normPo(inv.poReference!));
    if (po) {
      if (vendorId && po.vendor_id !== vendorId) {
        checks.push(pass({ code: "PO_EXISTS", stage: S, label: "Referenced PO exists", severity: "CRITICAL", message: `${po.po_number} found` }));
        checks.push(fail({ code: "PO_VENDOR_MATCH", stage: S, label: "PO belongs to invoicing vendor", severity: "CRITICAL", action: rules.hardFailures.poVendorMismatch, message: `${po.po_number} was issued to ${po.vendor_name}, not to this vendor. The invoice cannot be billed against another vendor's PO`, expected: po.vendor_name }));
        return { result: { status: "VENDOR_MISMATCH", po, confidence: 0, method: "EXPLICIT_REFERENCE", candidates: [], explanation: `PO ${po.po_number} belongs to a different vendor (${po.vendor_name}).` }, checks };
      }
      checks.push(pass({ code: "PO_EXISTS", stage: S, label: "Referenced PO exists", severity: "CRITICAL", message: `${po.po_number} found in purchase order register` }));
      checks.push(vendorId
        ? pass({ code: "PO_VENDOR_MATCH", stage: S, label: "PO belongs to invoicing vendor", severity: "CRITICAL", message: `${po.po_number} issued to ${po.vendor_name}` })
        : warn({ code: "PO_VENDOR_MATCH", stage: S, label: "PO belongs to invoicing vendor", severity: "CRITICAL", action: "REVIEW", message: `Vendor unverified, so PO ownership cannot be confirmed (PO issued to ${po.vendor_name})` }));
      checks.push(po.status === "OPEN"
        ? pass({ code: "PO_OPEN", stage: S, label: "PO is open", severity: "MAJOR", message: `${po.po_number} status OPEN` })
        : fail({ code: "PO_OPEN", stage: S, label: "PO is open", severity: "MAJOR", action: "REVIEW", message: `${po.po_number} is ${po.status}` }));
      return { result: { status: "MATCHED", po, confidence: vendorId ? 100 : 60, method: "EXPLICIT_REFERENCE", candidates: [], explanation: `Matched on explicit PO reference ${po.po_number}.` }, checks };
    }
    checks.push(fail({ code: "PO_EXISTS", stage: S, label: "Referenced PO exists", severity: "CRITICAL", action: "REVIEW", message: `PO "${inv.poReference}" referenced on the invoice does not exist in the PO register` }));
  } else {
    checks.push(warn({ code: "PO_REFERENCE_PRESENT", stage: S, label: "PO reference on invoice", severity: "MAJOR", action: rules.autoApproval.requireExplicitPo ? "REVIEW" : "NONE", message: "Invoice has no PO reference. Attempting candidate matching" }));
  }

  // Candidate search
  if (!vendorId) {
    checks.push(skip({ code: "PO_CANDIDATES", stage: S, label: "Candidate PO search", message: "Skipped. Vendor unknown, so the vendor's POs can't be searched" }));
    return { result: { status: inv.poReference ? "NOT_FOUND" : "NO_CANDIDATES", po: null, confidence: 0, method: "CANDIDATE_SEARCH", candidates: [], explanation: "No PO could be matched because the vendor is not verified." }, checks };
  }
  const tol = rules.tolerancePercent / 100;
  const candidates = allPos
    .filter((p) => p.vendor_id === vendorId && p.status === "OPEN")
    .map((p) => {
      const reasons: string[] = ["same vendor", "open"];
      let score = 0.3;
      if (inv.currency && p.currency === inv.currency) { score += 0.2; reasons.push("currency matches"); }
      else reasons.push(`currency ${p.currency} ≠ ${inv.currency ?? "?"}`);
      if (subtotal !== null && subtotal <= p.remaining_balance * (1 + tol)) { score += 0.2; reasons.push(`fits remaining ${money(p.remaining_balance, p.currency)}`); }
      else reasons.push(`exceeds remaining ${money(p.remaining_balance, p.currency)}`);
      const ls = lineSimilarity(inv, p);
      score += ls * 0.3;
      if (ls > 0) reasons.push(`line items ${Math.round(ls * 100)}% similar`);
      return { po: p, score: round2(score), reasons, fits: (!inv.currency || p.currency === inv.currency) && subtotal !== null && subtotal <= p.remaining_balance * (1 + tol) };
    })
    .sort((a, b) => b.score - a.score);
  const viable = candidates.filter((c) => c.fits);
  const summary = candidates.map((c) => ({ po_number: c.po.po_number, remaining_balance: c.po.remaining_balance, currency: c.po.currency, score: c.score, reasons: c.reasons }));

  if (!viable.length) {
    checks.push(fail({ code: "PO_CANDIDATES", stage: S, label: "Candidate PO search", severity: "MAJOR", action: "REVIEW", message: candidates.length ? `Vendor has ${candidates.length} open PO(s) but none fit this invoice's currency and amount` : "Vendor has no open purchase orders" }));
    return { result: { status: inv.poReference ? "NOT_FOUND" : "NO_CANDIDATES", po: null, confidence: 0, method: "CANDIDATE_SEARCH", candidates: summary, explanation: "No suitable purchase order could be identified. Procurement must confirm which PO this invoice relates to." }, checks };
  }
  if (viable.length > 1) {
    checks.push(fail({ code: "PO_CANDIDATES", stage: S, label: "Candidate PO search", severity: "MAJOR", action: "REVIEW", message: `${viable.length} open POs could match (${viable.map((c) => c.po.po_number).join(", ")}). Ambiguous, so none was auto-selected` }));
    return { result: { status: "AMBIGUOUS", po: null, confidence: 0, method: "CANDIDATE_SEARCH", candidates: summary, explanation: `Ambiguous: ${viable.length} candidate POs fit this invoice. A human must choose the correct PO.` }, checks };
  }
  const only = viable[0];
  checks.push(warn({ code: "PO_CANDIDATES", stage: S, label: "Candidate PO search", severity: "MAJOR", action: rules.autoApproval.requireExplicitPo ? "REVIEW" : "NONE", message: `Single candidate ${only.po.po_number} inferred (score ${only.score}). Inferred POs require confirmation` }));
  return { result: { status: "INFERRED", po: only.po, confidence: Math.round(only.score * 100), method: "CANDIDATE_SEARCH", candidates: summary, explanation: `Inferred ${only.po.po_number} as the only viable open PO for this vendor.` }, checks };
}
