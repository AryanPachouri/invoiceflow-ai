import type { InvoiceSpec } from "./invoice-pdf";
import { SEED_VENDORS } from "../src/server/seed/data";

const v = (code: string) => {
  const s = SEED_VENDORS.find((x) => x.code === code)!;
  return { name: s.name, address: s.address, taxId: s.taxId, email: s.email };
};

export interface SampleDef {
  file: string;
  title: string;
  scenario: string;
  expected: "APPROVED" | "NEEDS_REVIEW" | "REJECTED";
  spec: InvoiceSpec;
}

/** Demo invoices shown on the upload page (written to public/samples). */
export const DEMO_SAMPLES: SampleDef[] = [
  {
    file: "01-apex-happy-path.pdf",
    title: "Happy path — Apex Industrial",
    scenario: "Clean text PDF, explicit PO, amounts within PO balance.",
    expected: "APPROVED",
    spec: {
      layout: "classic", vendor: v("V-1001"), invoiceNumber: "INV-APX-2026-0412", invoiceDate: "2026-11-12", dueDate: "2026-12-12",
      poNumber: "PO-2026-0141", currency: "USD", taxRate: 8,
      items: [
        { description: "Hi-Vis Safety Vest", quantity: 400, unitPrice: 22.5 },
        { description: "Steel-Toe Work Boots", quantity: 20, unitPrice: 140 },
      ],
    },
  },
  {
    file: "02-nordic-scanned-ocr.pdf",
    title: "Scanned invoice (OCR) — Nordic Freight",
    scenario: "Image-only scanned PDF in EUR. No text layer, so OCR is required.",
    expected: "APPROVED",
    spec: {
      layout: "modern", scanned: true, vendor: v("V-1003"), invoiceNumber: "NFL-26-07781", invoiceDate: "2026-11-10", dueDate: "2026-12-10",
      poNumber: "PO-2026-0150", currency: "EUR", taxRate: 19,
      items: [
        { description: "FTL Freight Hamburg-Rotterdam", quantity: 4, unitPrice: 1550 },
        { description: "Customs Documentation", quantity: 4, unitPrice: 300 },
      ],
    },
  },
  {
    file: "03-apex-duplicate.pdf",
    title: "Edge case 1 — Duplicate invoice",
    scenario: "Vendor re-sent invoice INV-APX-2026-0398, which was already processed and approved.",
    expected: "REJECTED",
    spec: {
      layout: "classic", vendor: v("V-1001"), invoiceNumber: "INV-APX-2026-0398", invoiceDate: "2026-10-28", dueDate: "2026-11-27",
      poNumber: "PO-2026-0141", currency: "USD", taxRate: 8,
      items: [{ description: "Safety Helmet, Class E", quantity: 200, unitPrice: 45 }],
      notes: "SECOND NOTICE - copy of original invoice. Payment terms: Net 30.",
    },
  },
  {
    file: "04-summit-amount-mismatch.pdf",
    title: "Edge case 2 — Amount exceeds PO balance",
    scenario: "PO has $4,500 remaining; invoice bills $5,750 (an unplanned emergency repair was added).",
    expected: "NEEDS_REVIEW",
    spec: {
      layout: "compact", vendor: v("V-1005"), invoiceNumber: "SFM-11873", invoiceDate: "2026-11-14", dueDate: "2026-12-14",
      poNumber: "PO-2026-0172", currency: "USD", taxRate: 0,
      items: [
        { description: "Monthly Janitorial Service", quantity: 2, unitPrice: 1500 },
        { description: "HVAC Preventive Maintenance", quantity: 1, unitPrice: 1500 },
        { description: "Emergency HVAC Repair", quantity: 1, unitPrice: 1250 },
      ],
    },
  },
  {
    file: "05-brightline-missing-po.pdf",
    title: "Edge case 3 — Missing PO reference",
    scenario: "No PO on the invoice and a bundled line item. The vendor has two open POs that could both fit.",
    expected: "NEEDS_REVIEW",
    spec: {
      layout: "classic", vendor: v("V-1002"), invoiceNumber: "BCS-2026-1107", invoiceDate: "2026-11-01", dueDate: "2026-12-01",
      currency: "USD",
      items: [{ description: "Cloud Hosting & Support Bundle - November", quantity: 1, unitPrice: 3800 }],
    },
  },
  {
    file: "06-orion-missing-fields.pdf",
    title: "Edge case 4 — Missing invoice number & date",
    scenario: "Invoice is missing its invoice number and issue date.",
    expected: "NEEDS_REVIEW",
    spec: {
      layout: "modern", vendor: v("V-1006"), poNumber: "PO-2026-0188", currency: "GBP", taxRate: 20,
      items: [{ description: "Analytics Platform Licence - Annual", quantity: 1, unitPrice: 2400 }],
    },
  },
  {
    file: "07-meridian-inactive-vendor.pdf",
    title: "Inactive vendor — Meridian Print",
    scenario: "Vendor was deactivated in the vendor master file.",
    expected: "REJECTED",
    spec: {
      layout: "classic", vendor: v("V-1004"), invoiceNumber: "MPP-55102", invoiceDate: "2026-11-05", dueDate: "2026-12-05",
      poNumber: "PO-2026-0133", currency: "USD", taxRate: 7.5,
      items: [{ description: "Printed Shipping Carton 18x12x10", quantity: 2000, unitPrice: 1.84 }],
    },
  },
  {
    file: "08-brightline-tax-error.pdf",
    title: "Incorrect tax calculation",
    scenario: "Tax stated as 8% but the tax amount doesn't match the subtotal.",
    expected: "NEEDS_REVIEW",
    spec: {
      layout: "classic", vendor: v("V-1002"), invoiceNumber: "BCS-2026-1098", invoiceDate: "2026-11-03", dueDate: "2026-12-03",
      poNumber: "PO-2026-0157", currency: "USD", taxRate: 8, taxAmountOverride: 300,
      items: [{ description: "Managed Cloud Hosting - Monthly", quantity: 1, unitPrice: 3000 }],
    },
  },
  {
    file: "09-brightline-partial-invoice.pdf",
    title: "Partial invoice against an annual PO",
    scenario: "Monthly invoice against a 12-month PO. The cumulative invoiced amount is tracked.",
    expected: "APPROVED",
    spec: {
      layout: "classic", vendor: v("V-1002"), invoiceNumber: "BCS-2026-1120", invoiceDate: "2026-11-15", dueDate: "2026-12-15",
      poNumber: "PO-2026-0157", currency: "USD",
      items: [{ description: "Managed Cloud Hosting - Monthly", quantity: 1, unitPrice: 3000 }],
    },
  },
];

/** Historical invoices processed through the real pipeline at seed time (flagged as sample data). */
export const HISTORY_SAMPLES: SampleDef[] = [
  {
    file: "h1-apex-0398.pdf", title: "Apex INV-APX-2026-0398", scenario: "history", expected: "APPROVED",
    spec: {
      layout: "classic", vendor: v("V-1001"), invoiceNumber: "INV-APX-2026-0398", invoiceDate: "2026-10-28", dueDate: "2026-11-27",
      poNumber: "PO-2026-0141", currency: "USD", taxRate: 8,
      items: [{ description: "Safety Helmet, Class E", quantity: 200, unitPrice: 45 }],
    },
  },
  {
    file: "h2-summit-11520.pdf", title: "Summit SFM-11520", scenario: "history", expected: "APPROVED",
    spec: {
      layout: "compact", vendor: v("V-1005"), invoiceNumber: "SFM-11520", invoiceDate: "2026-10-15", dueDate: "2026-11-14",
      poNumber: "PO-2026-0172", currency: "USD", taxRate: 0,
      items: [
        { description: "Monthly Janitorial Service", quantity: 4, unitPrice: 1500 },
        { description: "HVAC Preventive Maintenance", quantity: 1, unitPrice: 1500 },
      ],
    },
  },
  {
    file: "h3-brightline-1042.pdf", title: "Brightline BCS-2026-1042", scenario: "history", expected: "APPROVED",
    spec: {
      layout: "classic", vendor: v("V-1002"), invoiceNumber: "BCS-2026-1042", invoiceDate: "2026-10-15", dueDate: "2026-11-14",
      poNumber: "PO-2026-0157", currency: "USD",
      items: [{ description: "Managed Cloud Hosting - Monthly", quantity: 1, unitPrice: 3000 }],
    },
  },
  {
    file: "h4-nordic-07310.pdf", title: "Nordic NFL-26-07310", scenario: "history", expected: "APPROVED",
    spec: {
      layout: "modern", vendor: v("V-1003"), invoiceNumber: "NFL-26-07310", invoiceDate: "2026-10-20", dueDate: "2026-11-19",
      poNumber: "PO-2026-0150", currency: "EUR", taxRate: 19,
      items: [
        { description: "FTL Freight Hamburg-Rotterdam", quantity: 2, unitPrice: 1550 },
        { description: "Customs Documentation", quantity: 2, unitPrice: 300 },
      ],
    },
  },
];
