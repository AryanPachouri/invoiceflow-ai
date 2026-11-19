import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { findDuplicateVendor, vendorPrefill } from "@/server/vendors/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vendor registration form values extracted from this run's invoice, with their source. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await ready();
    const prefill = await vendorPrefill(db, id).catch(() => null);
    if (!prefill) return json({ error: "Run not found" }, 404);
    const dup = prefill.vendor_name.value ? await findDuplicateVendor(db, prefill.vendor_name.value, prefill.vendor_tax_id.value) : null;
    return json({ ...prefill, possibleDuplicate: dup ? { reason: dup.reason, vendor: dup.vendor } : null });
  } catch (e) {
    return apiError(e);
  }
}
