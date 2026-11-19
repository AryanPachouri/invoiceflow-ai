"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { CheckCircle2, Database, HardDrive, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, CardHeader, ErrorBanner, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

export default function SettingsPage() {
  const [data, setData] = useState<any>(null);
  const [rules, setRules] = useState<any>(null);
  const [currencies, setCurrencies] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const d = await api<any>("/api/settings");
    setData(d);
    setRules(d.rules);
    setCurrencies(d.rules.allowedCurrencies.join(", "));
  };
  useEffect(() => { load().catch((e) => setErrors([e.message])); }, []);

  if (!rules) return errors.length ? <ErrorBanner message={errors[0]} /> : <Spinner />;
  const set = (path: string, value: any) => {
    const next = structuredClone(rules);
    const keys = path.split(".");
    let o = next;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)!] = value;
    setRules(next);
    setSaved(null);
  };
  const numberOf = (v: string) => (v === "" ? NaN : Number(v));

  const save = async () => {
    setBusy(true); setErrors([]); setSaved(null);
    try {
      const body = { ...rules, allowedCurrencies: currencies.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean) };
      const res = await api<any>("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setRules(res.rules); setCurrencies(res.rules.allowedCurrencies.join(", "));
      setSaved(`Saved as version ${res.rules.version}. New runs will use this configuration.`);
    } catch (e) {
      setErrors(e instanceof ApiError && e.details ? e.details : [e instanceof Error ? e.message : String(e)]);
    } finally { setBusy(false); }
  };
  const resetDefaults = async () => {
    if (!confirm("Reset all business rules to their documented defaults?")) return;
    const res = await api<any>("/api/settings", { method: "DELETE" });
    setRules(res.rules); setCurrencies(res.rules.allowedCurrencies.join(", ")); setSaved("Defaults restored.");
  };
  const resetDemo = async () => {
    if (!confirm("Delete all processing runs except the seeded sample history? This lets you replay the demo invoices.")) return;
    const res = await api<any>("/api/admin/reset-demo", { method: "POST" });
    setSaved(`Removed ${res.deletedRuns} demo run(s). PO balances have been recalculated.`);
  };

  return (
    <>
      <PageHeader title="Settings & Business Rules" description="Every change is validated and versioned. Each run stores a snapshot of the rules it used."
        actions={<><Button onClick={resetDefaults}><RotateCcw className="h-4 w-4" />Restore defaults</Button><Button variant="primary" onClick={save} disabled={busy}><Save className="h-4 w-4" />Save changes</Button></>} />
      {errors.length > 0 && <div className="mb-4"><ErrorBanner message={`Configuration not saved: ${errors.join("; ")}`} /></div>}
      {saved && <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />{saved}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Financial tolerance" subtitle="Used when reconciling invoices against the remaining PO balance" />
          <div className="space-y-4 p-5">
            <Field label="Tolerance (%)" hint="An invoice may exceed the remaining PO balance by up to this percentage. Default 2%.">
              <Input type="number" step="0.1" min={0} max={20} value={Number.isNaN(rules.tolerancePercent) ? "" : rules.tolerancePercent} onChange={(e) => set("tolerancePercent", numberOf(e.target.value))} className="w-32" />
            </Field>
            <Field label="Minimum absolute tolerance" hint="Floor for small balances, in document currency, to absorb rounding.">
              <Input type="number" step="0.5" min={0} value={Number.isNaN(rules.toleranceAbsoluteMin) ? "" : rules.toleranceAbsoluteMin} onChange={(e) => set("toleranceAbsoluteMin", numberOf(e.target.value))} className="w-32" />
            </Field>
            <Field label="Allowed currencies" hint="Comma-separated ISO 4217 codes.">
              <Input value={currencies} onChange={(e) => { setCurrencies(e.target.value); setSaved(null); }} className="w-full" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Duplicate detection" subtitle="Concurrency-safe: keys are claimed atomically with a unique constraint" />
          <div className="space-y-4 p-5">
            <Toggle label="Vendor + invoice number" hint="Normalised (case and punctuation insensitive)." checked={rules.duplicateDetection.byVendorAndInvoiceNumber} onChange={(v) => set("duplicateDetection.byVendorAndInvoiceNumber", v)} />
            <Toggle label="Document fingerprint (SHA-256)" hint="Catches the exact same file submitted twice." checked={rules.duplicateDetection.byFingerprint} onChange={(v) => set("duplicateDetection.byFingerprint", v)} />
            <Field label="When a duplicate is found" hint="Duplicates can never be ignored. At least one method must stay enabled.">
              <Select value={rules.duplicateDetection.action} onChange={(e) => set("duplicateDetection.action", e.target.value)}>
                <option value="REJECT">Reject</option><option value="REVIEW">Send to review</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Automatic approval conditions" />
          <div className="space-y-4 p-5">
            <Toggle label="Enable automatic approval" hint="When off, clean invoices are routed to review instead of approved." checked={rules.autoApproval.enabled} onChange={(v) => set("autoApproval.enabled", v)} />
            <Field label="Maximum auto-approval amount" hint="Invoices with a higher total always go to review.">
              <Input type="number" min={1} value={Number.isNaN(rules.autoApproval.maxAmount) ? "" : rules.autoApproval.maxAmount} onChange={(e) => set("autoApproval.maxAmount", numberOf(e.target.value))} className="w-40" />
            </Field>
            <Field label="Minimum extraction confidence (%)" hint="Below this, a human must verify the extracted data.">
              <Input type="number" min={0} max={100} value={Number.isNaN(rules.autoApproval.minExtractionConfidence) ? "" : rules.autoApproval.minExtractionConfidence} onChange={(e) => set("autoApproval.minExtractionConfidence", numberOf(e.target.value))} className="w-32" />
            </Field>
            <Toggle label="Require explicit PO reference" hint="If on, an inferred PO always needs human confirmation. A missing PO never causes rejection on its own." checked={rules.autoApproval.requireExplicitPo} onChange={(v) => set("autoApproval.requireExplicitPo", v)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Hard-failure conditions" subtitle="What happens when these deterministic rules fail" />
          <div className="space-y-4 p-5">
            {([["inactiveVendor", "Vendor is inactive"], ["poVendorMismatch", "PO belongs to a different vendor"], ["unknownVendor", "Vendor not in vendor master"]] as const).map(([k, label]) => (
              <Field key={k} label={label}>
                <Select value={rules.hardFailures[k]} onChange={(e) => set(`hardFailures.${k}`, e.target.value)}>
                  <option value="REJECT">Reject</option><option value="REVIEW">Send to review</option>
                </Select>
              </Field>
            ))}
            <p className="text-[11px] text-slate-400">The AI extractor only proposes field values. It never takes part in the decision and can never override these rules.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Active configuration" subtitle={`Version ${rules.version}`} />
          <pre className="max-h-80 overflow-auto rounded-b-xl bg-code p-4 text-[11px] text-code-fg">{JSON.stringify(rules, null, 2)}</pre>
        </Card>

        <Card>
          <CardHeader title="System & integrations" />
          <div className="space-y-3 p-5 text-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div><div className="text-xs text-slate-500">Appearance</div><div className="text-sm text-slate-800">Saved in this browser</div></div>
              <ThemeToggle />
            </div>
            <Row icon={Database} label="Database" value={data.integrations.database} />
            <Row icon={HardDrive} label="Document storage" value={data.integrations.storage} />
            <Row icon={Sparkles} label="AI extraction" value={data.integrations.ai} />
            <Row icon={HardDrive} label="Upload limit" value={`${data.limits.maxUploadMb} MB`} />
            <div className="border-t border-slate-100 pt-4">
              <Button variant="danger" size="sm" onClick={resetDemo}><Trash2 className="h-3.5 w-3.5" />Reset demo runs</Button>
              <p className="mt-1.5 text-[11px] text-slate-400">Deletes your processed runs (keeps vendors, POs and seeded sample history) so the sample invoices can be replayed.</p>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-xs font-medium text-slate-700">{label}</div>{children}{hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}</div>;
}
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
      <span><span className="block text-sm font-medium text-slate-800">{label}</span>{hint && <span className="block text-[11px] text-slate-400">{hint}</span>}</span>
    </label>
  );
}
function Row({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return <div className="flex items-start gap-3"><Icon className="mt-0.5 h-4 w-4 text-slate-400" /><div><div className="text-xs text-slate-500">{label}</div><div className="text-sm text-slate-800">{value}</div></div></div>;
}
