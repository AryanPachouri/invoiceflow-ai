import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { listEvents } from "@/server/repositories/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await ready();
    return json(await listEvents(db, id).catch(() => []), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
