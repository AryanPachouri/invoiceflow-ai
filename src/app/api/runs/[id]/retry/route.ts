import { after } from "next/server";
import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { executeRun, prepareRetry } from "@/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await ready();
    const { data, filename } = await prepareRetry(id);
    after(() => executeRun(id, data, filename));
    return json({ runId: id, retried: true }, 202);
  } catch (e) {
    return apiError(e);
  }
}
