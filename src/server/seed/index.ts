import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import { SEED_POS, SEED_VENDORS } from "./data";

/** Insert master data (idempotent). */
export async function seedMasterData(db: Db) {
  return db.transaction(async (tx) => {
    const ids = new Map<string, string>();
    for (const v of SEED_VENDORS) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO vendors (vendor_code, vendor_name, vendor_tax_id, address, email, default_currency, status, is_sample, source, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,'SEED', CASE WHEN $7 = 'ACTIVE' THEN now() END)
         ON CONFLICT (vendor_code) DO UPDATE SET vendor_name = EXCLUDED.vendor_name RETURNING id`,
        [v.code, v.name, v.taxId, v.address, v.email, v.currency, v.status],
      );
      ids.set(v.code, rows[0].id);
    }
    for (const po of SEED_POS) {
      const total = po.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
      const { rows } = await tx.query<{ id: string; inserted: boolean }>(
        `INSERT INTO purchase_orders (po_number, vendor_id, description, total_amount, currency, is_sample)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (po_number) DO UPDATE SET description = EXCLUDED.description RETURNING id, (xmax = 0) AS inserted`,
        [po.poNumber, ids.get(po.vendorCode), po.description, total, po.currency],
      );
      if (rows[0].inserted) {
        let n = 1;
        for (const i of po.items) {
          await tx.query(
            `INSERT INTO purchase_order_items (purchase_order_id, line_no, description, quantity, unit_price, total_amount)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [rows[0].id, n++, i.description, i.quantity, i.unitPrice, i.quantity * i.unitPrice],
          );
        }
      }
    }
    return { vendors: SEED_VENDORS.length, purchaseOrders: SEED_POS.length };
  });
}

/**
 * Seed historical invoices by running the real pipeline on sample PDFs (flagged is_sample).
 * This gives the dashboard and PO balances realistic history without fabricating records.
 */
export async function seedHistory(db: Db) {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM processing_runs WHERE is_sample = true");
  if (Number(rows[0].n) > 0) return { processed: 0 };
  const { processInvoice } = await import("../pipeline");
  const dir = path.join(process.cwd(), "db", "seed-invoices");
  if (!fs.existsSync(dir)) return { processed: 0 };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort();
  const results: { file: string; status: string | null }[] = [];
  for (const f of files) {
    const run = await processInvoice({ filename: f, data: fs.readFileSync(path.join(dir, f)), isSample: true, paced: false });
    results.push({ file: f, status: (run.final_status as string) ?? run.run_status as string });
  }
  return { processed: files.length, results };
}

export async function isSeeded(db: Db) {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM vendors");
  return Number(rows[0].n) > 0;
}
