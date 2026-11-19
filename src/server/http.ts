import { NextResponse } from "next/server";
import { DatabaseUnavailableError } from "./db";
import { UploadValidationError } from "./pipeline";
import { VendorConflictError } from "./vendors/service";
import { EmailError } from "./communications";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

/** Map errors to safe, helpful HTTP responses (never leak credentials or stack traces). */
export function apiError(e: unknown) {
  if (e instanceof UploadValidationError) return json({ error: e.message }, 400);
  if (e instanceof VendorConflictError) return json({ error: e.message, existingVendor: e.existing }, 409);
  if (e instanceof EmailError) return json({ error: e.message, email: (e as EmailError & { email?: unknown }).email ?? null }, e.status);
  if (e instanceof DatabaseUnavailableError) {
    console.error("[api]", e.message);
    return json({ error: "The database is unavailable. Check DATABASE_URL and that the database is reachable." }, 503);
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[api] unexpected error:", msg);
  return json({ error: "Unexpected server error. The issue has been logged." }, 500);
}
