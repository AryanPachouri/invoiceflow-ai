import { num, type Db, type Queryable } from "../db";

export interface ClaimKey { key: string; type: "VENDOR_INVOICE" | "FINGERPRINT"; label: string }

export interface DuplicateHit {
  claim: ClaimKey;
  originalRun: {
    id: string; run_number: number; filename: string; invoice_number: string | null; final_status: string | null;
    run_status: string; started_at: string; total_amount: number | null; is_sample: boolean;
  };
}

/**
 * Atomically claim duplicate-detection keys for a run.
 * The UNIQUE(claim_key) constraint makes this race-free: if two submissions of the same
 * invoice run concurrently, exactly one INSERT succeeds and the other sees the owner.
 */
export async function claimKeys(db: Db, runId: string, keys: ClaimKey[]): Promise<DuplicateHit[]> {
  return db.transaction(async (tx) => {
    const hits: DuplicateHit[] = [];
    const inserted: string[] = [];
    for (const k of keys) {
      const { rows } = await tx.query<{ run_id: string }>(
        `INSERT INTO invoice_claims (claim_key, claim_type, run_id) VALUES ($1, $2, $3)
         ON CONFLICT (claim_key) DO NOTHING RETURNING run_id`,
        [k.key, k.type, runId],
      );
      if (rows[0]) { inserted.push(k.key); continue; }
      const { rows: owner } = await tx.query<Record<string, unknown>>(
        `SELECT r.id, r.run_number, r.filename, r.invoice_number, r.final_status, r.run_status, r.started_at, r.total_amount, r.is_sample
         FROM invoice_claims c JOIN processing_runs r ON r.id = c.run_id WHERE c.claim_key = $1`,
        [k.key],
      );
      const o = owner[0];
      if (!o || o.id === runId) continue; // our own claim (idempotent retry)
      hits.push({
        claim: k,
        originalRun: {
          id: o.id as string, run_number: Number(o.run_number), filename: o.filename as string, invoice_number: (o.invoice_number as string) ?? null,
          final_status: (o.final_status as string) ?? null, run_status: o.run_status as string, started_at: String(o.started_at),
          total_amount: num(o.total_amount), is_sample: !!o.is_sample,
        },
      });
    }
    // A duplicate never holds claims: release anything we just took.
    if (hits.length && inserted.length) {
      await tx.query(`DELETE FROM invoice_claims WHERE run_id = $1 AND claim_key = ANY($2::text[])`, [runId, inserted]);
    }
    return hits;
  });
}

/** Claims are held only by runs that are in progress, approved, or awaiting review. */
export async function releaseClaims(db: Queryable, runId: string) {
  await db.query("DELETE FROM invoice_claims WHERE run_id = $1", [runId]);
}

export interface CommitResult { committed: boolean; remainingBefore: number; reason?: string }

/**
 * Persist the decision. For APPROVED invoices the PO allocation is written in the same
 * transaction under a row lock on the PO, re-checking the live balance, so concurrent
 * approvals can never collectively exceed the PO.
 */
export async function commitDecision(db: Db, args: {
  runId: string; status: "APPROVED" | "NEEDS_REVIEW" | "REJECTED"; reasons: string[]; decision: unknown;
  allocation?: { poId: string; amount: number; toleranceAmount: number };
}): Promise<CommitResult> {
  return db.transaction(async (tx) => {
    let remainingBefore = 0;
    if (args.status === "APPROVED" && args.allocation) {
      const { poId, amount, toleranceAmount } = args.allocation;
      const { rows: po } = await tx.query<{ total_amount: string; status: string }>(
        "SELECT total_amount, status FROM purchase_orders WHERE id = $1 FOR UPDATE", [poId],
      );
      if (!po[0]) return { committed: false, remainingBefore: 0, reason: "PO no longer exists" };
      const { rows: used } = await tx.query<{ s: string }>(
        "SELECT coalesce(sum(amount), 0) AS s FROM po_allocations WHERE po_id = $1 AND run_id <> $2", [poId, args.runId],
      );
      remainingBefore = Number(po[0].total_amount) - Number(used[0].s);
      if (po[0].status !== "OPEN") return { committed: false, remainingBefore, reason: `PO is ${po[0].status}` };
      if (amount > remainingBefore + toleranceAmount) {
        return { committed: false, remainingBefore, reason: "PO balance was consumed by another invoice approved while this one was processing" };
      }
      await tx.query(
        `INSERT INTO po_allocations (po_id, run_id, amount) VALUES ($1, $2, $3)
         ON CONFLICT (run_id) DO UPDATE SET amount = EXCLUDED.amount, po_id = EXCLUDED.po_id`,
        [poId, args.runId, amount],
      );
    } else {
      await tx.query("DELETE FROM po_allocations WHERE run_id = $1", [args.runId]);
    }
    if (args.status === "REJECTED") await tx.query("DELETE FROM invoice_claims WHERE run_id = $1", [args.runId]);
    await tx.query(
      `UPDATE processing_runs SET final_status = $2, decision_reasons = $3, decision = $4, heartbeat_at = now() WHERE id = $1`,
      [args.runId, args.status, JSON.stringify(args.reasons), JSON.stringify(args.decision)],
    );
    return { committed: true, remainingBefore };
  });
}
