import { after } from "next/server";
import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { executeRun, startRun, UploadValidationError } from "@/server/pipeline";
import { listRuns } from "@/server/repositories/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const db = await ready();
    const u = new URL(req.url).searchParams;
    const res = await listRuns(db, {
      q: u.get("q") ?? undefined,
      status: u.get("status") ?? undefined,
      from: u.get("from") || undefined,
      to: u.get("to") || undefined,
      includeSamples: u.get("includeSamples") !== "false",
      sort: u.get("sort") ?? undefined,
      dir: u.get("dir") === "asc" ? "asc" : "desc",
      page: Number(u.get("page") ?? 1),
      pageSize: Number(u.get("pageSize") ?? 10),
    });
    return json(res);
  } catch (e) {
    return apiError(e);
  }
}

/** Upload an invoice PDF and start processing. Returns immediately with the run ID; work continues in the background. */
export async function POST(req: Request) {
  try {
    await ready();
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new UploadValidationError("No file was uploaded. Attach a PDF in the 'file' field.");
    const data = Buffer.from(await file.arrayBuffer());
    const run = await startRun({ filename: file.name, data });
    after(() => executeRun(run.id, data, file.name));
    return json({ runId: run.id, runNumber: run.runNumber }, 202);
  } catch (e) {
    return apiError(e);
  }
}
