import { ready } from "@/server/bootstrap";
import { apiError, json } from "@/server/http";
import { resetDemoRuns } from "@/server/repositories/runs";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remove all non-sample processing runs so the demo can be replayed. Master data and seeded history are kept. */
export async function POST() {
  try {
    const db = await ready();
    const paths = await resetDemoRuns(db);
    await getStorage().remove(paths).catch(() => undefined);
    return json({ deletedRuns: paths.length });
  } catch (e) {
    return apiError(e);
  }
}
