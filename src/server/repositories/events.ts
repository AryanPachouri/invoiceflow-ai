import type { Queryable } from "../db";

export type RunEventType =
  | "VENDOR_CREATED" | "VENDOR_LINKED" | "REPROCESS_REQUESTED" | "REPROCESSED_FROM" | "SUPERSEDED"
  | "EMAIL_DRAFTED" | "EMAIL_EDITED" | "EMAIL_SENT" | "EMAIL_FAILED";

/** Append-only audit trail for actions on a run. Nothing here mutates the original decision. */
export async function recordEvent(db: Queryable, runId: string, type: RunEventType, message: string, details: Record<string, unknown> = {}) {
  await db.query(
    "INSERT INTO run_events (run_id, event_type, message, details) VALUES ($1, $2, $3, $4)",
    [runId, type, message, JSON.stringify(details)],
  );
}

export async function listEvents(db: Queryable, runId: string) {
  const { rows } = await db.query(
    "SELECT id, event_type, message, details, created_at FROM run_events WHERE run_id = $1 ORDER BY created_at, id",
    [runId],
  );
  return rows;
}
