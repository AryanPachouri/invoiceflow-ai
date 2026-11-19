import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { getRun } from "@/server/repositories/runs";
import { buildReport, renderReportPdf } from "@/server/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await ready();
    const run = await getRun(db, id).catch(() => null);
    if (!run) return json({ error: "Run not found" }, 404);
    const format = new URL(req.url).searchParams.get("format") ?? "json";
    const base = `invoiceflow-run-${run.run_number}`;
    if (format === "pdf") {
      const pdf = await renderReportPdf(run);
      return new Response(Buffer.from(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
      });
    }
    return new Response(JSON.stringify(buildReport(run), null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${base}.json"` },
    });
  } catch (e) {
    return apiError(e);
  }
}
