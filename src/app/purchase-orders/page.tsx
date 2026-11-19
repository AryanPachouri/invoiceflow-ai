"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Card, EmptyState, ErrorBanner, Input, PageHeader, SampleTag, Spinner, StatusBadge } from "@/components/ui";

export default function PurchaseOrdersPage() {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPos(await api(`/api/purchase-orders?q=${encodeURIComponent(q)}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  return (
    <>
      <PageHeader title="Purchase Orders" description="Open POs and their live balances. The invoiced amount is the sum of approved allocations, so it updates after every approval." />
      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={load} /></div>}
      <Card>
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PO number or vendor" className="w-full pl-9" />
          </div>
        </div>
        {!pos ? <Spinner /> : !pos.length ? <EmptyState title="No purchase orders found" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-8 px-3 py-2.5" /><th className="px-4 py-2.5">PO number</th><th className="px-4 py-2.5">Vendor</th><th className="px-4 py-2.5 text-right">PO amount</th>
                <th className="px-4 py-2.5 text-right">Invoiced</th><th className="px-4 py-2.5 text-right">Remaining</th><th className="px-4 py-2.5">Utilisation</th><th className="px-4 py-2.5">Status</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pos.map((p) => (
                  <Fragment key={p.id}>
                    <tr onClick={() => setOpen(open === p.id ? null : p.id)} className="cursor-pointer hover:bg-blue-50/40">
                      <td className="px-3 py-3 text-slate-400">{open === p.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="min-w-[200px] px-4 py-3"><div className="flex items-center gap-2 whitespace-nowrap font-mono text-xs font-medium text-slate-800">{p.po_number}{p.is_sample && <SampleTag />}</div><div className="text-xs text-slate-400">{p.description}</div></td>
                      <td className="min-w-[160px] px-4 py-3 text-slate-700">{p.vendor_name}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right">{fmtMoney(p.total_amount, p.currency)}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right text-slate-600">{fmtMoney(p.invoiced_amount, p.currency)}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right font-medium">{fmtMoney(p.remaining_balance, p.currency)}</td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-20 rounded-full bg-slate-100"><div className={clsx("h-1.5 rounded-full", p.utilisation_pct > 90 ? "bg-amber-500" : "bg-blue-600")} style={{ width: `${Math.min(p.utilisation_pct, 100)}%` }} /></div><span className="tabular text-xs text-slate-500">{p.utilisation_pct}%</span></div></td>
                      <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    </tr>
                    {open === p.id && (
                      <tr className="bg-slate-50/60">
                        <td />
                        <td colSpan={7} className="px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">PO lines</div>
                              <table className="w-full rounded border border-slate-200 bg-surface text-xs"><tbody className="divide-y divide-slate-100">
                                {p.items.map((i: any, n: number) => <tr key={n}><td className="px-3 py-1.5">{i.description}</td><td className="tabular px-3 py-1.5 text-right">{i.quantity} × {fmtMoney(i.unit_price, p.currency)}</td><td className="tabular px-3 py-1.5 text-right font-medium">{fmtMoney(i.total_amount, p.currency)}</td></tr>)}
                              </tbody></table>
                            </div>
                            <div>
                              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Approved invoices against this PO</div>
                              {p.invoices.length ? (
                                <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-surface text-xs">
                                  {p.invoices.map((i: any) => <li key={i.run_id} className="flex justify-between px-3 py-1.5"><Link href={`/runs/${i.run_id}`} className="font-mono text-blue-600 hover:underline">{i.invoice_number ?? "—"}</Link><span className="text-slate-400">{fmtDate(String(i.date).slice(0, 10))}{i.is_sample ? " · sample" : ""}</span><span className="tabular font-medium">{fmtMoney(i.amount, p.currency)}</span></li>)}
                                </ul>
                              ) : <p className="text-xs text-slate-400">No approved invoices yet.</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
