/**
 * Vendor email drafting from a processing run.
 *
 * Deterministic: the scenario, every fact and every requested action come from the run's recorded
 * checks and extracted data. Nothing is invented, and internal-only findings (e.g. OCR confidence,
 * concurrency guards) are not disclosed as vendor errors.
 */
import { env } from "../env";
import { money as fmtMoney } from "../rules/types";

export type EmailScenario = "REJECTED" | "NEEDS_REVIEW" | "MISSING_INFORMATION" | "APPROVED";

export interface DraftFacts {
  scenario: EmailScenario;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  currency: string | null;
  poNumber: string | null;
  issues: { title: string; detail: string; action: string }[];
  missing: string[];
}

export interface EmailDraft {
  scenario: EmailScenario;
  subject: string;
  body: string;
  facts: DraftFacts;
}

interface CheckLike { code: string; status: string; action: string; message: string; expected?: unknown; actual?: unknown; difference?: number | null; differencePct?: number | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RunLike = Record<string, any>;

const longDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

const MISSING_FIELD_LABELS: Record<string, string> = {
  REQUIRED_INVOICENUMBER: "Invoice number",
  REQUIRED_INVOICEDATE: "Invoice date",
  REQUIRED_TOTALAMOUNT: "Clearly stated invoice total",
  REQUIRED_CURRENCY: "Invoice currency",
  REQUIRED_VENDORNAME: "Your registered company name",
};

/** Checks that are internal controls, not something the vendor did wrong. */
const INTERNAL = new Set(["EXTRACTION_CONFIDENCE", "PO_BALANCE_AT_COMMIT", "PO_ALLOCATION", "INVOICE_NUMBER_FORMAT", "CUMULATIVE_WITHIN_PO"]);

function describe(c: CheckLike, run: RunLike, inv: RunLike): { title: string; detail: string; action: string } | null {
  const ccy = inv.currency ?? run.currency ?? null;
  const m = (n: unknown) => (typeof n === "number" ? fmtMoney(n, ccy) : String(n ?? ""));
  const po = run.po_number ?? inv.poReference ?? null;
  switch (c.code) {
    case "DUPLICATE_INVOICE":
      return {
        title: "Duplicate submission",
        detail: `Invoice ${inv.invoiceNumber ?? ""} has already been submitted and processed in our accounts payable system. To avoid duplicate processing, this copy has not been approved.`.replace("Invoice  has", "This invoice has"),
        action: "If this is a different invoice, please reissue it with a unique invoice number. If it is a copy of the original, no further action is required.",
      };
    case "VENDOR_ACTIVE":
      if (String(c.actual) === "PENDING_VERIFICATION") {
        return { title: "Supplier verification in progress", detail: "Your company has been registered in our supplier records and verification is still in progress. Invoices can only be approved once verification is complete.", action: "Please make sure your supplier onboarding documents (tax registration and bank details) have been sent to our procurement team." };
      }
      return { title: "Supplier account inactive", detail: "Your company's supplier account is currently inactive in our records, so we are unable to process invoices against it.", action: "Please contact our procurement team to review and reactivate your supplier account before resubmitting this invoice." };
    case "VENDOR_EXISTS":
      return { title: "Supplier not registered", detail: `We could not match ${inv.vendorName ? `"${inv.vendorName}"` : "the issuing company"} to a registered supplier in our records.`, action: "Please confirm your registered legal entity name and tax ID, or complete our supplier onboarding process." };
    case "VENDOR_TAX_ID_CONSISTENT":
      return { title: "Tax ID does not match our records", detail: `The tax ID on the invoice (${c.actual ?? "—"}) does not match the one held in our supplier records.`, action: "Please confirm your correct tax registration number and, if it has changed, send us the updated registration certificate." };
    case "VENDOR_NAME_CONSISTENT":
      return { title: "Company name differs from our records", detail: `The company name on the invoice ("${c.actual ?? ""}") differs from the name registered with us.`, action: "Please confirm the legal entity issuing this invoice." };
    case "PO_VENDOR_MATCH":
      return { title: "Purchase order belongs to another supplier", detail: `Purchase order ${inv.poReference ?? ""} referenced on this invoice was not issued to your company.`, action: "Please verify the purchase order number and reissue the invoice against the correct purchase order." };
    case "PO_EXISTS":
      return { title: "Purchase order not found", detail: `We could not find purchase order "${inv.poReference ?? ""}" in our records.`, action: "Please confirm the purchase order number provided by our buyer and send a corrected invoice." };
    case "PO_OPEN":
      return { title: "Purchase order closed", detail: `Purchase order ${po ?? ""} is no longer open for invoicing.`, action: "Please contact your buyer to confirm which purchase order this invoice should be billed against." };
    case "PO_REFERENCE_PRESENT":
      return null; // covered by MISSING list
    case "PO_CANDIDATES":
      if (inv.poReference) return null;
      return { title: "Purchase order reference required", detail: "The invoice does not include a purchase order reference, and more than one of your open purchase orders could apply.", action: "Please provide the purchase order number this invoice relates to." };
    case "SUBTOTAL_WITHIN_PO_BALANCE": {
      if (c.status === "WARN") return null;
      return {
        title: "Invoice amount exceeds the purchase order balance",
        detail: `The invoiced amount of ${m(c.actual)} (before tax) exceeds the remaining balance of ${m(c.expected)} on purchase order ${po ?? ""} by ${m(c.difference)}${c.differencePct !== null && c.differencePct !== undefined ? ` (${c.differencePct}%)` : ""}.`,
        action: "Please send a corrected invoice within the remaining purchase order balance, or provide the approved purchase order amendment or change order that covers the additional amount.",
      };
    }
    case "LINE_ITEMS_MATCH_PO":
      return { title: "Line items differ from the purchase order", detail: c.message.replace(/"/g, "'"), action: "Please provide supporting documentation (for example an approved change order) for items or prices not covered by the purchase order, or reissue the invoice to match it." };
    case "CURRENCY_MATCH":
      return { title: "Currency differs from the purchase order", detail: `The invoice is in ${c.actual} but the purchase order is in ${c.expected}.`, action: `Please reissue the invoice in ${c.expected}.` };
    case "TAX_CALC":
      return { title: "Tax calculation discrepancy", detail: c.message.replace(/^Tax /, "The tax amount of ") + ".", action: "Please review the tax calculation and send a corrected invoice." };
    case "TOTAL_CALC":
    case "SUBTOTAL_CALC":
    case "LINE_ARITHMETIC":
      return { title: "Invoice totals do not add up", detail: c.message + ".", action: "Please review the invoice arithmetic and send a corrected invoice." };
    case "CURRENCY_ALLOWED":
      return { title: "Unsupported invoice currency", detail: `We are unable to accept invoices in ${c.actual}.`, action: "Please contact our accounts payable team to agree the invoicing currency." };
    case "AMOUNTS_NON_NEGATIVE":
      return { title: "Negative amounts", detail: "The invoice contains negative amounts.", action: "If this is a credit, please issue it as a separate credit note referencing the original invoice." };
    case "INVOICE_DATE_VALID":
      return { title: "Invoice date needs confirmation", detail: c.message + ".", action: "Please confirm the correct invoice date or send a corrected invoice." };
    case "DUE_DATE_VALID":
      return { title: "Due date before invoice date", detail: c.message + ".", action: "Please send a corrected invoice with valid dates." };
    case "DOCUMENT_READABLE":
      return null; // handled as missing information
    default:
      return null;
  }
}

export function buildEmailDraft(run: RunLike, opts: { companyName?: string } = {}): EmailDraft {
  const company = opts.companyName ?? env.companyName;
  const stages = (run.stages ?? []) as RunLike[];
  const checks: CheckLike[] = stages.flatMap((s) => s.output_data?.checks ?? []);
  const inv: RunLike = run.extracted_data?.invoice ?? {};
  const status: string = run.final_status ?? "NEEDS_REVIEW";
  const ccy = inv.currency ?? run.currency ?? null;
  const vendorName: string | null = run.vendor_name ?? inv.vendorName ?? null;
  const invoiceNumber: string | null = inv.invoiceNumber ?? run.invoice_number ?? null;
  const poNumber: string | null = run.po_number ?? inv.poReference ?? null;

  const flagged = checks.filter((c) => (c.status === "FAIL" || c.status === "WARN") && c.action !== "NONE");
  const relevant = status === "REJECTED" ? flagged.filter((c) => c.action === "REJECT") : flagged;

  const missing: string[] = [];
  for (const c of flagged) {
    if (MISSING_FIELD_LABELS[c.code] && c.status === "FAIL") missing.push(MISSING_FIELD_LABELS[c.code]);
    if (c.code === "PO_REFERENCE_PRESENT" && !inv.poReference) missing.push("Purchase order (PO) number");
    if (c.code === "DOCUMENT_READABLE" || (c.code === "EXTRACTION_CONFIDENCE" && c.status !== "PASS" && missing.length)) missing.push("A clear, text-based (not scanned) PDF copy of the invoice");
  }
  const uniqMissing = [...new Set(missing)];
  const issues = relevant
    .filter((c) => !INTERNAL.has(c.code))
    .map((c) => describe(c, run, inv))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .filter((x, i, a) => a.findIndex((y) => y.title === x.title) === i);

  let scenario: EmailScenario;
  if (status === "APPROVED") scenario = "APPROVED";
  else if (status === "REJECTED") scenario = "REJECTED";
  else if (uniqMissing.length && issues.every((i) => /reference required|not registered/i.test(i.title) || false)) scenario = "MISSING_INFORMATION";
  else scenario = "NEEDS_REVIEW";
  if (scenario === "MISSING_INFORMATION") {
    // keep only issues that aren't simply restating the missing items
    for (let i = issues.length - 1; i >= 0; i--) if (/reference required/i.test(issues[i].title)) issues.splice(i, 1);
  }

  const ref = invoiceNumber ? `invoice ${invoiceNumber}` : "your recent invoice";
  const refCap = invoiceNumber ? `Invoice ${invoiceNumber}` : "Your recent invoice";
  const amountLine = inv.totalAmount !== null && inv.totalAmount !== undefined ? fmtMoney(inv.totalAmount, ccy) : null;
  const dateText = longDate(inv.invoiceDate);
  const greeting = `Dear ${vendorName ? `${vendorName} ` : ""}Team,`;
  const subjVendor = vendorName ? ` | ${vendorName}` : "";
  const refDetails = [
    invoiceNumber && `Invoice number: ${invoiceNumber}`,
    dateText && `Invoice date: ${dateText}`,
    amountLine && `Invoice total: ${amountLine}`,
    poNumber && `Purchase order: ${poNumber}`,
  ].filter(Boolean) as string[];
  const refBlock = refDetails.length ? `\n${refDetails.map((d) => `  • ${d}`).join("\n")}\n` : "";
  const issueBlock = issues.map((x, i) => `${i + 1}. ${x.title}\n   ${x.detail}\n   What we need: ${x.action}`).join("\n\n");
  const signoff = `\nKind regards,\n\nAccounts Payable Team\n${company}`;

  let subject: string;
  let body: string;
  switch (scenario) {
    case "APPROVED":
      subject = `Invoice ${invoiceNumber ?? ""} approved${subjVendor}`.replace("Invoice  approved", "Invoice approved");
      body = `${greeting}

We're writing to confirm that ${ref}${amountLine ? ` for ${amountLine}` : ""} has been reviewed and approved in our accounts payable system${poNumber ? ` against purchase order ${poNumber}` : ""}.
${refBlock}
Approval status: Approved. No further action is required from you for this invoice.

If you have any questions, please reply to this email and quote the invoice number.
${signoff}`;
      break;
    case "REJECTED":
      subject = `Action required: ${refCap} could not be approved${subjVendor}`;
      body = `${greeting}

Thank you for submitting ${ref}. We have reviewed it, and unfortunately we are unable to approve it for the following reason${issues.length > 1 ? "s" : ""}:
${refBlock}
${issueBlock || "The invoice did not pass our accounts payable checks."}

This invoice has not been approved. Where a corrected invoice is needed, please send it to us as a PDF with a clear invoice number, invoice date and purchase order reference.

If you believe this is an error, please reply to this email with the supporting details and our team will review it.
${signoff}`;
      break;
    case "MISSING_INFORMATION":
      subject = `Information required: ${refCap}${subjVendor}`;
      body = `${greeting}

Thank you for submitting ${ref}. Before we can process it, we need the following information, which was missing or unclear on the invoice we received:
${refBlock}
${uniqMissing.map((x) => `  • ${x}`).join("\n")}
${issues.length ? `\nIn addition:\n\n${issueBlock}\n` : ""}
Please reply with the missing details, or send a corrected invoice that includes them. The invoice remains on hold until we receive this information.
${signoff}`;
      break;
    default:
      subject = `Clarification needed: ${refCap}${subjVendor}`;
      body = `${greeting}

Thank you for submitting ${ref}. During our review we identified the following item${issues.length + uniqMissing.length > 1 ? "s" : ""} that need${issues.length + uniqMissing.length > 1 ? "" : "s"} clarification before the invoice can be approved:
${refBlock}
${issueBlock || "  • The invoice is undergoing an internal review. We'll contact you if anything further is needed."}
${uniqMissing.length ? `\nPlease also provide:\n${uniqMissing.map((x) => `  • ${x}`).join("\n")}\n` : ""}
The invoice is on hold, not rejected. Once we receive the requested information or a corrected invoice, we will continue processing it.
${signoff}`;
  }
  body = body.replace(/\n{3,}/g, "\n\n").trim() + "\n";

  return {
    scenario, subject: subject.trim(), body,
    facts: { scenario, vendorName, invoiceNumber, invoiceDate: inv.invoiceDate ?? null, totalAmount: amountLine, currency: ccy, poNumber, issues, missing: uniqMissing },
  };
}
