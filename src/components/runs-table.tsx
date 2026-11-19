"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { fmtDateTime, fmtDuration, fmtMoney } from "@/lib/format";
import { Button, EmptyState, ErrorBanner, Input, SampleTag, Select, Spinner, StatusBadge, runStatus } from "./ui";

export interface RunListRow {
  id: string; run_number: number; filename: string; run_status: string; final_status: string | null; invoice_number: string | null;
  vendor_name: string | null; vendor_name_extracted: string | null; po_number: string | null; po_reference: string | null;
  currency: string | null; total_amount: number | null; started_at: string; duration: number | null; is_sample: boolean;
  extraction_method: string | null; decision_reasons: string[]; current_stage: string | null; superseded_by_run_id?: string | null;
}

const COLS: { key: string; label: string; sortable?: boolean; className?: string }[] = [
  { key: "run_number", label: "Run", sortable: true },
  { key: "vendor", label: "Vendor", sortable: true },
  { key: "invoice_number", label: "Invoice #", sortable: true },
  { key: "po", label: "PO" },
  { key: "total_amount", label: "Amount", sortable: true, className: "text-right" },
  { key: "final_status", label: "Status", sortable: true },
  { key: "started_at", label: "Processed", sortable: true },
  { key: "duration", label: "Duration", sortable: true, className: "text-right" },
];

export function RunsTable({ pageSize = 10, refreshKey, includeSamples = true, onIncludeSamplesChange }: {
  pageSize?: number; refreshKey?: number; includeSamples?: boolean; onIncludeSamplesChange?: (v: boolean) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("started_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: RunListRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 250);
  }, [q]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ q: debouncedQ, status, from, to, sort, dir, page: String(page), pageSize: String(pageSize), includeSamples: String(includeSamples) });
      setData(await api(`/api/runs?${p}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [debouncedQ, status, from, to, sort, dir, page, pageSize, includeSamples]);

  useEffect(() => { load(); }, [load, refreshKey]);
  // Auto-refresh while any visible run is still processing
  useEffect(() => {
    if (!data?.rows.some((r) => r.run_status === "PROCESSING" || r.run_status === "QUEUED")) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [data, load]);

  const toggleSort = (k: string) => {
    if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(k); setDir("desc"); }
    setPage(1);
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, invoice #, PO, file or run #" className="w-full pl-9" />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter">
          <option value="ALL">All statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="NEEDS_REVIEW">Needs review</option>
          <option value="REJECTED">Rejected</option>
          <option value="PROCESSING">Processing</option>
          <option value="FAILED">Failed</option>
        </Select>
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" className="w-[140px]" />
        <span className="text-xs text-slate-400">to</span>
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" className="w-[140px]" />
        {onIncludeSamplesChange && (
          <label className="ml-1 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={includeSamples} onChange={(e) => { onIncludeSamplesChange(e.target.checked); setPage(1); }} className="h-3.5 w-3.5 accent-blue-600" />
            Include sample data
          </label>
        )}
      </div>
      {error && <div className="p-4"><ErrorBanner message={error} onRetry={load} /></div>}
      {!data && !error && <Spinner />}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {COLS.map((c) => (
                  <th key={c.key} className={clsx("whitespace-nowrap px-4 py-2.5", c.className)}>
                    {c.sortable ? (
                      <button onClick={() => toggleSort(c.key)} className={clsx("inline-flex items-center gap-1 hover:text-slate-800", sort === c.key && "text-slate-800")}>
                        {c.label}
                        {sort === c.key && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/runs/${r.id}`)} className="cursor-pointer transition-colors hover:bg-blue-50/40">
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">#{r.run_number}</span>
                      {r.is_sample && <SampleTag />}
                      {r.superseded_by_run_id && <span title="Re-processed: a newer run supersedes this decision" className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Superseded</span>}
                    </div>
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <div className="truncate font-medium text-slate-800">{r.vendor_name ?? r.vendor_name_extracted ?? <span className="text-slate-400">Unknown</span>}</div>
                    <div className="truncate text-xs text-slate-400">{r.filename}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{r.invoice_number ?? <span className="text-amber-600">missing</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{r.po_number ?? r.po_reference ?? <span className="text-slate-400">—</span>}</td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-right font-medium text-slate-800">{fmtMoney(r.total_amount, r.currency)}</td>
                  <td className="px-4 py-3"><StatusBadge status={runStatus(r)} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmtDateTime(r.started_at)}</td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-right text-xs text-slate-500">{fmtDuration(r.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.rows.length && <EmptyState title="No processing runs match these filters" description="Upload an invoice or adjust the filters." />}
        </div>
      )}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total}</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="px-2">Page {page} of {pages}</span>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
