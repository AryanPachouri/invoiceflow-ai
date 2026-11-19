-- 003: vendor onboarding from processing results, re-processing lineage, audit events, vendor emails.
-- Additive only: existing columns, constraints and relationships are unchanged.

-- Vendors created from an invoice start as PENDING_VERIFICATION and are never auto-activated.
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_status_check;
ALTER TABLE vendors ADD CONSTRAINT vendors_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'PENDING_VERIFICATION'));
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS payment_details TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'INVOICE', 'SEED'));
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS source_run_id UUID REFERENCES processing_runs(id) ON DELETE SET NULL;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE vendors SET source = 'SEED' WHERE is_sample AND source = 'MANUAL';
UPDATE vendors SET verified_at = created_at WHERE status = 'ACTIVE' AND verified_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_name_lower ON vendors (lower(vendor_name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_tax_id ON vendors (upper(regexp_replace(vendor_tax_id, '[^A-Za-z0-9]', '', 'g')))
  WHERE vendor_tax_id IS NOT NULL AND vendor_tax_id <> '';

-- Re-processing never overwrites history: a new run is created and linked to the one it supersedes.
ALTER TABLE processing_runs ADD COLUMN IF NOT EXISTS reprocessed_from_run_id UUID REFERENCES processing_runs(id) ON DELETE SET NULL;
ALTER TABLE processing_runs ADD COLUMN IF NOT EXISTS superseded_by_run_id UUID REFERENCES processing_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_runs_superseded ON processing_runs (superseded_by_run_id);

-- Append-only audit trail of actions taken on a run after (or outside) processing.
CREATE TABLE IF NOT EXISTS run_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  message     TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events (run_id, created_at);

-- Vendor communications linked to a processing run.
CREATE TABLE IF NOT EXISTS email_communications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               UUID NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  vendor_id            UUID REFERENCES vendors(id) ON DELETE SET NULL,
  invoice_number       TEXT,
  scenario             TEXT NOT NULL CHECK (scenario IN ('REJECTED', 'NEEDS_REVIEW', 'MISSING_INFORMATION', 'APPROVED')),
  generated_by         TEXT NOT NULL DEFAULT 'TEMPLATE' CHECK (generated_by IN ('TEMPLATE', 'AI')),
  recipient_email      TEXT,
  cc                   TEXT,
  subject              TEXT NOT NULL,
  body                 TEXT NOT NULL,
  -- SENDING is a short-lived lock state that prevents duplicate sends.
  status               TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENDING', 'SENT', 'FAILED')),
  provider             TEXT,
  provider_message_id  TEXT,
  error_message        TEXT,
  idempotency_key      TEXT UNIQUE,
  send_attempts        INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_emails_run ON email_communications (run_id, created_at DESC);

ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_communications ENABLE ROW LEVEL SECURITY;
