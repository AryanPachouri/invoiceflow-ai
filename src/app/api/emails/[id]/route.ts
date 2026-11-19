import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { getEmail, updateDraft } from "@/server/communications";
import { recordEvent } from "@/server/repositories/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await ready();
    const email = await getEmail(db, id).catch(() => null);
    return email ? json(email) : json({ error: "Email not found" }, 404);
  } catch (e) {
    return apiError(e);
  }
}

/** Save edits to a draft (or a failed email before retrying). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await ready();
    const email = await updateDraft(db, id, await req.json().catch(() => ({})));
    await recordEvent(db, String(email.run_id), "EMAIL_EDITED", "Vendor email draft edited and saved", { emailId: id });
    return json(email);
  } catch (e) {
    return apiError(e);
  }
}
