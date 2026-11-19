import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { getRun } from "@/server/repositories/runs";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stream the original invoice from storage (proxied, so storage credentials never reach the browser). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await ready();
    const run = await getRun(db, id).catch(() => null);
    if (!run?.file_path) return json({ error: "Document not found" }, 404);
    const data = await getStorage().get(run.file_path as string);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${String(run.filename).replace(/"/g, "")}"`, "Cache-Control": "private, max-age=300" },
    });
  } catch (e) {
    return apiError(e);
  }
}
