import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { listPurchaseOrders } from "@/server/repositories/master-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const db = await ready();
    return json(await listPurchaseOrders(db, new URL(req.url).searchParams.get("q") ?? undefined));
  } catch (e) {
    return apiError(e);
  }
}
