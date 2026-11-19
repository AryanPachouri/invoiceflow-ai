import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@/server/seed/data";
import type { ExtractedInvoice } from "@/server/extraction/types";
import { validateInvoice } from "@/server/rules/validation";
import { matchVendor, verifyVendor, type VendorRecord } from "@/server/rules/vendor";
import { matchPurchaseOrder, type PoRecord } from "@/server/rules/po";
import { reconcile } from "@/server/rules/reconciliation";
import { decide } from "@/server/rules/decision";
import type { Check } from "@/server/rules/types";

const rules = structuredClone(DEFAULT_RULES);
const inv = (o: Partial<ExtractedInvoice> = {}): ExtractedInvoice => ({
  vendorName: "Apex Industrial Supplies Inc.", vendorAddress: null, vendorTaxId: "84-3920175", invoiceNumber: "INV-1", invoiceDate: "2026-11-10",
  dueDate: "2026-12-10", poReference: "PO-1", currency: "USD", subtotal: 1000, discountAmount: null, taxRate: 8, taxAmount: 80, totalAmount: 1080,
  lineItems: [{ description: "Safety Helmet", quantity: 20, unitPrice: 50, amount: 1000 }], ...o,
});
const vendors: VendorRecord[] = [
  { id: "v1", vendor_code: "V-1", vendor_name: "Apex Industrial Supplies Inc.", vendor_tax_id: "84-3920175", address: null, status: "ACTIVE", default_currency: "USD" },
  { id: "v2", vendor_code: "V-2", vendor_name: "Meridian Print & Packaging Co.", vendor_tax_id: "91-2203847", address: null, status: "INACTIVE", default_currency: "USD" },
  { id: "v3", vendor_code: "V-3", vendor_name: "Brightline Cloud Services LLC", vendor_tax_id: null, address: null, status: "ACTIVE", default_currency: "USD" },
];
const po = (o: Partial<PoRecord> = {}): PoRecord => ({
  id: "p1", po_number: "PO-1", vendor_id: "v1", vendor_name: "Apex", total_amount: 5000, currency: "USD", status: "OPEN",
  invoiced_amount: 0, remaining_balance: 5000, invoice_count: 0, items: [{ description: "Safety Helmet", quantity: 100, unit_price: 50, total_amount: 5000 }], ...o,
});
const byCode = (cs: Check[], code: string) => cs.find((c) => c.code === code)!;

describe("validation rules", () => {
  it("passes a clean invoice", () => {
    const cs = validateInvoice(inv(), rules, { extractionConfidence: 95, today: "2026-11-19" });
    expect(cs.filter((c) => c.status !== "PASS")).toEqual([]);
  });
  it("flags missing invoice number, date and total individually", () => {
    const cs = validateInvoice(inv({ invoiceNumber: null, invoiceDate: null, totalAmount: null }), rules, { extractionConfidence: 60, today: "2026-11-19" });
    for (const code of ["REQUIRED_INVOICENUMBER", "REQUIRED_INVOICEDATE", "REQUIRED_TOTALAMOUNT"]) expect(byCode(cs, code).status).toBe("FAIL");
    expect(byCode(cs, "EXTRACTION_CONFIDENCE").status).toBe("WARN");
  });
  it("detects incorrect tax calculation with exact difference", () => {
    const c = byCode(validateInvoice(inv({ taxAmount: 100, totalAmount: 1100 }), rules, { extractionConfidence: 95, today: "2026-11-19" }), "TAX_CALC");
    expect(c.status).toBe("FAIL");
    expect(c.expected).toBe(80);
    expect(c.difference).toBe(20);
  });
  it("detects total and subtotal arithmetic errors and negative amounts", () => {
    const cs = validateInvoice(inv({ subtotal: 900, totalAmount: 2000 }), rules, { extractionConfidence: 95, today: "2026-11-19" });
    expect(byCode(cs, "SUBTOTAL_CALC").status).toBe("FAIL");
    expect(byCode(cs, "TOTAL_CALC").status).toBe("FAIL");
    expect(byCode(validateInvoice(inv({ subtotal: -5 }), rules, { extractionConfidence: 95 }), "AMOUNTS_NON_NEGATIVE").status).toBe("FAIL");
  });
  it("accounts for a stated discount in tax and total checks", () => {
    // 1,000 − 100 discount = 900 net; 8% tax = 72; total 972
    const cs = validateInvoice(inv({ discountAmount: 100, taxAmount: 72, totalAmount: 972 }), rules, { extractionConfidence: 95, today: "2026-11-19" });
    expect(byCode(cs, "TAX_CALC").status).toBe("PASS");
    expect(byCode(cs, "TOTAL_CALC").status).toBe("PASS");
  });
  it("rejects future dates and disallowed currencies", () => {
    const cs = validateInvoice(inv({ invoiceDate: "2027-06-01", dueDate: "2027-07-01", currency: "JPY" }), rules, { extractionConfidence: 95, today: "2026-11-19" });
    expect(byCode(cs, "INVOICE_DATE_VALID").status).toBe("FAIL");
    expect(byCode(cs, "CURRENCY_ALLOWED").status).toBe("FAIL");
  });
});

describe("vendor verification", () => {
  it("matches by tax ID and by fuzzy name", () => {
    expect(matchVendor("APEX INDUSTRIAL SUPPLIES", "84-3920175", vendors).matchedBy).toBe("TAX_ID");
    expect(matchVendor("Brightline Cloud Services, L.L.C.", null, vendors).vendor?.id).toBe("v3");
  });
  it("does not match an unknown vendor", () => {
    const m = matchVendor("Globex Corporation", "55-5555555", vendors);
    expect(m.vendor).toBeNull();
    const cs = verifyVendor(m, { vendorName: "Globex Corporation", vendorTaxId: "55-5555555" }, rules);
    expect(byCode(cs, "VENDOR_EXISTS")).toMatchObject({ status: "FAIL", action: "REVIEW" });
  });
  it("hard-fails inactive vendors and flags tax-ID mismatch", () => {
    const m = matchVendor("Meridian Print & Packaging Co.", null, vendors);
    expect(byCode(verifyVendor(m, { vendorName: "Meridian Print & Packaging Co.", vendorTaxId: null }, rules), "VENDOR_ACTIVE")).toMatchObject({ status: "FAIL", action: "REJECT" });
    const m2 = matchVendor("Apex Industrial Supplies Inc.", "99-0000000", vendors);
    expect(byCode(verifyVendor(m2, { vendorName: "Apex Industrial Supplies Inc.", vendorTaxId: "99-0000000" }, rules), "VENDOR_TAX_ID_CONSISTENT").status).toBe("FAIL");
  });
});

describe("PO matching", () => {
  it("matches an explicit reference", () => {
    expect(matchPurchaseOrder(inv(), "v1", [po()], rules).result.status).toBe("MATCHED");
  });
  it("hard-fails a PO owned by another vendor", () => {
    const { result, checks } = matchPurchaseOrder(inv(), "v1", [po({ vendor_id: "v9", vendor_name: "Other Co" })], rules);
    expect(result.status).toBe("VENDOR_MISMATCH");
    expect(byCode(checks, "PO_VENDOR_MATCH").action).toBe("REJECT");
  });
  it("never auto-selects an ambiguous candidate when the PO is missing", () => {
    const { result } = matchPurchaseOrder(inv({ poReference: null }), "v1", [po(), po({ id: "p2", po_number: "PO-2" })], rules);
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.po).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });
  it("infers a single candidate but still requires review", () => {
    const { result, checks } = matchPurchaseOrder(inv({ poReference: null }), "v1", [po()], rules);
    expect(result.status).toBe("INFERRED");
    expect(byCode(checks, "PO_CANDIDATES").action).toBe("REVIEW");
  });
  it("searches candidates when the referenced PO does not exist", () => {
    const { result, checks } = matchPurchaseOrder(inv({ poReference: "PO-404" }), "v1", [po()], rules);
    expect(byCode(checks, "PO_EXISTS").status).toBe("FAIL");
    expect(result.status).toBe("INFERRED");
  });
});

describe("reconciliation", () => {
  it("accepts partial invoices and amounts within tolerance", () => {
    expect(byCode(reconcile(inv(), po(), rules).checks, "SUBTOTAL_WITHIN_PO_BALANCE").status).toBe("PASS");
    // 1000 vs remaining 990: over by 10, tolerance 2% of 990 = 19.80
    expect(byCode(reconcile(inv(), po({ remaining_balance: 990, invoiced_amount: 4010 }), rules).checks, "SUBTOTAL_WITHIN_PO_BALANCE").status).toBe("PASS");
  });
  it("fails beyond tolerance and records the exact difference", () => {
    const { checks, summary } = reconcile(inv(), po({ remaining_balance: 800, invoiced_amount: 4200 }), rules);
    const c = byCode(checks, "SUBTOTAL_WITHIN_PO_BALANCE");
    expect(c.status).toBe("FAIL");
    expect(summary.difference).toBe(200);
    expect(summary.differencePct).toBe(25);
  });
  it("fails on currency mismatch", () => {
    expect(byCode(reconcile(inv({ currency: "EUR" }), po(), rules).checks, "CURRENCY_MATCH").status).toBe("FAIL");
  });
  it("respects configurable tolerance", () => {
    const loose = { ...rules, tolerancePercent: 30 };
    expect(byCode(reconcile(inv(), po({ remaining_balance: 800 }), loose).checks, "SUBTOTAL_WITHIN_PO_BALANCE").status).toBe("PASS");
  });
});

describe("decision engine", () => {
  const P = (code: string): Check => ({ code, stage: "X", label: code, status: "PASS", severity: "MAJOR", action: "NONE", message: code });
  const F = (code: string, action: "REJECT" | "REVIEW"): Check => ({ ...P(code), status: "FAIL", action });
  const ctx = { totalAmount: 1000, currency: "USD" };
  it("approves only when every check passes", () => {
    expect(decide([P("A"), P("B")], rules, ctx).status).toBe("APPROVED");
  });
  it("hard failures win over review flags", () => {
    expect(decide([F("DUPLICATE_INVOICE", "REJECT"), F("TAX_CALC", "REVIEW")], rules, ctx).status).toBe("REJECTED");
  });
  it("routes review flags to NEEDS_REVIEW", () => {
    const d = decide([P("A"), F("SUBTOTAL_WITHIN_PO_BALANCE", "REVIEW")], rules, ctx);
    expect(d.status).toBe("NEEDS_REVIEW");
    expect(d.reasons).toHaveLength(1);
  });
  it("applies the auto-approval amount limit and kill switch", () => {
    expect(decide([P("A")], rules, { totalAmount: 60000, currency: "USD" }).status).toBe("NEEDS_REVIEW");
    expect(decide([P("A")], { ...rules, autoApproval: { ...rules.autoApproval, enabled: false } }, ctx).status).toBe("NEEDS_REVIEW");
  });
});
