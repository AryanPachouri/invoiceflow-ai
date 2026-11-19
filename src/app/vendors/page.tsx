"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { Plus, Search, ShieldCheck } from "lucide-react";
import { VendorFormDialog } from "@/components/vendor-form-dialog";
import { useToast } from "@/components/toast";
import { jsonInit } from "@/lib/api";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { Button, Card, CardHeader, EmptyState, ErrorBanner, Input, KV, PageHeader, SampleTag, Spinner, StatusBadge } from "@/components/ui";

export default function VendorsPage() {
  const [q, setQ] = useState("");
  const [vendors, setVendors] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try { setVendors(await api(`/api/vendors?q=${encodeURIComponent(q)}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const changeStatus = async (v: any, status: "ACTIVE" | "INACTIVE") => {
    try {
      const updated = await api<any>(`/api/vendors/${v.id}`, jsonInit("PATCH", { status }));
      setSelected({ ...v, ...updated });
      toast({ tone: "success", title: status === "ACTIVE" ? `${v.vendor_name} verified and activated` : `${v.vendor_name} deactivated`, description: status === "ACTIVE" ? "Re-run any held invoices from their result page to re-evaluate them." : undefined });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <>
      <PageHeader title="Vendors" description="Approved vendor master. Stage 4 verifies every invoice against these records."
        actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add vendor</Button>} />
      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={load} /></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-3">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code or tax ID" className="w-full pl-9" />
            </div>
          </div>
          {!vendors ? <Spinner /> : !vendors.length ? <EmptyState title="No vendors found" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Vendor</th><th className="px-4 py-2.5">Tax ID</th><th className="px-4 py-2.5">Currency</th><th className="px-4 py-2.5 text-right">POs</th><th className="px-4 py-2.5 text-right">Invoices</th><th className="px-4 py-2.5">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {vendors.map((v) => (
                    <tr key={v.id} onClick={() => setSelected(v)} className={`cursor-pointer hover:bg-blue-50/40 ${selected?.id === v.id ? "bg-blue-50/60" : ""}`}>
                      <td className="px-4 py-3"><div className="flex items-center gap-2 font-medium text-slate-800">{v.vendor_name}{v.is_sample && <SampleTag />}</div><div className="font-mono text-xs text-slate-400">{v.vendor_code}</div></td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{v.vendor_tax_id ?? "—"}</td>
                      <td className="px-4 py-3 text-xs">{v.default_currency}</td>
                      <td className="tabular px-4 py-3 text-right">{v.po_count}</td>
                      <td className="tabular px-4 py-3 text-right">{v.invoice_count}</td>
                      <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Vendor details" />
          {selected ? (
            <dl className="space-y-4 p-5">
              <KV label="Name">{selected.vendor_name}</KV>
              <KV label="Vendor code" mono>{selected.vendor_code}</KV>
              <KV label="Tax ID" mono>{selected.vendor_tax_id ?? "—"}</KV>
              <KV label="Address">{selected.address ?? "—"}</KV>
              <KV label="Email">{selected.email ?? "—"}</KV>
              <KV label="Default currency">{selected.default_currency}</KV>
              <KV label="Approved invoice value">{fmtMoney(selected.approved_amount, selected.default_currency)}</KV>
              <KV label="Status"><StatusBadge status={selected.status} /></KV>
              <KV label="Contact number">{selected.phone ?? "—"}</KV>
              <KV label="Payment details">{selected.payment_details ?? "—"}</KV>
              <KV label="Source">{selected.source === "INVOICE" ? <>Registered from an invoice{selected.source_run_id && <> · <a className="text-blue-600 hover:underline" href={`/runs/${selected.source_run_id}`}>view run</a></>}</> : selected.source === "SEED" ? "Sample master data" : "Added manually"}</KV>
              {selected.verified_at && <KV label="Verified">{new Date(selected.verified_at).toLocaleString()}</KV>}
              <div className="flex flex-wrap gap-2">
                {selected.status !== "ACTIVE" && (
                  <Button size="sm" variant="primary" onClick={() => changeStatus(selected, "ACTIVE")}><ShieldCheck className="h-3.5 w-3.5" />{selected.status === "PENDING_VERIFICATION" ? "Verify & activate" : "Reactivate vendor"}</Button>
                )}
                {selected.status !== "INACTIVE" && <Button size="sm" variant="danger" onClick={() => changeStatus(selected, "INACTIVE")}>Deactivate vendor</Button>}
              </div>
              <p className="text-[11px] text-slate-400">Invoices from inactive vendors are rejected. Invoices from vendors pending verification are held for review.</p>
            </dl>
          ) : <EmptyState title="Select a vendor" description="Click a row to see details." />}
        </Card>
      </div>
      {adding && <VendorFormDialog onClose={() => setAdding(false)} onCreated={(v) => { setAdding(false); setSelected(v); toast({ tone: "success", title: `Vendor ${v.vendor_name} added`, description: `${v.vendor_code} · ${String(v.status).replace("_", " ").toLowerCase()}` }); load(); }} />}
    </>
  );
}
