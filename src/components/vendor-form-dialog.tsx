"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { api, ApiError, jsonInit } from "@/lib/api";
import { Button, ErrorBanner, FieldLabel, Input, Modal, Select, Spinner, Textarea } from "./ui";

type Prefilled = { value: string | null; source: string };
interface Prefill {
  vendor_name: Prefilled; vendor_tax_id: Prefilled; address: Prefilled; email: Prefilled; phone: Prefilled; payment_details: Prefilled;
  default_currency: string; possibleDuplicate: { reason: string; vendor: { vendor_name: string; vendor_code: string } } | null;
}

const EMPTY = { vendor_name: "", email: "", vendor_tax_id: "", address: "", phone: "", payment_details: "", default_currency: "USD", status: "PENDING_VERIFICATION" };

/**
 * Vendor registration dialog. When `runId` is given, the form is prefilled from that invoice's
 * extracted data and the vendor is created as Pending Verification (never auto-activated).
 */
export function VendorFormDialog({ runId, onClose, onCreated }: { runId?: string; onClose: () => void; onCreated: (vendor: any) => void }) {
  const [form, setForm] = useState({ ...EMPTY, status: runId ? "PENDING_VERIFICATION" : "ACTIVE" });
  const [sources, setSources] = useState<Record<string, string>>({});
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [loading, setLoading] = useState(!!runId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<any>(null);

  useEffect(() => {
    if (!runId) return;
    api<Prefill>(`/api/runs/${runId}/vendor-prefill`)
      .then((p) => {
        setPrefill(p);
        setForm((f) => ({
          ...f,
          vendor_name: p.vendor_name.value ?? "", vendor_tax_id: p.vendor_tax_id.value ?? "", address: p.address.value ?? "",
          email: p.email.value ?? "", phone: p.phone.value ?? "", payment_details: p.payment_details.value ?? "", default_currency: p.default_currency ?? "USD",
        }));
        setSources(Object.fromEntries(["vendor_name", "vendor_tax_id", "address", "email", "phone", "payment_details"].map((k) => [k, (p as any)[k].source])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runId]);

  const set = (k: keyof typeof form, v: string) => { setForm({ ...form, [k]: v }); setFieldErrors({ ...fieldErrors, [k]: "" }); };

  const save = async () => {
    setSaving(true); setError(null); setExisting(null);
    try {
      const vendor = await api<any>("/api/vendors", jsonInit("POST", { ...form, source_run_id: runId ?? null }));
      onCreated(vendor);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors((e.body?.fieldErrors as Record<string, string>) ?? {});
        if (e.status === 409) setExisting(e.body?.existingVendor ?? null);
      } else setError(String(e));
      setSaving(false);
    }
  };

  const badge = (k: string) => {
    if (!runId) return null;
    const src = sources[k];
    if (!src || src === "unavailable") return <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700">Not on invoice · enter manually</span>;
    if (src.includes("verify")) return <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700">Found in document · verify</span>;
    return <span className="rounded bg-blue-50 px-1.5 py-px text-[10px] font-semibold text-blue-700">From invoice</span>;
  };

  return (
    <Modal
      title={runId ? "Add vendor from invoice" : "Add vendor"}
      subtitle={runId ? "Prefilled with details extracted from the invoice. Review and correct before saving." : "Register a new supplier in the vendor master."}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving || loading}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Save vendor</Button>
      </>}
    >
      {loading ? <Spinner label="Reading invoice details…" /> : (
        <div className="space-y-4">
          {prefill?.possibleDuplicate && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Possible existing vendor: {prefill.possibleDuplicate.reason}. Saving will be blocked to prevent a duplicate. Consider updating the existing record instead.</span>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel label="Vendor name" required error={fieldErrors.vendor_name} badge={badge("vendor_name")}>
                <Input value={form.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} className="w-full" placeholder="Registered legal entity name" />
              </FieldLabel>
            </div>
            <FieldLabel label="Vendor email" error={fieldErrors.email} badge={badge("email")} hint="Used as the default recipient for vendor emails">
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="w-full" placeholder="billing@vendor.com" />
            </FieldLabel>
            <FieldLabel label="Contact number" error={fieldErrors.phone} badge={badge("phone")}>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="w-full" placeholder="+1 555 123 4567" />
            </FieldLabel>
            <FieldLabel label="Tax ID / GSTIN" error={fieldErrors.vendor_tax_id} badge={badge("vendor_tax_id")} hint="Indian GSTINs (15 characters) are format-checked">
              <Input value={form.vendor_tax_id} onChange={(e) => set("vendor_tax_id", e.target.value)} className="w-full font-mono" placeholder="e.g. 84-3920175 or 27AAPFU0939F1ZV" />
            </FieldLabel>
            <FieldLabel label="Default currency" error={fieldErrors.default_currency}>
              <Select value={form.default_currency} onChange={(e) => set("default_currency", e.target.value)} className="w-full">
                {["USD", "EUR", "GBP", "INR"].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </FieldLabel>
            <div className="sm:col-span-2">
              <FieldLabel label="Vendor address" error={fieldErrors.address} badge={badge("address")}>
                <Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, city, postcode, country" />
              </FieldLabel>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel label="Payment details" error={fieldErrors.payment_details} badge={badge("payment_details")} hint="Optional. Bank details should be confirmed with the vendor through a trusted channel, not taken from an invoice alone.">
                <Input value={form.payment_details} onChange={(e) => set("payment_details", e.target.value)} className="w-full" placeholder="e.g. Bank transfer, account ending 4821" />
              </FieldLabel>
            </div>
            <FieldLabel label="Vendor status" error={fieldErrors.status} hint={runId ? "Vendors registered from an invoice need verification before invoices can be approved." : undefined}>
              <Select value={form.status} onChange={(e) => set("status", e.target.value)} className="w-full">
                <option value="PENDING_VERIFICATION">Pending verification</option>
                {!runId && <option value="ACTIVE">Active (verified)</option>}
                <option value="INACTIVE">Inactive</option>
              </Select>
            </FieldLabel>
          </div>
          {error && <ErrorBanner message={existing ? `${error}. No new vendor was created.` : error} />}
        </div>
      )}
    </Modal>
  );
}
