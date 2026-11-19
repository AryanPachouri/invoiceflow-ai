import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { getRules, resetRules, saveRules } from "@/server/repositories/settings";
import { DEFAULT_RULES } from "@/server/seed/data";
import { env, integrationStatus } from "@/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await ready();
    return json({ rules: await getRules(db), defaults: DEFAULT_RULES, integrations: integrationStatus(), limits: { maxUploadMb: env.maxUploadMb, runTimeoutMs: env.runTimeoutMs, stageDelayMs: env.stageDelayMs } });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const db = await ready();
    const res = await saveRules(db, await req.json().catch(() => ({})));
    return res.ok ? json({ rules: res.rules }) : json({ error: "Invalid configuration", details: res.errors }, 400);
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE() {
  try {
    const db = await ready();
    return json({ rules: await resetRules(db) });
  } catch (e) {
    return apiError(e);
  }
}
