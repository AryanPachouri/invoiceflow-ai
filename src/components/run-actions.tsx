"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Building2, CheckCircle2, ClipboardCopy, Copy, History, Loader2, Mail, Plus, RefreshCw, Save, Send, Sparkles, UserX,
} from "lucide-react";
import { api, ApiError, jsonInit } from "@/lib/api";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { Button, Card, CardHeader, EmptyState, ErrorBanner, FieldLabel, Input, Modal, StatusBadge, Textarea } from "./ui";
import { VendorFormDialog } from "./vendor-form-dialog";
import { useToast } from "./toast";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard API
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

// ---------------------------------------------------------------- vendor verification

export function VendorVerificationPanel({ run, events, onChanged }: { run: any; events: any[]; onChanged: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const vendorStage = (run.stages ?? []).find((s: any) => s.stage_key === "VENDOR_VERIFICATION");
  const out = vendorStage?.output_data;
  const unknown = out && out.matched === false;
  const pending = run.vendor_status === "PENDING_VERIFICATION";
  const created = [...events].reverse().find((e) => e.event_type === "VENDOR_CREATED");
  if (!unknown && !pending) return null;

  const canRerun = !run.superseded_by_run_id && run.final_status !== "APPROVED" && !run.duplicate_of_run_id;
  const rerun = async () => {
    setRerunning(true);
    try {
      const r = await api<{ runId: string; runNumber: number }>(`/api/runs/${run.id}/reprocess`, jsonInit("POST", { reason: created ? `Vendor ${created.details?.vendorCode ?? ""} registered` : "Vendor master updated" }));
      toast({ tone: "success", title: `Re-processing as run #${r.runNumber}`, description: `Run #${run.run_number} and its decision are preserved for audit.` });
      router.push(`/runs/${r.runId}`);
    } catch (e) {
      toast({ tone: "error", title: "Could not re-run verification", description: e instanceof Error ? e.message : String(e) });
      setRerunning(false);
    }
  };

  return (
    <Card className={clsx("overflow-hidden", unknown && !created ? "border-amber-200" : "")}>
      <CardHeader title="Vendor verification" subtitle={unknown ? "Status: Vendor not found" : "Status: Vendor pending verification"}
        action={<StatusBadge status={unknown && !created ? "NEEDS_REVIEW" : "PENDING_VERIFICATION"} />} />
      <div className="space-y-4 p-5">
        {unknown && !created && (
          <>
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><UserX className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-medium text-slate-900">{run.vendor_name_extracted ? `"${run.vendor_name_extracted}"` : "This vendor"} is not currently registered in your vendor database.</p>
                <p className="mt-1 text-xs text-slate-500">Register it to keep vendor master data complete. New vendors start as <b>Pending verification</b>, so this invoice won&apos;t be approved until the vendor is verified and every other check passes.</p>
              </div>
            </div>
            <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add Vendor</Button>
          </>
        )}
        {(created || pending) && (
          <>
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600"><Building2 className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {created ? created.message : `${run.vendor_name} is registered but pending verification.`}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Vendor registration and invoice approval are separate decisions. Re-running links this invoice to the vendor master and re-evaluates verification, matching and the decision as a new run. This run&apos;s original decision stays on record.
                  {" "}<Link href="/vendors" className="font-medium text-blue-600 hover:underline">Verify &amp; activate on the Vendors page</Link> to allow approval.
                </p>
              </div>
            </div>
            {canRerun ? (
              <Button onClick={rerun} disabled={rerunning}>{rerunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Re-run verification &amp; matching</Button>
            ) : run.superseded_by_run_id ? (
              <p className="text-xs text-slate-500">Already re-processed as <Link className="font-medium text-blue-600 hover:underline" href={`/runs/${run.superseded_by_run_id}`}>run #{run.superseded_by_run_number}</Link>.</p>
            ) : null}
          </>
        )}
      </div>
      {adding && (
        <VendorFormDialog runId={run.id} onClose={() => setAdding(false)} onCreated={(v) => {
          setAdding(false);
          toast({ tone: "success", title: `Vendor ${v.vendor_name} added`, description: `${v.vendor_code} · Pending verification. Re-run verification to link this invoice.` });
          onChanged();
        }} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- vendor communication

const SCENARIO_COPY: Record<string, string> = {
  APPROVED: "Confirm to the vendor that the invoice has been approved.",
  REJECTED: "Explain why the invoice could not be approved and what the vendor should do.",
  NEEDS_REVIEW: "Ask the vendor to clarify the discrepancies found during review.",
};

export function VendorCommunication({ run }: { run: any }) {
  const toast = useToast();
  const [emails, setEmails] = useState<any[] | null>(null);
  const [provider, setProvider] = useState<{ configured: boolean; aiAvailable: boolean; message: string | null; from: string | null } | null>(null);
  const [drafting, setDrafting] = useState<null | "template" | "ai">(null);
  const [open, setOpen] = useState<any>(null);

  const load = useCallback(async () => {
    const [e, p] = await Promise.all([api<any[]>(`/api/runs/${run.id}/emails`), api<any>("/api/email/status")]);
    setEmails(e);
    setProvider(p);
  }, [run.id]);
  useEffect(() => { load().catch(() => setEmails([])); }, [load]);

  const draft = async (mode: "template" | "ai") => {
    setDrafting(mode);
    try {
      const res = await api<{ email: any; note: string | null }>(`/api/runs/${run.id}/emails`, jsonInit("POST", { mode }));
      if (res.note) toast({ tone: "warning", title: "Used the standard template", description: res.note });
      setOpen(res.email);
      load();
    } catch (e) {
      toast({ tone: "error", title: "Could not draft email", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDrafting(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Vendor communication" subtitle={SCENARIO_COPY[run.final_status] ?? "Email the vendor about this invoice."}
        action={<div className="flex flex-wrap gap-2">
          {provider?.aiAvailable && <Button size="sm" onClick={() => draft("ai")} disabled={!!drafting}>{drafting === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Draft with AI</Button>}
          <Button size="sm" variant="primary" onClick={() => draft("template")} disabled={!!drafting}>{drafting === "template" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}Draft Email to Vendor</Button>
        </div>} />
      {provider && !provider.configured && (
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-xs text-slate-600">
          <b>Sending is not configured.</b> {provider.message}
        </div>
      )}
      {!emails ? <div className="p-5 text-xs text-slate-400">Loading…</div> : !emails.length ? (
        <EmptyState title="No vendor emails yet" description="Drafts use this run's actual decision, amounts and reasons. Nothing is ever sent automatically." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {emails.map((e) => (
            <li key={e.id}>
              <button onClick={() => setOpen(e)} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{e.subject}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    To {e.recipient_email || <span className="text-amber-600">no recipient yet</span>} · {e.scenario.replace("_", " ").toLowerCase()} · {e.generated_by === "AI" ? "AI-polished" : "template"}
                    {" · "}{e.status === "SENT" ? `sent ${fmtDateTime(e.sent_at)}` : `created ${timeAgo(e.created_at)}`}
                  </div>
                  {e.status === "FAILED" && e.error_message && <div className="mt-0.5 truncate text-xs text-red-600">{e.error_message}</div>}
                </div>
                <StatusBadge status={e.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && provider && (
        <EmailComposer email={open} provider={provider} onClose={() => setOpen(null)} onChanged={(e) => { setOpen(e); load(); }} />
      )}
    </Card>
  );
}

function EmailComposer({ email, provider, onClose, onChanged }: {
  email: any; provider: { configured: boolean; message: string | null; from: string | null }; onClose: () => void; onChanged: (e: any) => void;
}) {
  const toast = useToast();
  const editable = email.status === "DRAFT" || email.status === "FAILED";
  const [f, setF] = useState({ recipient_email: email.recipient_email ?? "", cc: email.cc ?? "", subject: email.subject, body: email.body });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setDirty(true); setError(null); };

  const save = async (quiet = false) => {
    setSaving(true);
    try {
      const updated = await api<any>(`/api/emails/${email.id}`, jsonInit("PATCH", f));
      setDirty(false);
      onChanged(updated);
      if (!quiet) toast({ tone: "success", title: "Draft saved" });
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const copy = async (what: "all" | "subject" | "body") => {
    const text = what === "subject" ? f.subject : what === "body" ? f.body : `Subject: ${f.subject}\n\n${f.body}`;
    const ok = await copyText(text);
    toast(ok
      ? { tone: "success", title: what === "all" ? "Email copied" : `${what === "subject" ? "Subject" : "Body"} copied`, description: what === "all" ? "Paste it into Gmail, Outlook or any email client." : undefined }
      : { tone: "error", title: "Copy failed", description: "Your browser blocked clipboard access. Select the text and copy it manually." });
  };

  const requestSend = async () => {
    setError(null);
    if (!f.recipient_email.trim()) { setError("Add a recipient email address before sending."); return; }
    if (dirty && !(await save(true))) return;
    setConfirming(true);
  };

  const send = async () => {
    setSending(true);
    try {
      const sent = await api<any>(`/api/emails/${email.id}/send`, { method: "POST" });
      toast({ tone: "success", title: "Email sent", description: `Accepted by the provider for delivery to ${sent.recipient_email} (id ${sent.provider_message_id}).` });
      setConfirming(false);
      onChanged(sent);
    } catch (e) {
      const body = e instanceof ApiError ? e.body : null;
      setConfirming(false);
      setError(e instanceof Error ? e.message : String(e));
      toast({ tone: "error", title: "Email not sent", description: e instanceof Error ? e.message : String(e) });
      if (body?.email) onChanged(body.email);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Modal size="lg" onClose={onClose}
        title={<span className="flex items-center gap-2">Email to vendor <StatusBadge status={email.status} /></span>}
        subtitle={email.status === "SENT" ? `Sent ${fmtDateTime(email.sent_at)} · provider id ${email.provider_message_id}` : "Review and edit before copying or sending. Nothing is sent without your confirmation."}
        footer={<>
          <Button size="sm" variant="ghost" onClick={() => copy("subject")}><Copy className="h-3.5 w-3.5" />Subject</Button>
          <Button size="sm" variant="ghost" onClick={() => copy("body")}><Copy className="h-3.5 w-3.5" />Body</Button>
          <Button size="sm" onClick={() => copy("all")}><ClipboardCopy className="h-3.5 w-3.5" />Copy Email</Button>
          {editable && <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save draft</Button>}
          {editable && (
            <Button size="sm" variant="primary" onClick={requestSend} disabled={!provider.configured || sending || saving}
              title={provider.configured ? undefined : provider.message ?? "Email sending is not configured"}>
              <Send className="h-3.5 w-3.5" />{email.status === "FAILED" ? "Retry send" : "Send Email"}
            </Button>
          )}
        </>}
      >
        <div className="space-y-3">
          {!provider.configured && editable && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Sending is disabled: {provider.message}</p>
          )}
          {email.status === "FAILED" && email.error_message && <ErrorBanner message={`Last attempt failed: ${email.error_message}`} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="To" required hint={email.recipient_email ? "Vendor's registered email" : "No registered vendor email. Enter one manually"}>
              <Input value={f.recipient_email} onChange={(e) => set("recipient_email", e.target.value)} disabled={!editable} className="w-full" placeholder="vendor@example.com" />
            </FieldLabel>
            <FieldLabel label="CC" hint="Optional, comma-separated">
              <Input value={f.cc} onChange={(e) => set("cc", e.target.value)} disabled={!editable} className="w-full" placeholder="ap-team@yourcompany.com" />
            </FieldLabel>
          </div>
          {provider.from && <p className="text-[11px] text-slate-400">From: {provider.from}</p>}
          <FieldLabel label="Subject" required>
            <Input value={f.subject} onChange={(e) => set("subject", e.target.value)} disabled={!editable} className="w-full" />
          </FieldLabel>
          <FieldLabel label="Message" required>
            <Textarea value={f.body} onChange={(e) => set("body", e.target.value)} disabled={!editable} rows={16} className="font-sans leading-relaxed" />
          </FieldLabel>
          {error && <ErrorBanner message={error} />}
        </div>
      </Modal>
      {confirming && (
        <Modal size="sm" title="Send this email?" onClose={() => !sending && setConfirming(false)}
          footer={<>
            <Button onClick={() => setConfirming(false)} disabled={sending}>Cancel</Button>
            <Button variant="primary" onClick={send} disabled={sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{sending ? "Sending…" : "Send now"}</Button>
          </>}>
          <div className="space-y-2 text-sm text-slate-700">
            <p>This will email <b>{f.recipient_email}</b>{f.cc ? <> (cc {f.cc})</> : null} with the subject:</p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-800">{f.subject}</p>
            <p className="text-xs text-slate-500">Sent emails can&apos;t be recalled. The send is recorded in this invoice&apos;s communication history.</p>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- audit trail

const EVENT_ICON: Record<string, typeof CheckCircle2> = {
  VENDOR_CREATED: Building2, SUPERSEDED: History, REPROCESSED_FROM: RefreshCw, EMAIL_DRAFTED: Mail, EMAIL_EDITED: Mail, EMAIL_SENT: Send, EMAIL_FAILED: Mail,
};

export function ActivityLog({ events }: { events: any[] }) {
  if (!events.length) return null;
  return (
    <Card>
      <CardHeader title="Activity & audit trail" subtitle="Actions taken after processing. The original decision is never modified." />
      <ol className="space-y-3 p-5">
        {events.map((e) => {
          const Icon = EVENT_ICON[e.event_type] ?? History;
          return (
            <li key={e.id} className="flex gap-3">
              <span className={clsx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                e.event_type === "EMAIL_FAILED" ? "bg-red-50 text-red-600" : e.event_type === "EMAIL_SENT" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500")}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-slate-700">{e.message}</p>
                <p className="text-[11px] text-slate-400">{fmtDateTime(e.created_at)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
