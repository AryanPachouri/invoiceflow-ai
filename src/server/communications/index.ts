import crypto from "node:crypto";
import { z } from "zod";
import type { Db, Queryable } from "../db";
import { env } from "../env";
import { getRun } from "../repositories/runs";
import { recordEvent } from "../repositories/events";
import { buildEmailDraft } from "./draft";
import { polishWithClaude } from "./ai-polish";

export class EmailError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "EmailError";
  }
}

const emailList = (label: string, required: boolean) =>
  z.string().trim().max(1000).optional().nullable()
    .transform((v) => (v ? v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean) : []))
    .refine((xs) => !required || xs.length > 0, `${label} is required`)
    .refine((xs) => xs.every((x) => z.string().email().safeParse(x).success), `${label} contains an invalid email address`)
    .refine((xs) => xs.length <= 10, `${label} may contain at most 10 addresses`);

export const EmailEditSchema = z.object({
  recipient_email: emailList("Recipient", false),
  cc: emailList("CC", false),
  subject: z.string().trim().min(3, "Subject is required").max(300),
  body: z.string().trim().min(10, "Email body is required").max(20000),
});

export const providerStatus = () => ({
  configured: env.emailConfigured,
  provider: env.emailConfigured ? "resend" : null,
  from: env.emailConfigured ? env.emailFrom : null,
  aiAvailable: !!env.anthropicApiKey,
  message: env.emailConfigured
    ? null
    : "Email sending isn't configured. Set RESEND_API_KEY and EMAIL_FROM on the server to enable it. Drafting and Copy Email work without it.",
});

export async function listEmails(db: Queryable, runId: string) {
  const { rows } = await db.query("SELECT * FROM email_communications WHERE run_id = $1 ORDER BY created_at DESC", [runId]);
  return rows;
}

export async function getEmail(db: Queryable, id: string) {
  const { rows } = await db.query<Record<string, unknown>>("SELECT * FROM email_communications WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/** Generate and persist a DRAFT from the run's actual decision. Never sends anything. */
export async function createDraft(db: Db, runId: string, mode: "template" | "ai" = "template") {
  const run = await getRun(db, runId);
  if (!run) throw new EmailError("Run not found", 404);
  if (run.run_status !== "COMPLETED" || !run.final_status) throw new EmailError("A vendor email can only be drafted once processing has completed with a decision");
  const draft = buildEmailDraft(run);
  let subject = draft.subject, body = draft.body, generatedBy: "TEMPLATE" | "AI" = "TEMPLATE", note: string | null = null;
  if (mode === "ai") {
    const ai = await polishWithClaude(draft);
    if ("error" in ai) note = ai.error;
    else { subject = ai.subject; body = ai.body; generatedBy = "AI"; }
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO email_communications (run_id, vendor_id, invoice_number, scenario, generated_by, recipient_email, subject, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [runId, run.vendor_id ?? null, run.invoice_number ?? null, draft.scenario, generatedBy, run.vendor_email ?? null, subject, body],
  );
  await recordEvent(db, runId, "EMAIL_DRAFTED", `Vendor email drafted (${draft.scenario.replace("_", " ").toLowerCase()}, ${generatedBy === "AI" ? "AI-polished" : "template"})`, { emailId: rows[0].id, scenario: draft.scenario });
  return { email: rows[0], note, facts: draft.facts };
}

export async function updateDraft(db: Queryable, id: string, input: unknown) {
  const parsed = EmailEditSchema.safeParse(input);
  if (!parsed.success) throw new EmailError(parsed.error.issues.map((i) => i.message).join("; "));
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE email_communications SET recipient_email = $2, cc = $3, subject = $4, body = $5, updated_at = now()
     WHERE id = $1 AND status IN ('DRAFT', 'FAILED') RETURNING *`,
    [id, parsed.data.recipient_email.join(", ") || null, parsed.data.cc.join(", ") || null, parsed.data.subject, parsed.data.body],
  );
  if (!rows[0]) {
    const existing = await getEmail(db, id);
    if (!existing) throw new EmailError("Email not found", 404);
    throw new EmailError(`This email is ${existing.status} and can no longer be edited`, 409);
  }
  return rows[0];
}

type Sender = (msg: { from: string; to: string[]; cc: string[]; subject: string; text: string; replyTo?: string; idempotencyKey: string }) =>
  Promise<{ ok: true; id: string } | { ok: false; error: string }>;

/** Resend REST API. The API key never leaves the server. */
export const resendSender: Sender = async (msg) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": msg.idempotencyKey },
      body: JSON.stringify({ from: msg.from, to: msg.to, cc: msg.cc.length ? msg.cc : undefined, subject: msg.subject, text: msg.text, reply_to: msg.replyTo }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (res.ok && body.id) return { ok: true, id: body.id };
    return { ok: false, error: `Provider rejected the email (HTTP ${res.status}${body.message ? `: ${body.message}` : ""})` };
  } catch (e) {
    return { ok: false, error: controller.signal.aborted ? "Email provider timed out. Delivery was not confirmed" : `Could not reach the email provider: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Send a reviewed draft. Exactly-once protection: the row is atomically moved DRAFT/FAILED → SENDING
 * (a second click finds it SENDING/SENT and is refused), and the provider receives a per-attempt
 * Idempotency-Key. SENT is recorded only when the provider confirms acceptance.
 */
export async function sendEmail(db: Db, id: string, sender: Sender = resendSender) {
  if (!env.emailConfigured) throw new EmailError(providerStatus().message!, 503);
  const email = await getEmail(db, id);
  if (!email) throw new EmailError("Email not found", 404);
  const to = String(email.recipient_email ?? "").split(/,\s*/).filter(Boolean);
  if (!to.length) throw new EmailError("Add a recipient email address before sending");
  const bad = [...to, ...String(email.cc ?? "").split(/,\s*/).filter(Boolean)].filter((x) => !z.string().email().safeParse(x).success);
  if (bad.length) throw new EmailError(`Invalid email address: ${bad.join(", ")}`);

  const key = crypto.randomUUID();
  const { rows: locked } = await db.query<Record<string, unknown>>(
    `UPDATE email_communications SET status = 'SENDING', idempotency_key = $2, send_attempts = send_attempts + 1, updated_at = now(), error_message = NULL
     WHERE id = $1 AND status IN ('DRAFT', 'FAILED') RETURNING *`,
    [id, key],
  );
  if (!locked[0]) throw new EmailError(email.status === "SENT" ? "This email has already been sent" : "This email is already being sent", 409);

  const result = await sender({
    from: env.emailFrom!, to, cc: String(email.cc ?? "").split(/,\s*/).filter(Boolean),
    subject: String(email.subject), text: String(email.body), replyTo: env.emailReplyTo, idempotencyKey: key,
  });
  const runId = String(email.run_id);
  if (result.ok) {
    const { rows } = await db.query<Record<string, unknown>>(
      `UPDATE email_communications SET status = 'SENT', provider = 'resend', provider_message_id = $2, sent_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, result.id],
    );
    await recordEvent(db, runId, "EMAIL_SENT", `Email sent to ${to.join(", ")} (provider id ${result.id})`, { emailId: id, providerMessageId: result.id, to });
    return rows[0];
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE email_communications SET status = 'FAILED', provider = 'resend', error_message = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, result.error],
  );
  await recordEvent(db, runId, "EMAIL_FAILED", `Email to ${to.join(", ")} failed: ${result.error}`, { emailId: id, error: result.error });
  throw Object.assign(new EmailError(result.error, 502), { email: rows[0] });
}
