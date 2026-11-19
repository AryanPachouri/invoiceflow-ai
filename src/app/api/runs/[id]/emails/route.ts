import { z } from "zod";
import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { createDraft, listEmails } from "@/server/communications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await ready();
    return json(await listEmails(db, id).catch(() => []), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}

/** Generate a DRAFT email from this run's decision. Nothing is sent. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = z.object({ mode: z.enum(["template", "ai"]).default("template") }).safeParse(await req.json().catch(() => ({})));
    const db = await ready();
    return json(await createDraft(db, id, parsed.success ? parsed.data.mode : "template"), 201);
  } catch (e) {
    return apiError(e);
  }
}
