import { num, type Queryable } from "../db";
import type { VendorRecord } from "../rules/vendor";
import type { PoRecord } from "../rules/po";

export async function listVendors(db: Queryable, search?: string) {
  const params: unknown[] = [];
  let where = "";
  if (search?.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where = "WHERE lower(v.vendor_name) LIKE $1 OR lower(v.vendor_code) LIKE $1 OR lower(coalesce(v.vendor_tax_id,'')) LIKE $1";
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT v.*,
       (SELECT count(*) FROM purchase_orders p WHERE p.vendor_id = v.id)::int AS po_count,
       (SELECT count(*) FROM processing_runs r WHERE r.vendor_id = v.id)::int AS invoice_count,
       (SELECT coalesce(sum(r.total_amount),0) FROM processing_runs r WHERE r.vendor_id = v.id AND r.final_status = 'APPROVED') AS approved_amount
     FROM vendors v ${where} ORDER BY v.vendor_name`,
    params,
  );
  return rows.map((r) => ({ ...r, approved_amount: num(r.approved_amount) }));
}

export async function getVendorsForMatching(db: Queryable): Promise<VendorRecord[]> {
  const { rows } = await db.query<VendorRecord>("SELECT id, vendor_code, vendor_name, vendor_tax_id, address, status, default_currency FROM vendors");
  return rows;
}

function mapPo(r: Record<string, unknown>): Omit<PoRecord, "items"> {
  return {
    id: r.id as string, po_number: r.po_number as string, vendor_id: r.vendor_id as string, vendor_name: r.vendor_name as string,
    total_amount: num(r.total_amount)!, currency: r.currency as string, status: r.status as string,
    invoiced_amount: num(r.invoiced_amount) ?? 0, remaining_balance: num(r.remaining_balance) ?? 0, invoice_count: Number(r.invoice_count ?? 0),
  };
}

export async function getPurchaseOrdersWithBalances(db: Queryable): Promise<PoRecord[]> {
  const { rows } = await db.query<Record<string, unknown>>("SELECT * FROM purchase_order_balances ORDER BY po_number");
  const { rows: items } = await db.query<Record<string, unknown>>("SELECT * FROM purchase_order_items ORDER BY purchase_order_id, line_no");
  return rows.map((r) => ({
    ...mapPo(r),
    items: items.filter((i) => i.purchase_order_id === r.id).map((i) => ({
      description: i.description as string, quantity: num(i.quantity)!, unit_price: num(i.unit_price)!, total_amount: num(i.total_amount)!,
    })),
  }));
}

export async function listPurchaseOrders(db: Queryable, search?: string) {
  const all = await getPurchaseOrdersWithBalances(db);
  const { rows } = await db.query<Record<string, unknown>>("SELECT id, description, is_sample, created_at FROM purchase_orders");
  const meta = new Map(rows.map((r) => [r.id, r]));
  const { rows: inv } = await db.query<Record<string, unknown>>(
    `SELECT a.po_id, a.amount, r.id AS run_id, r.invoice_number, r.started_at, r.is_sample
     FROM po_allocations a JOIN processing_runs r ON r.id = a.run_id ORDER BY a.created_at`,
  );
  const s = search?.trim().toLowerCase();
  return all
    .filter((p) => !s || p.po_number.toLowerCase().includes(s) || p.vendor_name.toLowerCase().includes(s))
    .map((p) => ({
      ...p,
      description: meta.get(p.id)?.description ?? null,
      is_sample: meta.get(p.id)?.is_sample ?? false,
      created_at: meta.get(p.id)?.created_at,
      utilisation_pct: p.total_amount ? Math.round((p.invoiced_amount / p.total_amount) * 1000) / 10 : 0,
      invoices: inv.filter((i) => i.po_id === p.id).map((i) => ({ run_id: i.run_id, invoice_number: i.invoice_number, amount: num(i.amount), date: i.started_at, is_sample: i.is_sample })),
    }));
}
