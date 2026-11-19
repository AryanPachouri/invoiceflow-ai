import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { executeRun, prepareReprocess, processInvoice } from "@/server/pipeline";
import { getMetrics, getRun } from "@/server/repositories/runs";
import { listEvents } from "@/server/repositories/events";
import { createVendorRecord, setVendorStatus, vendorPrefill, VendorConflictError, VendorInputSchema } from "@/server/vendors/service";
import { createDraft, EmailError, sendEmail, updateDraft } from "@/server/communications";
import { ungroundedTokens } from "@/server/communications/ai-polish";
import { freshDb, pdf } from "../helpers";

const sample = (f: string) => fs.readFileSync(path.join(process.cwd(), "public", "samples", f));
const checks = (run: Record<string, any>) => (run.stages as Record<string, any>[]).flatMap((s) => s.output_data?.checks ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any

const initech = () => pdf({
  layout: "classic",
  vendor: { name: "Initech Supplies Ltd", address: "9 Lumbergh Way, Austin, TX 78701, USA", taxId: "12-3456789", email: "billing@initech.example" },
  invoiceNumber: "INI-2026-077", invoiceDate: "2026-11-12", dueDate: "2026-12-12", currency: "USD", taxRate: 0,
  items: [{ description: "Printer Toner Cartridge", quantity: 10, unitPrice: 85 }],
});

describe("Add vendor from processing result", () => {
  let db: Db;
  beforeAll(async () => { db = await freshDb(); });

  it("prefills from the invoice, creates a PENDING vendor, blocks duplicates, and never auto-approves", async () => {
    const original = await processInvoice({ filename: "initech.pdf", data: await initech() });
    expect(original.final_status).toBe("NEEDS_REVIEW");
    expect(checks(original).find((c) => c.code === "VENDOR_EXISTS").status).toBe("FAIL");

    const pre = (await vendorPrefill(db, original.id))!;
    expect(pre.vendor_name).toEqual({ value: "Initech Supplies Ltd", source: "invoice header" });
    expect(pre.vendor_tax_id.value).toBe("12-3456789");
    expect(pre.email.value).toBe("billing@initech.example");
    expect(pre.email.source).toMatch(/verify/);

    const input = VendorInputSchema.parse({ vendor_name: pre.vendor_name.value, vendor_tax_id: pre.vendor_tax_id.value, address: pre.address.value, email: pre.email.value, default_currency: "USD", status: "PENDING_VERIFICATION", source_run_id: original.id });
    const vendor = await createVendorRecord(db, input);
    expect(vendor.status).toBe("PENDING_VERIFICATION");
    expect(vendor.source).toBe("INVOICE");

    // duplicates: same name (any case / punctuation) or same tax ID
    await expect(createVendorRecord(db, { ...input, vendor_name: "INITECH SUPPLIES LTD." })).rejects.toBeInstanceOf(VendorConflictError);
    await expect(createVendorRecord(db, { ...input, vendor_name: "Totally Different Co", vendor_tax_id: "12 3456789" })).rejects.toThrow(/already registered/);
    await expect(createVendorRecord(db, { ...input, vendor_name: "Apex Industrial Supplies Inc", vendor_tax_id: null })).rejects.toThrow(/already exists/);

    // re-run creates a NEW run; the original decision is preserved and superseded
    const re = await prepareReprocess(original.id, "Vendor registered");
    await executeRun(re.id, re.data, re.filename, { paced: false });
    const rerun = (await getRun(db, re.id))!;
    const before = (await getRun(db, original.id))!;
    expect(before.final_status).toBe("NEEDS_REVIEW");
    expect(before.superseded_by_run_id).toBe(re.id);
    expect(rerun.reprocessed_from_run_id).toBe(original.id);
    expect(rerun.vendor_id).toBe(vendor.id);
    expect(rerun.final_status).toBe("NEEDS_REVIEW"); // pending vendor ⇒ still not approved
    expect(checks(rerun).find((c) => c.code === "VENDOR_ACTIVE")).toMatchObject({ status: "FAIL", action: "REVIEW" });
    // the re-run is not flagged as a duplicate of the run it supersedes
    expect(checks(rerun).find((c) => c.code === "DUPLICATE_INVOICE").status).toBe("PASS");

    const events = await listEvents(db, original.id);
    expect(events.map((e) => e.event_type)).toEqual(["VENDOR_CREATED", "SUPERSEDED"]);
    await expect(prepareReprocess(original.id, "again")).rejects.toThrow(/already re-processed/);

    // superseded runs are not double counted on the dashboard
    const m = await getMetrics(db, true);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM processing_runs WHERE run_status = 'COMPLETED' AND superseded_by_run_id IS NULL");
    expect(m.processed).toBe(Number(rows[0].n));

    // verifying the vendor lets the vendor checks pass on the next re-run (approval still depends on PO etc.)
    await setVendorStatus(db, vendor.id as string, "ACTIVE");
    const re2 = await prepareReprocess(re.id, "Vendor verified");
    await executeRun(re2.id, re2.data, re2.filename, { paced: false });
    const third = (await getRun(db, re2.id))!;
    expect(checks(third).find((c) => c.code === "VENDOR_ACTIVE").status).toBe("PASS");
    expect(third.final_status).toBe("NEEDS_REVIEW"); // no PO on the invoice → still needs review
  });

  it("validates vendor input (required, email, GSTIN)", () => {
    const base = { vendor_name: "Shakti Traders", default_currency: "INR", status: "PENDING_VERIFICATION" };
    expect(VendorInputSchema.safeParse({ ...base, vendor_name: "" }).success).toBe(false);
    expect(VendorInputSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(VendorInputSchema.safeParse({ ...base, vendor_tax_id: "27AAPFU0939F1AV" }).success).toBe(false); // bad GSTIN: 14th char must be Z
    expect(VendorInputSchema.safeParse({ ...base, vendor_tax_id: "27AAPFU0939F1ZV" }).success).toBe(true);
    expect(VendorInputSchema.safeParse({ ...base, vendor_tax_id: "84-3920175", email: "a@b.co" }).success).toBe(true);
  });
});

describe("Vendor email drafting and sending", () => {
  let db: Db;
  const env = { ...process.env };
  beforeAll(async () => { db = await freshDb(); });
  afterEach(() => { process.env.RESEND_API_KEY = env.RESEND_API_KEY; process.env.EMAIL_FROM = env.EMAIL_FROM; });

  it("drafts a rejection email for a duplicate with the real invoice details", async () => {
    const run = await processInvoice({ filename: "03.pdf", data: sample("03-apex-duplicate.pdf") });
    const { email } = await createDraft(db, run.id);
    expect(email.scenario).toBe("REJECTED");
    expect(email.status).toBe("DRAFT");
    expect(email.recipient_email).toBe("billing@apexindustrial.example"); // vendor's registered email
    expect(email.subject).toContain("INV-APX-2026-0398");
    expect(email.body).toMatch(/already been submitted/);
    expect(email.body).toMatch(/has not been approved/);
  });

  it("drafts a clarification email for an amount mismatch with exact figures", async () => {
    const run = await processInvoice({ filename: "04.pdf", data: sample("04-summit-amount-mismatch.pdf") });
    const { email } = await createDraft(db, run.id);
    expect(email.scenario).toBe("NEEDS_REVIEW");
    expect(email.body).toContain("USD 5,750.00");
    expect(email.body).toContain("USD 4,500.00");
    expect(email.body).toContain("USD 1,250.00");
    expect(email.body).toContain("PO-2026-0172");
    expect(email.body).toMatch(/Emergency HVAC Repair/);
    expect(email.body).not.toMatch(/confidence|OCR/i); // internal controls are not disclosed
  });

  it("drafts a missing-information request listing the missing fields", async () => {
    const run = await processInvoice({ filename: "06.pdf", data: sample("06-orion-missing-fields.pdf") });
    const { email } = await createDraft(db, run.id);
    expect(email.scenario).toBe("MISSING_INFORMATION");
    expect(email.body).toMatch(/• Invoice number/);
    expect(email.body).toMatch(/• Invoice date/);
  });

  it("drafts an approval confirmation without promising payment", async () => {
    const run = await processInvoice({ filename: "01.pdf", data: sample("01-apex-happy-path.pdf") });
    const { email } = await createDraft(db, run.id);
    expect(email.scenario).toBe("APPROVED");
    expect(email.subject).toMatch(/approved/i);
    expect(email.body).toContain("USD 12,744.00");
    expect(email.body).toContain("PO-2026-0141");
    expect(email.body).not.toMatch(/paid|payment (has been|will be) (made|scheduled)/i);
  });

  it("edits drafts with validation, and refuses to send when no provider is configured", async () => {
    const run = await processInvoice({ filename: "08.pdf", data: sample("08-brightline-tax-error.pdf") });
    const { email } = await createDraft(db, run.id);
    await expect(updateDraft(db, email.id as string, { recipient_email: "nope", subject: "Hi there", body: "A sufficiently long body" })).rejects.toThrow(/invalid email/);
    const edited = await updateDraft(db, email.id as string, { recipient_email: "ar@brightline.example", cc: "ap@contoso.example", subject: "Edited subject", body: "Edited body text for the vendor." });
    expect(edited).toMatchObject({ subject: "Edited subject", cc: "ap@contoso.example" });
    delete process.env.RESEND_API_KEY;
    const err = await sendEmail(db, email.id as string).catch((e) => e);
    expect(err).toBeInstanceOf(EmailError);
    expect(err.status).toBe(503);
    const { rows } = await db.query<{ status: string }>("SELECT status FROM email_communications WHERE id = $1", [email.id]);
    expect(rows[0].status).toBe("DRAFT"); // nothing simulated
  });

  it("records SENT only on provider acceptance, blocks duplicate sends, records failures, and allows retry", async () => {
    process.env.RESEND_API_KEY = "re_test_dummy";
    process.env.EMAIL_FROM = "AP <ap@contoso.example>";
    const run = await processInvoice({ filename: "05.pdf", data: sample("05-brightline-missing-po.pdf") });
    const { email } = await createDraft(db, run.id);
    expect(email.recipient_email).toBe("ar@brightline.example");

    let calls = 0;
    const failing = async () => { calls++; return { ok: false as const, error: "Provider rejected the email (HTTP 422: invalid from)" }; };
    const failed = await sendEmail(db, email.id as string, failing).catch((e) => e);
    expect(failed).toBeInstanceOf(EmailError);
    let row = (await db.query<Record<string, unknown>>("SELECT * FROM email_communications WHERE id = $1", [email.id])).rows[0];
    expect(row).toMatchObject({ status: "FAILED", error_message: "Provider rejected the email (HTTP 422: invalid from)", sent_at: null });

    const keys: string[] = [];
    const ok = async (m: { idempotencyKey: string }) => { calls++; keys.push(m.idempotencyKey); await new Promise((r) => setTimeout(r, 20)); return { ok: true as const, id: "msg_123" }; };
    // two concurrent clicks: exactly one reaches the provider
    const results = await Promise.allSettled([sendEmail(db, email.id as string, ok), sendEmail(db, email.id as string, ok)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(keys).toHaveLength(1);
    row = (await db.query<Record<string, unknown>>("SELECT * FROM email_communications WHERE id = $1", [email.id])).rows[0];
    expect(row).toMatchObject({ status: "SENT", provider_message_id: "msg_123", send_attempts: 2 });
    expect(row.sent_at).toBeTruthy();
    await expect(sendEmail(db, email.id as string, ok)).rejects.toThrow(/already been sent/);
    await expect(updateDraft(db, email.id as string, { recipient_email: "x@y.co", subject: "Change", body: "Changed body text here" })).rejects.toThrow(/can no longer be edited/);
    expect(calls).toBe(2);

    const types = (await listEvents(db, run.id)).map((e) => e.event_type);
    expect(types).toEqual(["EMAIL_DRAFTED", "EMAIL_FAILED", "EMAIL_SENT"]);
  });

  it("AI grounding check rejects values not present in the deterministic draft", () => {
    const src = "Invoice SFM-11873 for USD 5,750.00 exceeds PO-2026-0172 by USD 1,250.00 (27.78%).";
    expect(ungroundedTokens("Invoice SFM-11873 exceeds PO-2026-0172 by USD 1,250.00.", src)).toEqual([]);
    expect(ungroundedTokens("Invoice SFM-11873 exceeds by USD 1,300.00 and is due 15 December.", src)).toEqual(expect.arrayContaining(["1300.00", "15"]));
  });
});
