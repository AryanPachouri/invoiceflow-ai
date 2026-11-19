import { describe, expect, it } from "vitest";
import { normalizePo, parseDate, parseInvoiceText, parseMoney } from "@/server/extraction/parser";

describe("value parsers", () => {
  it("parses money in several formats", () => {
    expect(parseMoney("$12,744.00")).toEqual({ value: 12744, currency: "USD" });
    expect(parseMoney("EUR 1,550.00")).toEqual({ value: 1550, currency: "EUR" });
    expect(parseMoney("£2,400.00")).toEqual({ value: 2400, currency: "GBP" });
    expect(parseMoney("1.234,56")?.value).toBe(1234.56);
    expect(parseMoney("(500.00)")?.value).toBe(-500);
    expect(parseMoney("—")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });

  it("parses dates and flags ambiguity", () => {
    expect(parseDate("12 Nov 2026")).toEqual({ iso: "2026-11-12", ambiguous: false });
    expect(parseDate("November 3, 2026")?.iso).toBe("2026-11-03");
    expect(parseDate("11/14/2026")).toEqual({ iso: "2026-11-14", ambiguous: false });
    expect(parseDate("25/10/2026")?.iso).toBe("2026-10-25");
    expect(parseDate("03/04/2026")?.ambiguous).toBe(true);
    expect(parseDate("Due 12/14/2026")?.iso).toBe("2026-12-14");
    expect(parseDate("31 Feb 2026")).toBeNull();
    expect(parseDate("—")).toBeNull();
  });

  it("normalises PO references including OCR confusions", () => {
    expect(normalizePo("PO-2026-0141")).toEqual({ value: "PO-2026-0141", corrected: false });
    expect(normalizePo("P0O-2026-0150")).toEqual({ value: "PO-2026-0150", corrected: true });
    expect(normalizePo("PO 2026 O15O")?.value).toBe("PO-2026-0150");
    expect(normalizePo("—")).toBeNull();
  });
});

describe("parseInvoiceText", () => {
  it("extracts labelled fields, columnar headers and line items", () => {
    const r = parseInvoiceText([
      "Acme Widgets LLC | INVOICE",
      "42 Main Street, Springfield, IL 62701",
      "Tax ID: 12-3456789",
      "Invoice # | Issue date | Payment due | Purchase Order",
      "AW-1001 | 2 Nov 2026 | 2 Dec 2026 | PO-2026-0999",
      "Bill To | Currency: | USD",
      "Description | Qty | Unit Price | Amount",
      "Blue Widget | 10 | $5.00 | $50.00",
      "Red Widget | 2 | $25.00 | $50.00",
      "Subtotal | $100.00",
      "Tax (10%) | $10.00",
      "Total Due | $110.00",
    ]);
    expect(r.invoice).toMatchObject({
      vendorName: "Acme Widgets LLC", vendorTaxId: "12-3456789", invoiceNumber: "AW-1001", invoiceDate: "2026-11-02",
      dueDate: "2026-12-02", poReference: "PO-2026-0999", currency: "USD", subtotal: 100, taxRate: 10, taxAmount: 10, totalAmount: 110,
    });
    expect(r.invoice.lineItems).toHaveLength(2);
  });

  it("never invents missing fields", () => {
    const r = parseInvoiceText(["Acme Widgets LLC", "Description | Qty | Unit Price | Amount", "Blue Widget | 10 | $5.00 | $50.00", "Subtotal | $50.00"]);
    expect(r.invoice.invoiceNumber).toBeNull();
    expect(r.invoice.invoiceDate).toBeNull();
    expect(r.invoice.totalAmount).toBeNull(); // not computed from subtotal
  });

  it("handles merged OCR header cells, rate-before-qty columns, '+' amounts and discounts (real template invoice)", () => {
    // OCR output of a real-world image-only invoice template
    const r = parseInvoiceText([
      "n VO | ce | YOUR COMPANY", "1234 Your Street", "City, California", "PA | a | M | 90210", "Click to edit | urate", "1-888-123-4567",
      "Billed To | Date Issued | Invoice Number Amount Due", "Your Client | 26/3/2021 | INV-10012 | $1,699.48",
      "1234 Clients Street", "City, California | Due Date", "90210 | 25/4/2021", "United States",
      "DESCRIPTION | RATE | Qry | AMOUNT",
      "Services | $55.00 | 10 | $550.00", "Cost of various services. | +Tax",
      "Consulting | $75.00 | 15 | $1,125.00", "Consultant for your business. | +Tax",
      "Materials | $123.39 | 1 | $123.39",
      "Subtotal | $1,798.39", "Discount | -$179.84", "Tax | +$80.93", "Total | $1,699.48",
      "Deposit Requested | $169.95", "Deposit Due | $169.95",
    ], { ocrConfidence: 91 });
    expect(r.invoice).toMatchObject({
      vendorName: "Your Company", invoiceNumber: "INV-10012", invoiceDate: "2021-03-26", dueDate: "2021-04-25", currency: "USD",
      subtotal: 1798.39, discountAmount: 179.84, taxAmount: 80.93, totalAmount: 1699.48,
    });
    expect(r.invoice.lineItems.map((l) => [l.description, l.quantity, l.unitPrice, l.amount])).toEqual([
      ["Services", 10, 55, 550], ["Consulting", 15, 75, 1125], ["Materials", 1, 123.39, 123.39],
    ]);
  });
});
