import { z } from "zod";
import type { Db, Queryable } from "../db";
import { normalizeTaxId, similarity } from "../rules/types";
import { recordEvent } from "../repositories/events";
import { getRun } from "../repositories/runs";

/** Indian GSTIN: 2-digit state code + PAN (5 letters, 4 digits, 1 letter) + entity code + 'Z' + checksum. */
export const GSTIN_RE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** A tax ID that looks like an attempted GSTIN (15 chars beginning with a 2-digit state code). */
export const looksLikeGstin = (s: string) => /^[0-9]{2}[A-Z0-9]{13}$/i.test(s.replace(/\s/g, ""));

const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const VendorInputSchema = z.object({
  vendor_name: z.string().trim().min(2, "Vendor name is required (at least 2 characters)").max(120),
  email: z.string().trim().max(200).optional().nullable().transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Vendor email is not a valid email address"),
  vendor_tax_id: opt(40)
    .transform((v) => (v ? v.replace(/\s+/g, "").toUpperCase() : null))
    .refine((v) => v === null || !looksLikeGstin(v) || GSTIN_RE.test(v), "GSTIN format is invalid (expected e.g. 27AAPFU0939F1ZV)"),
  address: opt(300),
  phone: opt(40).refine((v) => v === null || /^[+()0-9\s.-]{6,25}$/.test(v), "Contact number may only contain digits, spaces and + ( ) - ."),
  payment_details: opt(300),
  default_currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code"),
  status: z.enum(["ACTIVE", "INACTIVE", "PENDING_VERIFICATION"]),
  source_run_id: z.string().uuid().optional().nullable(),
});
export type VendorInput = z.infer<typeof VendorInputSchema>;

export class VendorConflictError extends Error {
  constructor(message: string, public existing: { id: string; vendor_code: string; vendor_name: string; status: string }) {
    super(message);
    this.name = "VendorConflictError";
  }
}

/** Duplicate check: same tax ID, or a name that is effectively the same company. */
export async function findDuplicateVendor(db: Queryable, name: string, taxId: string | null) {
  const { rows } = await db.query<{ id: string; vendor_code: string; vendor_name: string; vendor_tax_id: string | null; status: string }>(
    "SELECT id, vendor_code, vendor_name, vendor_tax_id, status FROM vendors",
  );
  const tid = normalizeTaxId(taxId);
  if (tid) {
    const byTax = rows.find((r) => normalizeTaxId(r.vendor_tax_id) === tid);
    if (byTax) return { vendor: byTax, reason: `Tax ID ${taxId} is already registered to ${byTax.vendor_name} (${byTax.vendor_code})` };
  }
  const byName = rows.map((r) => ({ r, s: similarity(name, r.vendor_name) })).sort((a, b) => b.s - a.s)[0];
  if (byName && byName.s >= 0.9) {
    return { vendor: byName.r, reason: `A vendor named "${byName.r.vendor_name}" (${byName.r.vendor_code}) already exists` };
  }
  return null;
}

export async function createVendorRecord(db: Db, input: VendorInput) {
  return db.transaction(async (tx) => {
    const dup = await findDuplicateVendor(tx, input.vendor_name, input.vendor_tax_id);
    if (dup) throw new VendorConflictError(dup.reason, dup.vendor);
    const { rows: c } = await tx.query<{ n: number }>(
      "SELECT coalesce(max(substring(vendor_code from 3)::int), 1000) + 1 AS n FROM vendors WHERE vendor_code ~ '^V-[0-9]+$'",
    );
    const { rows } = await tx.query<Record<string, unknown>>(
      `INSERT INTO vendors (vendor_code, vendor_name, vendor_tax_id, address, email, phone, payment_details, default_currency, status,
         source, source_run_id, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $9 = 'ACTIVE' THEN now() END) RETURNING *`,
      [`V-${c[0].n}`, input.vendor_name, input.vendor_tax_id, input.address, input.email, input.phone, input.payment_details,
        input.default_currency, input.status, input.source_run_id ? "INVOICE" : "MANUAL", input.source_run_id ?? null],
    );
    const vendor = rows[0];
    if (input.source_run_id) {
      await recordEvent(tx, input.source_run_id, "VENDOR_CREATED",
        `Vendor ${vendor.vendor_name} (${vendor.vendor_code}) registered from this invoice with status ${String(vendor.status).replace("_", " ")}`,
        { vendorId: vendor.id, vendorCode: vendor.vendor_code, status: vendor.status });
    }
    return vendor;
  });
}

export async function setVendorStatus(db: Queryable, id: string, status: "ACTIVE" | "INACTIVE" | "PENDING_VERIFICATION") {
  const { rows } = await db.query(
    `UPDATE vendors SET status = $2, updated_at = now(),
       verified_at = CASE WHEN $2 = 'ACTIVE' THEN coalesce(verified_at, now()) ELSE verified_at END
     WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] ?? null;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

/**
 * Prefill a vendor form from a run's extracted data. Every value says where it came from;
 * contact details found in the document text are flagged for verification because an
 * invoice may also contain the customer's contact details.
 */
export async function vendorPrefill(db: Queryable, runId: string) {
  const run = await getRun(db, runId);
  if (!run) return null;
  const ex = (run.extracted_data ?? {}) as { invoice?: Record<string, unknown> };
  const inv = ex.invoice ?? {};
  const stage = (run.stages as Record<string, any>[]).find((s) => s.stage_key === "EXTRACTION"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw: string = stage?.output_data?.rawTextPreview ?? "";
  const emails = [...new Set(raw.match(EMAIL_RE) ?? [])];
  const phones = [...new Set((raw.match(PHONE_RE) ?? []).map((p) => p.trim()).filter((p) => p.replace(/\D/g, "").length >= 8 && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(p)))];
  const field = (value: unknown, source: string) => ({ value: (value as string) ?? null, source: value ? source : "unavailable" });
  return {
    runId,
    vendor_name: field(inv.vendorName, "invoice header"),
    vendor_tax_id: field(inv.vendorTaxId, "invoice"),
    address: field(inv.vendorAddress, "invoice header"),
    email: field(emails[0] ?? null, "document text (verify it belongs to the vendor)"),
    phone: field(phones[0] ?? null, "document text (verify it belongs to the vendor)"),
    payment_details: field(null, "unavailable"),
    default_currency: (inv.currency as string) ?? "USD",
  };
}
