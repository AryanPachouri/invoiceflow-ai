import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { getMetrics } from "@/server/repositories/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dashboard KPIs, computed live from persisted processing_runs records. */
export async function GET(req: Request) {
  try {
    const db = await ready();
    const includeSamples = new URL(req.url).searchParams.get("includeSamples") !== "false";
    return json(await getMetrics(db, includeSamples), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
