import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { getRun } from "@/server/repositories/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return json({ error: "Invalid run ID" }, 400);
    const db = await ready();
    const run = await getRun(db, id);
    if (!run) return json({ error: "Run not found" }, 404);
    return json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
