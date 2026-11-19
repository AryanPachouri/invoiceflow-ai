import { z } from "zod";
import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { setVendorStatus } from "@/server/vendors/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = z.object({ status: z.enum(["ACTIVE", "INACTIVE", "PENDING_VERIFICATION"]) }).safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "status must be ACTIVE, INACTIVE or PENDING_VERIFICATION" }, 400);
    const db = await ready();
    const v = await setVendorStatus(db, id, parsed.data.status).catch(() => null);
    return v ? json(v) : json({ error: "Vendor not found" }, 404);
  } catch (e) {
    return apiError(e);
  }
}
