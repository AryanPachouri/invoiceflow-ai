import { netAmount, type ExtractedInvoice } from "../extraction/types";
import type { BusinessRules } from "../seed/data";
import { fail, pass, round2, warn, money, type Check } from "./types";

const S = "VALIDATION";
const CENT_TOLERANCE = 0.05;

/** Stage 3 — field-level data validation. Every rule is recorded individually. */
export function validateInvoice(
  inv: ExtractedInvoice,
  rules: BusinessRules,
  ctx: { extractionConfidence: number; today?: string },
): Check[] {
  const checks: Check[] = [];
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const ccy = inv.currency;

  // Required fields
  const required: [keyof ExtractedInvoice, string][] = [
    ["vendorName", "Vendor name"], ["invoiceNumber", "Invoice number"], ["invoiceDate", "Invoice date"],
    ["totalAmount", "Total amount"], ["currency", "Currency"],
  ];
  for (const [f, label] of required) {
    const v = inv[f];
    checks.push(v === null || v === ""
      ? fail({ code: `REQUIRED_${String(f).toUpperCase()}`, stage: S, label: `${label} present`, severity: "CRITICAL", action: "REVIEW", message: `${label} is missing from the invoice. A human must obtain it before approval` })
      : pass({ code: `REQUIRED_${String(f).toUpperCase()}`, stage: S, label: `${label} present`, severity: "CRITICAL", message: `${label}: ${v}` }));
  }

  // Invoice number format
  if (inv.invoiceNumber) {
    const ok = /^[A-Z0-9][A-Z0-9\-/_.]{2,31}$/i.test(inv.invoiceNumber) && /\d/.test(inv.invoiceNumber);
    checks.push(ok
      ? pass({ code: "INVOICE_NUMBER_FORMAT", stage: S, label: "Invoice number format", severity: "MAJOR", message: `"${inv.invoiceNumber}" is a valid identifier` })
      : fail({ code: "INVOICE_NUMBER_FORMAT", stage: S, label: "Invoice number format", severity: "MAJOR", action: "REVIEW", message: `"${inv.invoiceNumber}" does not look like a valid invoice number` }));
  }

  // Dates
  if (inv.invoiceDate) {
    const ageDays = Math.round((Date.parse(today) - Date.parse(inv.invoiceDate)) / 86_400_000);
    if (ageDays < -1) checks.push(fail({ code: "INVOICE_DATE_VALID", stage: S, label: "Invoice date not in the future", severity: "MAJOR", action: "REVIEW", message: `Invoice is dated ${inv.invoiceDate}, ${-ageDays} days in the future`, actual: inv.invoiceDate, expected: `≤ ${today}` }));
    else if (ageDays > 365) checks.push(warn({ code: "INVOICE_DATE_VALID", stage: S, label: "Invoice date recency", severity: "MINOR", action: "REVIEW", message: `Invoice is ${ageDays} days old (stale invoices require review)`, actual: inv.invoiceDate }));
    else checks.push(pass({ code: "INVOICE_DATE_VALID", stage: S, label: "Invoice date valid", severity: "MAJOR", message: `Dated ${inv.invoiceDate} (${ageDays} days ago)` }));
  }
  if (inv.invoiceDate && inv.dueDate) {
    checks.push(inv.dueDate >= inv.invoiceDate
      ? pass({ code: "DUE_DATE_VALID", stage: S, label: "Due date after invoice date", severity: "MINOR", message: `Due ${inv.dueDate}` })
      : fail({ code: "DUE_DATE_VALID", stage: S, label: "Due date after invoice date", severity: "MAJOR", action: "REVIEW", message: `Due date ${inv.dueDate} is before invoice date ${inv.invoiceDate}` }));
  }

  // Currency
  if (ccy) {
    checks.push(rules.allowedCurrencies.includes(ccy)
      ? pass({ code: "CURRENCY_ALLOWED", stage: S, label: "Currency allowed", severity: "MAJOR", message: `${ccy} is an accepted currency` })
      : fail({ code: "CURRENCY_ALLOWED", stage: S, label: "Currency allowed", severity: "MAJOR", action: "REVIEW", message: `${ccy} is not in the allowed currency list (${rules.allowedCurrencies.join(", ")})`, actual: ccy }));
  }

  // Numeric sanity
  const net = netAmount(inv);
  const discountNote = inv.discountAmount ? ` (after ${money(inv.discountAmount, ccy)} discount)` : "";
  const amounts = [inv.subtotal, inv.discountAmount, inv.taxAmount, inv.totalAmount, ...inv.lineItems.flatMap((l) => [l.amount, l.unitPrice, l.quantity])]
    .filter((n): n is number => n !== null);
  const bad = amounts.filter((n) => !Number.isFinite(n) || n < 0);
  checks.push(bad.length
    ? fail({ code: "AMOUNTS_NON_NEGATIVE", stage: S, label: "Amounts are valid and non-negative", severity: "CRITICAL", action: "REVIEW", message: `${bad.length} negative or invalid amount(s) found. Credit notes must be handled manually` })
    : pass({ code: "AMOUNTS_NON_NEGATIVE", stage: S, label: "Amounts are valid and non-negative", severity: "CRITICAL", message: "All amounts are valid numbers ≥ 0" }));
  if (inv.totalAmount !== null && inv.totalAmount === 0) {
    checks.push(fail({ code: "TOTAL_NON_ZERO", stage: S, label: "Total greater than zero", severity: "MAJOR", action: "REVIEW", message: "Invoice total is zero" }));
  }

  // Line arithmetic
  if (inv.lineItems.length) {
    const wrong = inv.lineItems.filter((l) => l.quantity !== null && l.unitPrice !== null && l.amount !== null && Math.abs(l.quantity * l.unitPrice - l.amount) > CENT_TOLERANCE);
    checks.push(wrong.length
      ? fail({ code: "LINE_ARITHMETIC", stage: S, label: "Line items: qty × unit price = amount", severity: "MAJOR", action: "REVIEW", message: `${wrong.length} line(s) do not multiply out: ${wrong.map((l) => l.description).join("; ")}` })
      : pass({ code: "LINE_ARITHMETIC", stage: S, label: "Line items: qty × unit price = amount", severity: "MAJOR", message: `${inv.lineItems.length} line item(s) multiply out correctly` }));
  }

  // Subtotal = sum(lines)
  if (inv.subtotal !== null && inv.lineItems.length) {
    const sum = round2(inv.lineItems.reduce((a, l) => a + (l.amount ?? 0), 0));
    const diff = round2(inv.subtotal - sum);
    checks.push(Math.abs(diff) <= CENT_TOLERANCE
      ? pass({ code: "SUBTOTAL_CALC", stage: S, label: "Subtotal equals sum of line items", severity: "MAJOR", message: `Lines sum to ${money(sum, ccy)}`, expected: sum, actual: inv.subtotal, difference: diff })
      : fail({ code: "SUBTOTAL_CALC", stage: S, label: "Subtotal equals sum of line items", severity: "MAJOR", action: "REVIEW", message: `Subtotal ${money(inv.subtotal, ccy)} ≠ sum of lines ${money(sum, ccy)} (difference ${money(diff, ccy)})`, expected: sum, actual: inv.subtotal, difference: diff }));
  }

  // Tax = subtotal × rate
  if (inv.taxRate !== null && net !== null && inv.taxAmount !== null) {
    const expected = round2((net * inv.taxRate) / 100);
    const diff = round2(inv.taxAmount - expected);
    checks.push(Math.abs(diff) <= CENT_TOLERANCE
      ? pass({ code: "TAX_CALC", stage: S, label: "Tax amount matches stated rate", severity: "MAJOR", message: `${inv.taxRate}% of ${money(net, ccy)}${discountNote} = ${money(expected, ccy)}`, expected, actual: inv.taxAmount, difference: diff })
      : fail({ code: "TAX_CALC", stage: S, label: "Tax amount matches stated rate", severity: "MAJOR", action: "REVIEW", message: `Tax ${money(inv.taxAmount, ccy)} does not equal ${inv.taxRate}% of ${money(net, ccy)}${discountNote} (expected ${money(expected, ccy)}, difference ${money(diff, ccy)})`, expected, actual: inv.taxAmount, difference: diff }));
  } else if (inv.taxAmount !== null && net && net > 0) {
    const implied = round2((inv.taxAmount / net) * 100);
    checks.push(implied <= 30
      ? pass({ code: "TAX_CALC", stage: S, label: "Tax amount plausible", severity: "MINOR", message: `No rate stated; implied rate ${implied}%` })
      : warn({ code: "TAX_CALC", stage: S, label: "Tax amount plausible", severity: "MAJOR", action: "REVIEW", message: `Implied tax rate ${implied}% is unusually high` }));
  }

  // Total = subtotal + tax
  if (inv.totalAmount !== null && net !== null) {
    const expected = round2(net + (inv.taxAmount ?? 0));
    const diff = round2(inv.totalAmount - expected);
    checks.push(Math.abs(diff) <= CENT_TOLERANCE
      ? pass({ code: "TOTAL_CALC", stage: S, label: "Total equals subtotal − discount + tax", severity: "CRITICAL", message: `${money(inv.subtotal, ccy)}${inv.discountAmount ? ` − ${money(inv.discountAmount, ccy)}` : ""} + ${money(inv.taxAmount ?? 0, ccy)} = ${money(expected, ccy)}`, expected, actual: inv.totalAmount, difference: diff })
      : fail({ code: "TOTAL_CALC", stage: S, label: "Total equals subtotal − discount + tax", severity: "CRITICAL", action: "REVIEW", message: `Total ${money(inv.totalAmount, ccy)} ≠ subtotal${inv.discountAmount ? " − discount" : ""} + tax ${money(expected, ccy)} (difference ${money(diff, ccy)})`, expected, actual: inv.totalAmount, difference: diff }));
  } else if (inv.totalAmount !== null && inv.subtotal === null) {
    checks.push(warn({ code: "TOTAL_CALC", stage: S, label: "Total equals subtotal − discount + tax", severity: "MAJOR", action: "REVIEW", message: "Subtotal not stated, so the total cannot be verified" }));
  }

  // Extraction confidence
  const min = rules.autoApproval.minExtractionConfidence;
  checks.push(ctx.extractionConfidence >= min
    ? pass({ code: "EXTRACTION_CONFIDENCE", stage: S, label: "Extraction confidence", severity: "MAJOR", message: `${ctx.extractionConfidence}% ≥ required ${min}%`, expected: min, actual: ctx.extractionConfidence })
    : warn({ code: "EXTRACTION_CONFIDENCE", stage: S, label: "Extraction confidence", severity: "MAJOR", action: "REVIEW", message: `Extraction confidence ${ctx.extractionConfidence}% is below the ${min}% auto-approval threshold`, expected: min, actual: ctx.extractionConfidence }));

  return checks;
}
