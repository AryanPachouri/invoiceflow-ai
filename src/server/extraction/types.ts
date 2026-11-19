import { z } from "zod";

export const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  amount: z.number().nullable(),
});

export const ExtractedInvoiceSchema = z.object({
  vendorName: z.string().nullable(),
  vendorAddress: z.string().nullable(),
  vendorTaxId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  poReference: z.string().nullable(),
  currency: z.string().length(3).nullable(),
  lineItems: z.array(LineItemSchema),
  subtotal: z.number().nullable(),
  /** Discount stated on the invoice, as a positive amount deducted before tax. */
  discountAmount: z.number().nullable(),
  taxRate: z.number().nullable(),
  taxAmount: z.number().nullable(),
  totalAmount: z.number().nullable(),
});

export type LineItem = z.infer<typeof LineItemSchema>;
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
/** Net amount that consumes PO balance: subtotal less any stated discount. */
export function netAmount(inv: Pick<ExtractedInvoice, "subtotal" | "discountAmount">): number | null {
  if (inv.subtotal === null) return null;
  return Math.round((inv.subtotal - (inv.discountAmount ?? 0)) * 100) / 100;
}

export type FieldKey = Exclude<keyof ExtractedInvoice, "lineItems">;

export interface FieldWarning {
  field: FieldKey | "lineItems" | "document";
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
}

export interface ExtractionResult {
  invoice: ExtractedInvoice;
  method: "PDF_TEXT" | "OCR" | "PDF_TEXT+AI" | "OCR+AI";
  confidence: number; // 0..100
  fieldConfidence: Partial<Record<FieldKey | "lineItems", number>>;
  warnings: FieldWarning[];
  rawText: string;
  pageCount: number;
  ocrConfidence?: number;
  ai?: { used: boolean; model?: string; status: string; acceptedFields?: string[]; rejectedFields?: string[] };
}

export const CRITICAL_FIELDS: FieldKey[] = ["vendorName", "invoiceNumber", "invoiceDate", "totalAmount"];
export const KEY_FIELDS: FieldKey[] = [
  "vendorName", "invoiceNumber", "invoiceDate", "dueDate", "poReference", "currency", "subtotal", "taxAmount", "totalAmount",
];
