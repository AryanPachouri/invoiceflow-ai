"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Download, ExternalLink, FileJson, History, Loader2, RotateCcw, ScrollText, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtDuration, fmtMoney, fmtTime } from "@/lib/format";
import { Button, Card, CardHeader, ErrorBanner, KV, SampleTag, Spinner, StageIcon, StatusBadge, runStatus } from "@/components/ui";
import { CheckList, StageOutput, type CheckT } from "@/components/stage-details";
import { ActivityLog, VendorCommunication, VendorVerificationPanel } from "@/components/run-actions";

const DESCRIPTIONS: Record<string, string> = {
  INGESTION: "Validate the PDF, assign a run ID, fingerprint and store the original file",
  EXTRACTION: "Read the text layer (OCR for scanned pages) and extract structured fields",
  VALIDATION: "Check required fields, formats, dates, currency and invoice arithmetic",
  VENDOR_VERIFICATION: "Match the vendor against the approved vendor master",
  DUPLICATE_DETECTION: "Atomically claim vendor + invoice number and document fingerprint",
  PO_MATCHING: "Find the purchase order by reference, or search for candidate POs",
  RECONCILIATION: "Compare amounts, currency and lines with the PO balance within tolerance",
  DECISION: "Apply deterministic business rules and commit the PO allocation",
  REPORT: "Assemble the processing report and persist the outcome",
};

interface Stage {
  stage_order: number; stage_key: string; stage_name: string; stage_status: string; outcome: string | null; summary: string | null;
  output_data: any; input_data: any; error_message: string | null; logs: { t: string; level: string; msg: string }[];
  started_at: string | null; completed_at: string | null; duration: number | null;
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showLog, setShowLog] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [events, setEvents] = useState<any[]>([]);
  const loadEvents = useCallback(() => { api<any[]>(`/api/runs/${id}/events`).then(setEvents).catch(() => undefined); }, [id]);

  const active = run && (run.run_status === "QUEUED" || run.run_status === "PROCESSING");

  const load = useCallback(async () => {
    try {
      const r = await api<any>(`/api/runs/${id}`);
      setRun(r);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) setNotFound(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  // Poll the persisted state while the run is in flight (survives page refresh).
  useEffect(() => { load(); loadEvents(); }, [load, loadEvents]);
  useEffect(() => {
    if (run && !active) return;
    const t = setInterval(load, 700);
    return () => clearInterval(t);
  }, [active, run, load]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);

  const stages: Stage[] = useMemo(() => run?.stages ?? [], [run]);
  const allChecks: CheckT[] = useMemo(() => stages.flatMap((s) => s.output_data?.checks ?? []), [stages]);
  const runLog = useMemo(() => stages.flatMap((s) => (s.logs ?? []).map((l) => ({ ...l, stage: s.stage_name }))).sort((a, b) => a.t.localeCompare(b.t)), [stages]);

  const isOpen = (s: Stage) => open[s.stage_key] ?? (s.stage_status === "FAILED" || (s.stage_status === "COMPLETED" && s.outcome === "WARN" && s.stage_key !== "DECISION"));

  if (notFound) return <div className="py-20 text-center"><p className="text-sm text-slate-600">Run not found.</p><Link href="/history" className="mt-2 inline-block text-sm text-blue-600">Back to history</Link></div>;
  if (!run) return error ? <ErrorBanner message={error} onRetry={load} /> : <Spinner label="Loading run…" />;

  const status = runStatus(run);
  const done = stages.filter((s) => ["COMPLETED", "FAILED", "SKIPPED"].includes(s.stage_status)).length;
  const current = stages.find((s) => s.stage_status === "RUNNING");
  const elapsed = run.duration ?? (now - new Date(run.started_at).getTime());
  const decision = run.decision;
  const ex = stages.find((s) => s.stage_key === "EXTRACTION")?.output_data?.invoice;
  const poOut = stages.find((s) => s.stage_key === "PO_MATCHING")?.output_data;
  const recon = stages.find((s) => s.stage_key === "RECONCILIATION")?.output_data;

  const retry = async () => {
    setRetrying(true);
    try { await api(`/api/runs/${id}/retry`, { method: "POST" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRetrying(false); }
  };

  return (
    <>
      <Link href="/history" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" />Processing history</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Run #{run.run_number}</h1>
            <StatusBadge status={status} />
            {run.is_sample && <SampleTag />}
            {run.attempt > 1 && <span className="text-xs text-slate-400">attempt {run.attempt}</span>}
          </div>
          <p className="mt-1 text-sm text-slate-500">{run.filename} · started {fmtDateTime(run.started_at)} · <span className="font-mono text-xs">{run.id}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.file_path && <a href={`/api/runs/${id}/document`} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink className="h-3.5 w-3.5" />Original PDF</Button></a>}
          {!active && <a href={`/api/runs/${id}/report?format=pdf`}><Button size="sm"><Download className="h-3.5 w-3.5" />Report PDF</Button></a>}
          {!active && <a href={`/api/runs/${id}/report?format=json`}><Button size="sm"><FileJson className="h-3.5 w-3.5" />JSON</Button></a>}
          {run.run_status === "FAILED" && <Button size="sm" variant="primary" onClick={retry} disabled={retrying}>{retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Retry run</Button>}
        </div>
      </div>
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
      {run.superseded_by_run_id && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <History className="h-4 w-4 text-slate-500" />
          This decision was superseded: the invoice was re-processed as{" "}
          <Link className="font-semibold text-blue-600 hover:underline" href={`/runs/${run.superseded_by_run_id}`}>run #{run.superseded_by_run_number}</Link>.
          The original result below is kept for the audit trail.
        </div>
      )}
      {run.reprocessed_from_run_id && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-slate-700">
          <RotateCcw className="h-4 w-4 text-blue-600" />
          Re-processed from{" "}
          <Link className="font-semibold text-blue-600 hover:underline" href={`/runs/${run.reprocessed_from_run_id}`}>run #{run.reprocessed_from_run_number}</Link>
          after a vendor master update. All checks were re-evaluated from scratch.
        </div>
      )}

      {/* Live progress / final decision banner */}
      {active ? (
        <Card className="mb-6 border-blue-200 bg-blue-50/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <div>
                <div className="text-sm font-semibold text-slate-900">Processing{current ? `: ${current.stage_name}` : run.run_status === "QUEUED" ? ": queued" : "…"}</div>
                <div className="text-xs text-slate-500">Stage {Math.min(done + 1, 9)} of 9 · {fmtDuration(Math.max(elapsed, 0))} elapsed · statuses update as the server persists them</div>
              </div>
            </div>
            <div className="tabular text-sm font-semibold text-blue-700">{Math.round((done / 9) * 100)}%</div>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-blue-100"><div className="h-1.5 rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${(done / 9) * 100}%` }} /></div>
        </Card>
      ) : run.run_status === "FAILED" ? (
        <Card className="mb-6 border-slate-300 bg-slate-50 p-5">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-5 w-5 text-slate-600" />
            <div>
              <div className="text-sm font-semibold text-slate-900">Processing failed (system error). No decision was made</div>
              <p className="mt-1 text-sm text-slate-600">{run.error_message}</p>
              <p className="mt-1 text-xs text-slate-500">The failure is recorded. Retrying reuses the stored document and is safe: duplicate claims and PO allocations are keyed to this run.</p>
            </div>
          </div>
        </Card>
      ) : <DecisionBanner run={run} decision={decision} />}

      {run.run_status === "COMPLETED" && run.final_status && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <VendorVerificationPanel run={run} events={events} onChanged={() => { load(); loadEvents(); }} />
          <div className={run.vendor_status === "PENDING_VERIFICATION" || stages.find((s) => s.stage_key === "VENDOR_VERIFICATION")?.output_data?.matched === false ? "" : "lg:col-span-2"}>
            <VendorCommunication run={run} />
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Execution timeline" subtitle="Nine backend stages. Each status, timing and output is read from the database." />
          <ol className="relative px-5 py-4">
            {stages.map((s, i) => {
              const expandable = !!s.output_data || !!s.error_message;
              const expanded = expandable && isOpen(s);
              return (
                <li key={s.stage_key} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < stages.length - 1 && <span className={clsx("absolute left-[13px] top-8 h-[calc(100%-1.75rem)] w-0.5", ["COMPLETED", "FAILED", "SKIPPED"].includes(s.stage_status) ? "bg-slate-200" : "bg-slate-100")} />}
                  <div className="relative z-10"><StageIcon status={s.stage_status} outcome={s.outcome} /></div>
                  <div className="min-w-0 flex-1">
                    <button disabled={!expandable} onClick={() => setOpen({ ...open, [s.stage_key]: !expanded })} className="flex w-full items-start justify-between gap-3 text-left disabled:cursor-default">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{s.stage_order}. {s.stage_name}</span>
                          <StageStatus s={s} />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{DESCRIPTIONS[s.stage_key]}</p>
                        {s.summary && <p className={clsx("mt-1 text-xs font-medium", s.stage_status === "FAILED" ? "text-red-700" : s.outcome === "WARN" ? "text-amber-700" : "text-slate-700")}>{s.summary}</p>}
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        <div className="text-right text-[11px] leading-4 text-slate-400">
                          {s.started_at && <div>{fmtTime(s.started_at)}{s.completed_at ? ` → ${fmtTime(s.completed_at)}` : ""}</div>}
                          {s.stage_status === "RUNNING" && s.started_at && <div className="text-blue-600">{fmtDuration(Math.max(now - new Date(s.started_at).getTime(), 0))}</div>}
                          {s.duration !== null && s.stage_status !== "SKIPPED" && <div className="tabular font-medium text-slate-500">{fmtDuration(s.duration)}</div>}
                        </div>
                        {expandable && (expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />)}
                      </div>
                    </button>
                    {expanded && (
                      <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
                        {s.error_message && s.stage_status === "FAILED" && <p className="text-xs text-red-700"><span className="font-semibold">Error: </span>{s.error_message}</p>}
                        <StageOutput stageKey={s.stage_key} o={s.output_data} />
                        {s.logs?.length > 0 && (
                          <details className="text-[11px]">
                            <summary className="cursor-pointer text-slate-500">Stage log ({s.logs.length})</summary>
                            <ul className="mt-1 space-y-0.5 font-mono text-slate-600">{s.logs.map((l, j) => <li key={j} className={clsx(l.level === "warn" && "text-amber-700", l.level === "error" && "text-red-700")}>{fmtTime(l.t)} {l.msg}</li>)}</ul>
                          </details>
                        )}
                        <details className="text-[11px]">
                          <summary className="cursor-pointer text-slate-500">Raw stage output (JSON)</summary>
                          <pre className="mt-1 max-h-72 overflow-auto rounded bg-code p-2 text-[10px] text-code-fg">{JSON.stringify({ input: s.input_data, output: s.output_data }, null, 2)}</pre>
                        </details>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-slate-100 px-5 py-3">
            <button onClick={() => setShowLog(!showLog)} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
              <ScrollText className="h-3.5 w-3.5" />{showLog ? "Hide" : "Show"} execution log ({runLog.length} entries)
            </button>
            {showLog && (
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-code p-3 text-[11px] leading-5 text-code-fg">
                {runLog.map((l) => `${fmtTime(l.t)}  ${l.level.toUpperCase().padEnd(5)} ${l.msg}`).join("\n") || "No log entries yet."}
              </pre>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Invoice summary" subtitle="Extracted from the document" />
            {ex ? (
              <dl className="grid grid-cols-2 gap-4 p-5">
                <div className="col-span-2"><KV label="Vendor">{run.vendor_name ?? ex.vendorName ?? <span className="text-amber-600">Not found</span>}</KV></div>
                <KV label="Invoice #">{ex.invoiceNumber ?? <span className="text-amber-600">Missing</span>}</KV>
                <KV label="Invoice date">{ex.invoiceDate ? fmtDate(ex.invoiceDate) : <span className="text-amber-600">Missing</span>}</KV>
                <KV label="PO reference">{ex.poReference ?? <span className="text-amber-600">None</span>}</KV>
                <KV label="Due date">{fmtDate(ex.dueDate)}</KV>
                <KV label="Subtotal">{fmtMoney(ex.subtotal, ex.currency)}</KV>
                <KV label="Tax">{fmtMoney(ex.taxAmount, ex.currency)}</KV>
                {ex.discountAmount ? <div className="col-span-2"><KV label="Discount">−{fmtMoney(ex.discountAmount, ex.currency)}</KV></div> : null}
                <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-2"><KV label="Total"><span className="text-lg font-semibold">{fmtMoney(ex.totalAmount, ex.currency)}</span></KV></div>
              </dl>
            ) : <p className="p-5 text-xs text-slate-400">{active ? "Waiting for extraction…" : "No data extracted."}</p>}
          </Card>
          {(poOut?.po || (recon && !recon.skipped)) && (
            <Card>
              <CardHeader title="Purchase order position" />
              <div className="space-y-2 p-5 text-sm">
                {poOut?.po && <div className="flex justify-between"><span className="text-slate-500">PO</span><span className="font-mono text-xs font-medium">{poOut.po.poNumber}{poOut.status === "INFERRED" ? " (inferred)" : ""}</span></div>}
                {recon && !recon.skipped && (
                  <>
                    <Bar label="Previously invoiced" value={recon.previouslyInvoiced} total={recon.poTotal} ccy={recon.currency} color="bg-slate-400" />
                    <Bar label="This invoice" value={recon.invoiceSubtotal ?? 0} total={recon.poTotal} ccy={recon.currency} color={recon.difference > recon.toleranceAmount ? "bg-red-500" : "bg-blue-600"} />
                    <div className="flex justify-between border-t border-slate-100 pt-2 text-xs"><span className="text-slate-500">Remaining after</span><span className={clsx("tabular font-semibold", recon.remainingAfter < 0 ? "text-red-600" : "text-slate-800")}>{fmtMoney(recon.remainingAfter, recon.currency)}</span></div>
                  </>
                )}
              </div>
            </Card>
          )}
          <ActivityLog events={events} />
          {!active && allChecks.length > 0 && (
            <Card>
              <CardHeader title="All checks" subtitle={`${allChecks.filter((c) => c.status === "PASS").length} passed · ${allChecks.filter((c) => c.status === "FAIL").length} failed · ${allChecks.filter((c) => c.status === "WARN").length} warnings`} />
              <div className="max-h-[480px] overflow-auto p-3"><CheckList checks={[...allChecks].sort((a, b) => rank(a.status) - rank(b.status))} /></div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const rank = (s: string) => (s === "FAIL" ? 0 : s === "WARN" ? 1 : s === "PASS" ? 2 : 3);

function StageStatus({ s }: { s: Stage }) {
  const label = s.stage_status === "COMPLETED" && s.outcome === "WARN" ? "COMPLETED · WARNINGS" : s.stage_status;
  const cls = s.stage_status === "RUNNING" ? "bg-blue-50 text-blue-700" : s.stage_status === "FAILED" ? "bg-red-50 text-red-700"
    : s.stage_status === "COMPLETED" ? (s.outcome === "WARN" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")
    : s.stage_status === "SKIPPED" ? "bg-slate-100 text-slate-500" : "bg-slate-50 text-slate-400";
  return <span className={clsx("rounded px-1.5 py-px text-[10px] font-semibold tracking-wide", cls)}>{label}</span>;
}

function Bar({ label, value, total, ccy, color }: { label: string; value: number; total: number; ccy: string; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-slate-500">{label}</span><span className="tabular text-slate-800">{fmtMoney(value, ccy)} <span className="text-slate-400">/ {fmtMoney(total, ccy)}</span></span></div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={clsx("h-1.5 rounded-full", color)} style={{ width: `${Math.min((value / (total || 1)) * 100, 100)}%` }} /></div>
    </div>
  );
}

function DecisionBanner({ run, decision }: { run: any; decision: any }) {
  const s = run.final_status;
  const tone = s === "APPROVED" ? { box: "border-emerald-200 bg-emerald-50", icon: <CheckCircle2 className="h-7 w-7 text-emerald-600" />, title: "text-emerald-800", label: "Approved for payment" }
    : s === "REJECTED" ? { box: "border-red-200 bg-red-50", icon: <XCircle className="h-7 w-7 text-red-600" />, title: "text-red-800", label: "Rejected" }
    : { box: "border-amber-200 bg-amber-50", icon: <AlertTriangle className="h-7 w-7 text-amber-600" />, title: "text-amber-800", label: "Needs human review" };
  return (
    <Card className={clsx("mb-6 p-5", tone.box)}>
      <div className="flex items-start gap-4">
        {tone.icon}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={clsx("text-lg font-semibold", tone.title)}>{tone.label}</h2>
            <span className="text-xs text-slate-500">Decided in {fmtDuration(run.duration)} · {decision?.passedChecks?.length ?? 0} passed · {decision?.failedChecks?.length ?? 0} failed · {decision?.warnings?.length ?? 0} warnings</span>
          </div>
          <p className="mt-1 text-sm text-slate-800">{decision?.headline}</p>
          {s !== "APPROVED" && run.decision_reasons?.length > 1 && (
            <ul className="mt-3 space-y-1">
              {run.decision_reasons.map((r: string, i: number) => <li key={i} className="flex gap-2 text-sm text-slate-700"><span className="text-slate-400">{i + 1}.</span>{r}</li>)}
            </ul>
          )}
          {run.duplicate_of_run_id && <p className="mt-2 text-sm">Original run: <Link className="font-semibold text-blue-700 underline" href={`/runs/${run.duplicate_of_run_id}`}>#{run.duplicate_of_run_number}</Link></p>}
        </div>
      </div>
    </Card>
  );
}
