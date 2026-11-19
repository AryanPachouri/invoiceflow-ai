import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { listVendors } from "@/server/repositories/master-data";
import { createVendorRecord, VendorInputSchema } from "@/server/vendors/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const db = await ready();
    return json(await listVendors(db, new URL(req.url).searchParams.get("q") ?? undefined));
  } catch (e) {
    return apiError(e);
  }
}

/** Register a vendor (manually or from an invoice). Validated, de-duplicated, never auto-approved from an invoice. */
export async function POST(req: Request) {
  try {
    const db = await ready();
    const parsed = VendorInputSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return json({ error: "Please fix the highlighted fields", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "form"), i.message])) }, 400);
    }
    // A vendor created from invoice data must be verified before it can be used for approvals.
    if (parsed.data.source_run_id && parsed.data.status === "ACTIVE") {
      return json({ error: "Vendors created from an invoice start as Pending Verification. Activate them from the Vendors page after verification.", fieldErrors: { status: "Choose Pending Verification" } }, 400);
    }
    return json(await createVendorRecord(db, parsed.data), 201);
  } catch (e) {
    return apiError(e);
  }
}
