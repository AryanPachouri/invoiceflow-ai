-- Lock tables down from Supabase's auto-generated public APIs (PostgREST / anon key).
-- The application connects server-side as the table owner via DATABASE_URL, which bypasses RLS,
-- so no policies are needed. Browsers never talk to the database directly.
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
