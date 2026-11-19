-- InvoiceFlow AI — initial schema
-- Works on PostgreSQL 14+ (Supabase) and PGlite (embedded Postgres used for local/dev/tests).

CREATE TABLE IF NOT EXISTS vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code     TEXT NOT NULL UNIQUE,
  vendor_name     TEXT NOT NULL,
  vendor_tax_id   TEXT,
  address         TEXT,
  email           TEXT,
  default_currency CHAR(3) NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  is_sample       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendors_name_lower ON vendors (lower(vendor_name));
CREATE INDEX IF NOT EXISTS idx_vendors_tax_id ON vendors (vendor_tax_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number       TEXT NOT NULL UNIQUE,
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  description     TEXT,
  total_amount    NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  currency        CHAR(3) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  is_sample       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders (vendor_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL,
  description       TEXT NOT NULL,
  quantity          NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price        NUMERIC(14,4) NOT NULL CHECK (unit_price >= 0),
  total_amount      NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  UNIQUE (purchase_order_id, line_no)
);

CREATE TABLE IF NOT EXISTS processing_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number        BIGSERIAL UNIQUE,
  filename          TEXT NOT NULL,
  file_path         TEXT,
  file_size         INTEGER,
  file_fingerprint  TEXT,
  -- lifecycle: QUEUED -> PROCESSING -> COMPLETED | FAILED (system failure, retryable)
  run_status        TEXT NOT NULL DEFAULT 'QUEUED' CHECK (run_status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  current_stage     TEXT,
  extraction_method TEXT,
  extraction_confidence NUMERIC(5,2),
  invoice_number    TEXT,
  vendor_name_extracted TEXT,
  vendor_id         UUID REFERENCES vendors(id) ON DELETE SET NULL,
  po_reference      TEXT,
  po_id             UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  invoice_date      DATE,
  due_date          DATE,
  currency          CHAR(3),
  subtotal          NUMERIC(14,2),
  tax_amount        NUMERIC(14,2),
  total_amount      NUMERIC(14,2),
  final_status      TEXT CHECK (final_status IN ('APPROVED', 'NEEDS_REVIEW', 'REJECTED')),
  decision_reasons  JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision          JSONB,
  extracted_data    JSONB,
  rules_snapshot    JSONB,
  duplicate_of_run_id UUID REFERENCES processing_runs(id) ON DELETE SET NULL,
  error_message     TEXT,
  attempt           INTEGER NOT NULL DEFAULT 1,
  is_sample         BOOLEAN NOT NULL DEFAULT FALSE,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  duration          INTEGER, -- milliseconds
  heartbeat_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON processing_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON processing_runs (final_status);
CREATE INDEX IF NOT EXISTS idx_runs_run_status ON processing_runs (run_status);
CREATE INDEX IF NOT EXISTS idx_runs_fingerprint ON processing_runs (file_fingerprint);
CREATE INDEX IF NOT EXISTS idx_runs_vendor_invoice ON processing_runs (vendor_id, lower(invoice_number));
CREATE INDEX IF NOT EXISTS idx_runs_po ON processing_runs (po_id);

CREATE TABLE IF NOT EXISTS processing_stages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  stage_order    INTEGER NOT NULL CHECK (stage_order BETWEEN 1 AND 9),
  stage_key      TEXT NOT NULL,
  stage_name     TEXT NOT NULL,
  stage_status   TEXT NOT NULL DEFAULT 'PENDING' CHECK (stage_status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  outcome        TEXT CHECK (outcome IN ('PASS', 'WARN', 'FAIL')),
  summary        TEXT,
  input_data     JSONB,
  output_data    JSONB,
  error_message  TEXT,
  logs           JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  duration       INTEGER, -- milliseconds
  UNIQUE (run_id, stage_order)
);
CREATE INDEX IF NOT EXISTS idx_stages_run ON processing_stages (run_id, stage_order);

-- Concurrency-safe duplicate detection: every run atomically claims its duplicate keys.
-- The unique constraint on claim_key guarantees only ONE run can own a given
-- (vendor, invoice number) or document fingerprint, even under concurrent submissions.
CREATE TABLE IF NOT EXISTS invoice_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_key   TEXT NOT NULL UNIQUE,
  claim_type  TEXT NOT NULL CHECK (claim_type IN ('VENDOR_INVOICE', 'FINGERPRINT')),
  run_id      UUID NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_claims_run ON invoice_claims (run_id);

-- Amounts consumed from a PO. Written only for APPROVED runs, under a row lock on the PO,
-- so multiple invoices can never collectively exceed the PO balance.
CREATE TABLE IF NOT EXISTS po_allocations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id       UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  run_id      UUID NOT NULL UNIQUE REFERENCES processing_runs(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alloc_po ON po_allocations (po_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW purchase_order_balances AS
SELECT
  po.id,
  po.po_number,
  po.vendor_id,
  v.vendor_name,
  po.description,
  po.total_amount,
  po.currency,
  po.status,
  po.is_sample,
  po.created_at,
  COALESCE(a.invoiced, 0)::NUMERIC(14,2) AS invoiced_amount,
  (po.total_amount - COALESCE(a.invoiced, 0))::NUMERIC(14,2) AS remaining_balance,
  COALESCE(a.invoice_count, 0) AS invoice_count
FROM purchase_orders po
JOIN vendors v ON v.id = po.vendor_id
LEFT JOIN (
  SELECT po_id, SUM(amount) AS invoiced, COUNT(*) AS invoice_count
  FROM po_allocations GROUP BY po_id
) a ON a.po_id = po.id;
