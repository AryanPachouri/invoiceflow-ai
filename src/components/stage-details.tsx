"use client";
import Link from "next/link";
import clsx from "clsx";
import { fmtDate, fmtMoney } from "@/lib/format";
import { CheckIcon, KV, StatusBadge } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CheckT {
  code: string; stage: string; label: string; status: string; severity: string; action: string; message: string;
  expected?: any; actual?: any; difference?: number | null; differencePct?: number | null;
}

export function CheckList({ checks }: { checks: CheckT[] }) {
  if (!checks?.length) return null;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-surface">
      {checks.map((c, i) => (
        <li key={c.code + i} className="flex items-start gap-2.5 px-3 py-2">
          <CheckIcon status={c.status} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-800">{c.label}</span>
              {c.status !== "PASS" && c.action !== "NONE" && (
                <span className={clsx("rounded px-1.5 py-px text-[10px] font-semibold", c.action === "REJECT" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>
                  {c.action === "REJECT" ? "HARD FAIL → REJECT" : "→ REVIEW"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-600">{c.message}</p>
          </div>
          <span className="hidden font-mono text-[10px] text-slate-300 sm:block">{c.code}</span>
        </li>
      ))}
    </ul>
  );
}

const FIELD_LABELS: [string, string][] = [
  ["vendorName", "Vendor name"], ["vendorTaxId", "Vendor tax ID"], ["vendorAddress", "Vendor address"], ["invoiceNumber", "Invoice number"],
  ["invoiceDate", "Invoice date"], ["dueDate", "Due date"], ["poReference", "PO reference"], ["currency", "Currency"],
  ["subtotal", "Subtotal"], ["discountAmount", "Discount"], ["taxRate", "Tax rate"], ["taxAmount", "Tax amount"], ["totalAmount", "Total amount"],
];

export function ExtractionView({ o }: { o: any }) {
  if (o?.error) return <p className="text-xs text-red-600">{o.error}</p>;
  const inv = o?.invoice;
  if (!inv) return null;
  const ccy = inv.currency;
  const fmt = (k: string, v: any) => {
    if ((v === null || v === undefined) && k === "discountAmount") return <span className="text-slate-400">None</span>;
    if (v === null || v === undefined) return <span className="font-medium text-amber-600">Not found</span>;
    if (["subtotal", "taxAmount", "totalAmount", "discountAmount"].includes(k)) return fmtMoney(v, ccy);
    if (k === "taxRate") return `${v}%`;
    if (k.endsWith("Date")) return fmtDate(v);
    return String(v);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">Method: {o.method}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">Confidence: {o.confidence}%</span>
        {o.ocrConfidence !== null && o.ocrConfidence !== undefined && <span className="rounded bg-violet-50 px-2 py-0.5 font-medium text-violet-700">OCR confidence: {o.ocrConfidence}%</span>}
        <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">AI: {o.ai?.used ? `used (${o.ai.model})` : o.ai?.status ?? "off"}</span>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-surface p-3 sm:grid-cols-2">
        {FIELD_LABELS.map(([k, label]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 border-b border-dashed border-slate-100 pb-1.5 last:border-0">
            <span className="text-[11px] text-slate-500">{label}</span>
            <span className="text-right text-xs text-slate-800">
              {fmt(k, inv[k])}
              {o.fieldConfidence?.[k] !== undefined && inv[k] !== null && <span className="ml-1.5 text-[10px] text-slate-400">{Math.round(o.fieldConfidence[k] * 100)}%</span>}
            </span>
          </div>
        ))}
      </div>
      {inv.lineItems?.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-1.5">Description</th><th className="px-3 py-1.5 text-right">Qty</th><th className="px-3 py-1.5 text-right">Unit price</th><th className="px-3 py-1.5 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {inv.lineItems.map((l: any, i: number) => (
                <tr key={i}><td className="px-3 py-1.5">{l.description}</td><td className="tabular px-3 py-1.5 text-right">{l.quantity}</td><td className="tabular px-3 py-1.5 text-right">{fmtMoney(l.unitPrice, ccy)}</td><td className="tabular px-3 py-1.5 text-right">{fmtMoney(l.amount, ccy)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {o.warnings?.filter((w: any) => w.severity !== "INFO").length > 0 && (
        <ul className="space-y-1">
          {o.warnings.filter((w: any) => w.severity !== "INFO").map((w: any, i: number) => (
            <li key={i} className={clsx("flex items-start gap-2 text-xs", w.severity === "CRITICAL" ? "text-red-700" : "text-amber-700")}>
              <CheckIcon status={w.severity === "CRITICAL" ? "FAIL" : "WARN"} className="h-3.5 w-3.5" /> {w.message}
            </li>
          ))}
        </ul>
      )}
      {o.warnings?.filter((w: any) => w.severity === "INFO").length > 0 && (
        <p className="text-[11px] text-slate-400">Notes: {o.warnings.filter((w: any) => w.severity === "INFO").map((w: any) => w.message).join(" · ")}</p>
      )}
    </div>
  );
}

export function VendorView({ o }: { o: any }) {
  return (
    <div className="space-y-3">
      {o?.vendor ? (
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-surface p-3 sm:grid-cols-4">
          <KV label="Vendor">{o.vendor.name}</KV>
          <KV label="Code">{o.vendor.code}</KV>
          <KV label="Status"><StatusBadge status={o.vendor.status} /></KV>
          <KV label="Matched by">{o.matchedBy?.replace("_", " ").toLowerCase()}{o.nameSimilarity !== null ? ` · ${Math.round(o.nameSimilarity * 100)}% name match` : ""}</KV>
        </dl>
      ) : o?.closestCandidates?.length ? (
        <p className="text-xs text-slate-500">Closest vendor master records: {o.closestCandidates.map((c: any) => `${c.vendor_name} (${Math.round(c.similarity * 100)}%)`).join(", ")}</p>
      ) : null}
      <CheckList checks={o?.checks} />
    </div>
  );
}

export function DuplicateView({ o }: { o: any }) {
  return (
    <div className="space-y-3">
      {o?.duplicate && o.originalRun && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          Original submission:{" "}
          <Link href={`/runs/${o.originalRun.id}`} className="font-semibold underline">run #{o.originalRun.run_number}</Link>
          {" "}· {o.originalRun.filename} · invoice {o.originalRun.invoice_number ?? "—"} · {o.originalRun.final_status ?? o.originalRun.run_status}
          {o.originalRun.is_sample ? " (sample history)" : ""} · matched on {o.reason}
        </div>
      )}
      <CheckList checks={o?.checks} />
    </div>
  );
}

export function PoView({ o }: { o: any }) {
  const po = o?.po;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">{o?.explanation}</p>
      {po && (
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-surface p-3 sm:grid-cols-3">
          <KV label="PO number">{po.poNumber}{o.status === "INFERRED" && <span className="ml-1 text-[10px] text-amber-600">(inferred)</span>}</KV>
          <KV label="PO vendor">{po.vendor}</KV>
          <KV label="Match confidence">{o.confidence}%</KV>
          <KV label="PO amount">{fmtMoney(po.amount, po.currency)}</KV>
          <KV label="Previously invoiced">{fmtMoney(po.previouslyInvoiced, po.currency)} <span className="text-[11px] text-slate-400">({po.invoiceCount} inv.)</span></KV>
          <KV label="Remaining balance">{fmtMoney(po.remainingBalance, po.currency)}</KV>
        </dl>
      )}
      {o?.candidates?.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-surface">
          <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Candidate purchase orders</div>
          <ul className="divide-y divide-slate-100">
            {o.candidates.map((c: any) => (
              <li key={c.po_number} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                <div><span className="font-mono font-medium">{c.po_number}</span> <span className="text-slate-500">· remaining {fmtMoney(c.remaining_balance, c.currency)}</span><div className="mt-0.5 text-[11px] text-slate-400">{c.reasons.join(" · ")}</div></div>
                <span className="tabular shrink-0 text-slate-500">score {c.score}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <CheckList checks={o?.checks} />
    </div>
  );
}

export function ReconciliationView({ o }: { o: any }) {
  if (!o || o.skipped) return null;
  const c = o.currency;
  const rows: [string, any, string?][] = [
    ["PO total", fmtMoney(o.poTotal, c)],
    ["Previously invoiced", fmtMoney(o.previouslyInvoiced, c)],
    ["Remaining before this invoice", fmtMoney(o.remainingBefore, c)],
    ["This invoice (subtotal, net of tax)", fmtMoney(o.invoiceSubtotal, c)],
    ["Difference vs remaining", o.difference === null ? "—" : `${o.difference > 0 ? "+" : ""}${fmtMoney(o.difference, c)} (${o.differencePct ?? "—"}%)`, o.difference > o.toleranceAmount ? "text-red-600 font-semibold" : "text-emerald-700"],
    [`Tolerance (${o.tolerancePercent}%)`, fmtMoney(o.toleranceAmount, c)],
    ["Remaining after", fmtMoney(o.remainingAfter, c), o.remainingAfter < 0 ? "text-red-600 font-semibold" : ""],
    ["Invoice total (incl. tax)", fmtMoney(o.invoiceTotal, c)],
  ];
  return (
    <div className="space-y-3">
      {o.inferredPo && <p className="text-xs text-amber-700">Reconciled against an inferred PO for information only. The PO must be confirmed.</p>}
      <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-surface text-xs">
        <tbody className="divide-y divide-slate-100">
          {rows.map(([k, v, cls]) => (
            <tr key={k}><td className="px-3 py-1.5 text-slate-500">{k}</td><td className={clsx("tabular px-3 py-1.5 text-right text-slate-800", cls)}>{v}</td></tr>
          ))}
        </tbody>
      </table>
      {o.lines?.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-1.5">Invoice line</th><th className="px-3 py-1.5">PO line</th><th className="px-3 py-1.5 text-right">Qty inv/PO</th><th className="px-3 py-1.5 text-right">Price Δ</th><th className="px-3 py-1.5">Result</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {o.lines.map((l: any, i: number) => (
                <tr key={i}>
                  <td className="px-3 py-1.5">{l.invoiceLine}</td>
                  <td className="px-3 py-1.5 text-slate-500">{l.poLine ?? "—"}</td>
                  <td className="tabular px-3 py-1.5 text-right">{l.invoiceQty ?? "—"} / {l.poQty ?? "—"}</td>
                  <td className="tabular px-3 py-1.5 text-right">{l.priceDiffPct === null ? "—" : `${l.priceDiffPct}%`}</td>
                  <td className="px-3 py-1.5"><span className={clsx("font-medium", l.status === "MATCH" ? "text-emerald-700" : "text-amber-700")}>{l.status.replace(/_/g, " ").toLowerCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CheckList checks={o.checks} />
    </div>
  );
}

export function DecisionView({ o }: { o: any }) {
  return (
    <div className="space-y-2">
      <ol className="space-y-1 rounded-lg border border-slate-200 bg-surface p-3 font-mono text-[11px] text-slate-600">
        {o?.ruleTrace?.map((t: string, i: number) => <li key={i}>{t}</li>)}
      </ol>
      {o?.allocation && <p className="text-xs text-emerald-700">Allocated {o.allocation.amount} to {o.allocation.po} (committed under a PO row lock).</p>}
    </div>
  );
}

export function StageOutput({ stageKey, o }: { stageKey: string; o: any }) {
  if (!o) return null;
  if (o.skipped) return <p className="text-xs text-slate-500">{o.reason}</p>;
  switch (stageKey) {
    case "INGESTION":
      return (
        <dl className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-surface p-3 sm:grid-cols-2">
          <KV label="Fingerprint (SHA-256)" mono>{o.fingerprint}</KV>
          <KV label="Stored at" mono>{o.storage}: {o.storagePath}</KV>
        </dl>
      );
    case "EXTRACTION": return <ExtractionView o={o} />;
    case "VENDOR_VERIFICATION": return <VendorView o={o} />;
    case "DUPLICATE_DETECTION": return <DuplicateView o={o} />;
    case "PO_MATCHING": return <PoView o={o} />;
    case "RECONCILIATION": return <ReconciliationView o={o} />;
    case "DECISION": return <DecisionView o={o} />;
    case "REPORT":
      return (
        <div className="flex gap-3 text-xs">
          <a className="font-medium text-blue-600 hover:underline" href={o.reportPdf}>Download PDF report</a>
          <a className="font-medium text-blue-600 hover:underline" href={o.reportJson}>Download JSON report</a>
        </div>
      );
    default: return <CheckList checks={o.checks} />;
  }
}
