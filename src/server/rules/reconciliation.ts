import { netAmount, type ExtractedInvoice } from "../extraction/types";
import type { BusinessRules } from "../seed/data";
import type { PoRecord } from "./po";
import { fail, money, pass, round2, similarity, warn, type Check } from "./types";

const S = "RECONCILIATION";

export interface LineComparison {
  invoiceLine: string;
  poLine: string | null;
  similarity: number;
  invoiceQty: number | null;
  poQty: number | null;
  invoiceUnitPrice: number | null;
  poUnitPrice: number | null;
  priceDiffPct: number | null;
  status: "MATCH" | "PRICE_VARIANCE" | "QTY_EXCEEDS" | "NOT_ON_PO";
}

export interface ReconciliationSummary {
  currency: string;
  poTotal: number;
  previouslyInvoiced: number;
  remainingBefore: number;
  invoiceSubtotal: number | null;
  invoiceTax: number | null;
  invoiceTotal: number | null;
  remainingAfter: number | null;
  difference: number | null; // subtotal - remaining (positive = over)
  differencePct: number | null;
  toleranceAmount: number;
  tolerancePercent: number;
  lines: LineComparison[];
}

/** Stage 7 — 2-way match of invoice against PO balance and PO lines, with configurable tolerance. */
export function reconcile(inv: ExtractedInvoice, po: PoRecord, rules: BusinessRules): { checks: Check[]; summary: ReconciliationSummary } {
  const checks: Check[] = [];
  const tolPct = rules.tolerancePercent;
  const remaining = round2(po.remaining_balance);
  const tolAmount = round2(Math.max(remaining * (tolPct / 100), rules.toleranceAbsoluteMin));
  const ccy = po.currency;

  // Currency
  checks.push(!inv.currency || inv.currency === po.currency
    ? pass({ code: "CURRENCY_MATCH", stage: S, label: "Invoice currency matches PO", severity: "CRITICAL", message: `Both in ${po.currency}` })
    : fail({ code: "CURRENCY_MATCH", stage: S, label: "Invoice currency matches PO", severity: "CRITICAL", action: "REVIEW", message: `Invoice is in ${inv.currency} but PO ${po.po_number} is in ${po.currency}. Amounts cannot be compared without FX approval`, expected: po.currency, actual: inv.currency }));

  // Subtotal vs remaining balance (PO values are net of tax)
  const sub = netAmount(inv); // net of any discount: this is what consumes PO balance
  let difference: number | null = null, differencePct: number | null = null;
  if (sub !== null && (!inv.currency || inv.currency === po.currency)) {
    difference = round2(sub - remaining);
    differencePct = remaining > 0 ? round2((difference / remaining) * 100) : null;
    const base = { code: "SUBTOTAL_WITHIN_PO_BALANCE", stage: S, label: "Invoice subtotal within remaining PO balance", severity: "CRITICAL" as const, expected: remaining, actual: sub, difference, differencePct };
    if (difference <= 0) {
      checks.push(pass({ ...base, message: `${money(sub, ccy)} ≤ remaining ${money(remaining, ccy)} (PO ${money(po.total_amount, ccy)} − already invoiced ${money(po.invoiced_amount, ccy)})${sub < remaining ? `. Partial invoice; ${money(remaining - sub, ccy)} will remain` : ""}` }));
    } else if (difference <= tolAmount) {
      checks.push(pass({ ...base, message: `Exceeds remaining balance by ${money(difference, ccy)} (${differencePct}%), within ${tolPct}% tolerance (${money(tolAmount, ccy)})` }));
    } else {
      checks.push(fail({ ...base, action: "REVIEW", message: `Invoice subtotal ${money(sub, ccy)} exceeds remaining PO balance ${money(remaining, ccy)} by ${money(difference, ccy)} (${differencePct ?? "∞"}%), beyond the ${tolPct}% tolerance of ${money(tolAmount, ccy)}` }));
    }
  } else if (sub === null) {
    checks.push(warn({ code: "SUBTOTAL_WITHIN_PO_BALANCE", stage: S, label: "Invoice subtotal within remaining PO balance", severity: "CRITICAL", action: "REVIEW", message: "Invoice subtotal unavailable. Cannot reconcile against PO balance" }));
  }

  // Cumulative position (explicit, for auditability)
  if (sub !== null) {
    const cumulative = round2(po.invoiced_amount + sub);
    checks.push(cumulative <= po.total_amount + tolAmount
      ? pass({ code: "CUMULATIVE_WITHIN_PO", stage: S, label: "Cumulative invoiced ≤ PO total", severity: "MAJOR", message: `${po.invoice_count} prior invoice(s) ${money(po.invoiced_amount, ccy)} + this ${money(sub, ccy)} = ${money(cumulative, ccy)} of ${money(po.total_amount, ccy)}`, expected: po.total_amount, actual: cumulative })
      : fail({ code: "CUMULATIVE_WITHIN_PO", stage: S, label: "Cumulative invoiced ≤ PO total", severity: "MAJOR", action: "REVIEW", message: `Cumulative invoicing ${money(cumulative, ccy)} would exceed PO total ${money(po.total_amount, ccy)}`, expected: po.total_amount, actual: cumulative, difference: round2(cumulative - po.total_amount) }));
  }

  // Tax (informational: POs are net of tax)
  if (inv.taxAmount !== null && sub) {
    const rate = round2((inv.taxAmount / sub) * 100);
    checks.push(rate <= 30
      ? pass({ code: "TAX_REASONABLE", stage: S, label: "Tax amount reasonable", severity: "MINOR", message: `Tax ${money(inv.taxAmount, ccy)} (${rate}% of subtotal). PO values are net of tax` })
      : warn({ code: "TAX_REASONABLE", stage: S, label: "Tax amount reasonable", severity: "MAJOR", action: "REVIEW", message: `Tax is ${rate}% of subtotal, which is unusually high` }));
  }

  // Line-level comparison
  const lines: LineComparison[] = inv.lineItems.map((l) => {
    let best = null as { i: (typeof po.items)[number]; s: number } | null;
    for (const i of po.items) {
      const s = similarity(l.description, i.description);
      if (!best || s > best.s) best = { i, s };
    }
    if (!best || best.s < 0.6) {
      return { invoiceLine: l.description, poLine: null, similarity: best?.s ?? 0, invoiceQty: l.quantity, poQty: null, invoiceUnitPrice: l.unitPrice, poUnitPrice: null, priceDiffPct: null, status: "NOT_ON_PO" };
    }
    const pdiff = l.unitPrice !== null && best.i.unit_price > 0 ? round2(((l.unitPrice - best.i.unit_price) / best.i.unit_price) * 100) : null;
    const status: LineComparison["status"] =
      pdiff !== null && pdiff > tolPct ? "PRICE_VARIANCE" : l.quantity !== null && l.quantity > best.i.quantity ? "QTY_EXCEEDS" : "MATCH";
    return { invoiceLine: l.description, poLine: best.i.description, similarity: best.s, invoiceQty: l.quantity, poQty: best.i.quantity, invoiceUnitPrice: l.unitPrice, poUnitPrice: best.i.unit_price, priceDiffPct: pdiff, status };
  });
  if (lines.length) {
    const notOnPo = lines.filter((l) => l.status === "NOT_ON_PO");
    const priceVar = lines.filter((l) => l.status === "PRICE_VARIANCE");
    const qty = lines.filter((l) => l.status === "QTY_EXCEEDS");
    if (!notOnPo.length && !priceVar.length && !qty.length) {
      checks.push(pass({ code: "LINE_ITEMS_MATCH_PO", stage: S, label: "Line items match PO lines", severity: "MAJOR", message: `All ${lines.length} invoice line(s) match PO lines within ${tolPct}% price tolerance` }));
    } else {
      const parts = [
        ...notOnPo.map((l) => `"${l.invoiceLine}" is not on the PO`),
        ...priceVar.map((l) => `"${l.invoiceLine}" unit price ${l.priceDiffPct}% above PO`),
        ...qty.map((l) => `"${l.invoiceLine}" quantity ${l.invoiceQty} exceeds PO quantity ${l.poQty}`),
      ];
      checks.push(warn({ code: "LINE_ITEMS_MATCH_PO", stage: S, label: "Line items match PO lines", severity: "MAJOR", action: "REVIEW", message: parts.join("; ") }));
    }
  }

  return {
    checks,
    summary: {
      currency: ccy, poTotal: po.total_amount, previouslyInvoiced: po.invoiced_amount, remainingBefore: remaining,
      invoiceSubtotal: sub, invoiceTax: inv.taxAmount, invoiceTotal: inv.totalAmount,
      remainingAfter: sub !== null ? round2(remaining - sub) : null, difference, differencePct,
      toleranceAmount: tolAmount, tolerancePercent: tolPct, lines,
    },
  };
}
