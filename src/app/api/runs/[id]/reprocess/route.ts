import { after } from "next/server";
import { z } from "zod";
import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { executeRun, prepareReprocess } from "@/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Re-run verification, matching and decision as a NEW linked run. The original run is preserved. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = z.object({ reason: z.string().trim().min(3).max(300).optional() }).safeParse(await req.json().catch(() => ({})));
    await ready();
    const run = await prepareReprocess(id, (body.success && body.data.reason) || "Re-run requested after vendor master update");
    after(() => executeRun(run.id, run.data, run.filename));
    return json({ runId: run.id, runNumber: run.runNumber }, 202);
  } catch (e) {
    return apiError(e);
  }
}
