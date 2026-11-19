import { ready } from "@/server/bootstrap";
import { integrationStatus } from "@/server/env";
import { json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await ready();
    await db.query("SELECT 1");
    return json({ status: "ok", integrations: integrationStatus() });
  } catch (e) {
    return json({ status: "degraded", error: e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/[^\s]+/g, "[redacted]") : "unknown" }, 503);
  }
}
