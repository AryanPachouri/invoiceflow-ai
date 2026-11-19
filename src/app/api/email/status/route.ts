import { json } from "@/server/http";
import { providerStatus } from "@/server/communications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return json(providerStatus());
}
