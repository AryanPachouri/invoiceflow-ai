"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, FileText, Percent, UploadCloud, Wallet, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { fmtCompactMoney, fmtDuration, fmtMoney, timeAgo } from "@/lib/format";
import { Button, Card, CardHeader, EmptyState, ErrorBanner, PageHeader, SampleTag, Spinner, StatusBadge, runStatus } from "@/components/ui";
import { RunsTable, type RunListRow } from "@/components/runs-table";

interface Metrics {
  totalRuns: number; processed: number; approved: number; needsReview: number; rejected: number; failed: number; inProgress: number;
  sampleRuns: number; avgDurationMs: number; approvalRate: number;
  valueByCurrency: { currency: string; total: number; approvedTotal: number; count: number }[];
  daily: { day: string; approved: number; needsReview: number; rejected: number; failed: number }[];
}

const SERIES = [
  { key: "approved", label: "Approved", color: "#059669" },
  { key: "needsReview", label: "Needs review", color: "#f59e0b" },
  { key: "rejected", label: "Rejected", color: "#dc2626" },
  { key: "failed", label: "Failed (system)", color: "#7b8799" },
] as const;

export default function DashboardPage() {
  const [includeSamples, setIncludeSamples] = useState(true);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recent, setRecent] = useState<RunListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([
        api<Metrics>(`/api/metrics?includeSamples=${includeSamples}`),
        api<{ rows: RunListRow[] }>(`/api/runs?pageSize=6&includeSamples=${includeSamples}`),
      ]);
      setMetrics(m);
      setRecent(r.rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [includeSamples]);

  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const primary = metrics?.valueByCurrency[0];
  return (
    <>
      <PageHeader
        title="Accounts Payable Overview"
        description="Live metrics computed from persisted processing runs."
        actions={<Link href="/process"><Button variant="primary"><UploadCloud className="h-4 w-4" />Process invoice</Button></Link>}
      />
      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={load} /></div>}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={includeSamples} onChange={(e) => setIncludeSamples(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
          Include sample data
        </label>
        {metrics && metrics.sampleRuns > 0 && includeSamples && (
          <span className="flex items-center gap-1.5"><SampleTag /> {metrics.sampleRuns} seeded historical run(s), processed through the real pipeline at setup</span>
        )}
        {metrics && metrics.inProgress > 0 && <span className="font-medium text-blue-600">{metrics.inProgress} run(s) processing…</span>}
      </div>

      {!metrics ? <Spinner /> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Kpi icon={FileText} label="Invoices processed" value={metrics.processed} hint={metrics.failed ? `${metrics.failed} failed (retryable)` : `avg ${fmtDuration(metrics.avgDurationMs)} per run`} />
          <Kpi icon={CheckCircle2} label="Approved" value={metrics.approved} tone="text-emerald-600" hint="auto-approved" />
          <Kpi icon={AlertTriangle} label="Needs review" value={metrics.needsReview} tone="text-amber-600" hint="routed to AP team" />
          <Kpi icon={XCircle} label="Rejected" value={metrics.rejected} tone="text-red-600" hint="hard-rule failures" />
          <Kpi icon={Wallet} label="Total invoice value" value={primary ? fmtCompactMoney(primary.total, primary.currency) : "—"}
            hint={metrics.valueByCurrency.length > 1 ? `+ ${metrics.valueByCurrency.slice(1).map((c) => fmtCompactMoney(c.total, c.currency)).join(", ")}` : primary ? `${primary.count} invoices` : "no invoices yet"} />
          <Kpi icon={Percent} label="Approval rate" value={`${metrics.approvalRate}%`} hint={`${metrics.approved} of ${metrics.processed} completed`} />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Processing outcomes" subtitle="Decisions per day (UTC), last 14 days" />
          <div className="h-72 px-2 py-4">
            {metrics && metrics.daily.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.daily.map((d) => ({ ...d, label: new Date(d.day + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) }))} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="var(--color-slate-100)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-slate-200)" }} tick={{ fontSize: 11, fill: "var(--color-slate-500)" }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--color-slate-500)" }} width={28} />
                  <Tooltip cursor={{ fill: "var(--color-blue-50)", fillOpacity: 0.5 }} contentStyle={{ borderRadius: 8, border: "1px solid var(--color-slate-200)", background: "var(--color-surface)", color: "var(--color-slate-800)", fontSize: 12 }} labelStyle={{ color: "var(--color-slate-900)", fontWeight: 600 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--color-slate-600)" }} />
                  {SERIES.map((s, i) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} stroke="var(--color-surface)" strokeWidth={2} maxBarSize={44}
                      radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : metrics ? <EmptyState title="No runs yet" description="Process an invoice to populate this chart." /> : <Spinner />}
          </div>
          {metrics && metrics.processed > 0 && (
            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-5 py-4 sm:grid-cols-4">
              {SERIES.map((s) => {
                const n = s.key === "approved" ? metrics.approved : s.key === "needsReview" ? metrics.needsReview : s.key === "rejected" ? metrics.rejected : metrics.failed;
                const total = metrics.processed + metrics.failed;
                return (
                  <div key={s.key}>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-800">{n} <span className="font-normal text-slate-400">· {total ? Math.round((n / total) * 100) : 0}%</span></div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full" style={{ width: `${total ? (n / total) * 100 : 0}%`, background: s.color }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Latest processing runs" action={<Link href="/history" className="text-xs font-medium text-blue-600 hover:underline">View all</Link>} />
          {!recent ? <Spinner /> : !recent.length ? <EmptyState title="No activity yet" /> : (
            <ul className="divide-y divide-slate-100">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/runs/${r.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{r.vendor_name ?? r.vendor_name_extracted ?? r.filename}</span>
                        {r.is_sample && <SampleTag />}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {r.invoice_number ?? "no invoice #"} · {fmtMoney(r.total_amount, r.currency)} · {timeAgo(r.started_at)}
                      </div>
                    </div>
                    <StatusBadge status={runStatus(r)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Invoice history" subtitle="Click any run to open its full processing report" />
        <RunsTable pageSize={8} refreshKey={tick} includeSamples={includeSamples} onIncludeSamplesChange={setIncludeSamples} />
      </Card>
    </>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: typeof FileText; label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <Icon className={`h-4 w-4 ${tone ?? "text-slate-400"}`} />
      </div>
      <div className={`tabular mt-2 text-2xl font-semibold tracking-tight ${tone ?? "text-slate-900"}`}>{value}</div>
      {hint && <div className="mt-1 truncate text-[11px] text-slate-400">{hint}</div>}
    </Card>
  );
}
