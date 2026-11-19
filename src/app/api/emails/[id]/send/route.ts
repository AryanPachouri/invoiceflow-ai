import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { sendEmail } from "@/server/communications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send a reviewed draft through the configured provider. Requires explicit user confirmation in the UI. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await ready();
    return json(await sendEmail(db, id));
  } catch (e) {
    return apiError(e);
  }
}
