import type { BusinessRules } from "../seed/data";
import { fail, normalizeTaxId, pass, similarity, warn, type Check } from "./types";

export interface VendorRecord {
  id: string;
  vendor_code: string;
  vendor_name: string;
  vendor_tax_id: string | null;
  address: string | null;
  status: "ACTIVE" | "INACTIVE" | "PENDING_VERIFICATION";
  default_currency: string;
}

export interface VendorMatch {
  vendor: VendorRecord | null;
  matchedBy: "TAX_ID" | "EXACT_NAME" | "FUZZY_NAME" | null;
  nameSimilarity: number | null;
  candidates: { vendor_code: string; vendor_name: string; similarity: number }[];
}

const S = "VENDOR_VERIFICATION";
const FUZZY_THRESHOLD = 0.82;

export function matchVendor(name: string | null, taxId: string | null, vendors: VendorRecord[]): VendorMatch {
  const scored = name
    ? vendors.map((v) => ({ v, s: similarity(name, v.vendor_name) })).sort((a, b) => b.s - a.s)
    : [];
  const candidates = scored.slice(0, 3).map(({ v, s }) => ({ vendor_code: v.vendor_code, vendor_name: v.vendor_name, similarity: s }));
  const tid = normalizeTaxId(taxId);
  if (tid) {
    const byTax = vendors.find((v) => normalizeTaxId(v.vendor_tax_id) === tid);
    if (byTax) return { vendor: byTax, matchedBy: "TAX_ID", nameSimilarity: name ? similarity(name, byTax.vendor_name) : null, candidates };
  }
  if (scored[0]?.s === 1) return { vendor: scored[0].v, matchedBy: "EXACT_NAME", nameSimilarity: 1, candidates };
  if (scored[0] && scored[0].s >= FUZZY_THRESHOLD && (scored.length < 2 || scored[0].s - scored[1].s >= 0.1)) {
    return { vendor: scored[0].v, matchedBy: "FUZZY_NAME", nameSimilarity: scored[0].s, candidates };
  }
  return { vendor: null, matchedBy: null, nameSimilarity: scored[0]?.s ?? null, candidates };
}

/** Stage 4 — vendor master-data verification. */
export function verifyVendor(match: VendorMatch, extracted: { vendorName: string | null; vendorTaxId: string | null }, rules: BusinessRules): Check[] {
  const checks: Check[] = [];
  const v = match.vendor;
  if (!v) {
    const action = rules.hardFailures.unknownVendor;
    checks.push(fail({
      code: "VENDOR_EXISTS", stage: S, label: "Vendor exists in vendor master", severity: "CRITICAL", action,
      message: extracted.vendorName
        ? `"${extracted.vendorName}" does not match any approved vendor${match.candidates[0] ? ` (closest: ${match.candidates[0].vendor_name}, ${Math.round(match.candidates[0].similarity * 100)}% similar)` : ""}`
        : "Vendor could not be identified on the invoice",
    }));
    return checks;
  }
  checks.push(pass({ code: "VENDOR_EXISTS", stage: S, label: "Vendor exists in vendor master", severity: "CRITICAL", message: `Matched ${v.vendor_name} (${v.vendor_code}) by ${match.matchedBy?.toLowerCase().replace("_", " ")}` }));

  checks.push(v.status === "PENDING_VERIFICATION"
    ? fail({ code: "VENDOR_ACTIVE", stage: S, label: "Vendor is active", severity: "CRITICAL", action: "REVIEW", message: `${v.vendor_name} is registered but pending verification. Invoices can't be approved until the vendor is verified and activated`, actual: v.status, expected: "ACTIVE" })
    : v.status === "ACTIVE"
    ? pass({ code: "VENDOR_ACTIVE", stage: S, label: "Vendor is active", severity: "CRITICAL", message: `${v.vendor_code} status is ACTIVE` })
    : fail({ code: "VENDOR_ACTIVE", stage: S, label: "Vendor is active", severity: "CRITICAL", action: rules.hardFailures.inactiveVendor, message: `${v.vendor_name} is marked ${v.status} in the vendor master. Payments to inactive vendors are blocked`, actual: v.status, expected: "ACTIVE" }));

  if (extracted.vendorName) {
    const sim = match.nameSimilarity ?? similarity(extracted.vendorName, v.vendor_name);
    checks.push(sim >= FUZZY_THRESHOLD
      ? pass({ code: "VENDOR_NAME_CONSISTENT", stage: S, label: "Vendor name consistent", severity: "MAJOR", message: sim === 1 ? "Name matches vendor master exactly" : `Name ${Math.round(sim * 100)}% similar to vendor master`, actual: extracted.vendorName, expected: v.vendor_name })
      : warn({ code: "VENDOR_NAME_CONSISTENT", stage: S, label: "Vendor name consistent", severity: "MAJOR", action: "REVIEW", message: `Invoice name "${extracted.vendorName}" differs from vendor master "${v.vendor_name}" (${Math.round(sim * 100)}% similar)`, actual: extracted.vendorName, expected: v.vendor_name }));
  }

  if (extracted.vendorTaxId && v.vendor_tax_id) {
    const same = normalizeTaxId(extracted.vendorTaxId) === normalizeTaxId(v.vendor_tax_id);
    checks.push(same
      ? pass({ code: "VENDOR_TAX_ID_CONSISTENT", stage: S, label: "Vendor tax ID consistent", severity: "CRITICAL", message: `Tax ID ${v.vendor_tax_id} matches` })
      : fail({ code: "VENDOR_TAX_ID_CONSISTENT", stage: S, label: "Vendor tax ID consistent", severity: "CRITICAL", action: "REVIEW", message: `Tax ID on invoice (${extracted.vendorTaxId}) differs from vendor master (${v.vendor_tax_id}). Possible fraud or a changed bank/tax record`, actual: extracted.vendorTaxId, expected: v.vendor_tax_id }));
  } else {
    checks.push(warn({ code: "VENDOR_TAX_ID_CONSISTENT", stage: S, label: "Vendor tax ID consistent", severity: "MINOR", action: "NONE", message: "Tax ID not available on invoice; identity verified by name only" }));
  }
  return checks;
}
