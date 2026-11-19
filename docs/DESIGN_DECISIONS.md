# Design Decisions

Why each major technology and business rule was chosen. Useful for the interview walk-through.

## Product & process

**Deterministic decisions, AI only at the edges.** In finance an approval has to be reproducible and explainable to an auditor. The decision engine is plain code over recorded checks, and the same inputs and rules always give the same answer. AI (Claude) is optional and confined to *proposing extracted field values* for hard layouts. Even then each proposed value must literally appear in the document text (grounding check), or it is discarded. AI can never override a hard-failure rule because it never sees the decision.

**Three outcomes, biased to "review".** False approvals cost real money. False reviews cost a few minutes of a clerk's time. So anything uncertain (missing PO, inferred PO, low OCR confidence, unknown vendor) routes to **NEEDS_REVIEW**. **REJECTED** is reserved for things that are definitively wrong: duplicates, inactive vendors, and billing another vendor's PO.

**A missing PO never rejects on its own.** Plenty of legitimate invoices arrive without a PO reference. The system searches for candidates and explains what it found, but only a human picks between ambiguous candidates.

**Duplicates are never silent.** The duplicate action can be REJECT or REVIEW, but there is no "ignore", and settings validation forbids disabling both detection methods.

**PO amounts are net of tax.** That's how most procurement systems book commitments. The subtotal is what consumes PO balance, and tax is validated separately.

**Tolerance is percentage-based with an absolute floor** (2% / 1.00). Two percent absorbs rounding and small freight/price drift on large POs. The floor stops tiny remaining balances from failing on cents.

**Seed history is processed, not faked.** Prior invoices are real PDFs run through the real pipeline at first boot and flagged `is_sample`. The dashboard can include or exclude them, so every metric still comes from genuine persisted runs.

## Engineering

**Next.js (single deployable, layered internally).** One TypeScript codebase for UI and API keeps the prototype simple to deploy and demo. Separation comes from module boundaries (`extraction`, `rules`, `repositories`, `pipeline`, `storage`, `db`) rather than separate services. The rule modules are pure functions, so they're trivially unit-testable.

**Background execution + persisted stage state + polling.** The upload returns a run ID immediately. The pipeline runs via `after()` and writes each stage's state to `processing_stages` before and after it executes. The UI only renders what is in the database, so it can't claim a stage finished early, and a page refresh loses nothing. Polling was chosen over SSE because it works on every host and proxy with no sticky connections.

**PostgreSQL (Supabase) with PGlite as the local fallback.** Postgres gives transactions, `FOR UPDATE` row locks and unique constraints, the primitives needed for financial correctness. PGlite is actual Postgres compiled to WASM, so local development and the test suite exercise the *same* SQL, constraints and locking as production without Docker.

**Concurrency-safe duplicates through a claims table.** Checking "does a duplicate exist?" and then inserting is a race. Instead, each run `INSERT … ON CONFLICT DO NOTHING`s its keys into `invoice_claims (claim_key UNIQUE)`. Exactly one concurrent submission can win, and it covers in-flight runs as well as completed ones. The integration test submits three copies at once and asserts that exactly one proceeds.

**PO over-allocation prevented at commit.** Reconciliation reads a balance that may be stale by the time a decision is made. Approval therefore re-reads the balance under `SELECT … FOR UPDATE` and writes `po_allocations` in the same transaction. `po_allocations.run_id` is UNIQUE, so retries are idempotent.

**Failures are recorded, retries are safe.** Any exception marks the run `FAILED` with the error, marks the running stage as failed and the rest as skipped, and releases claims and allocations. A heartbeat watchdog fails runs orphaned by a crash or restart. Retry reuses the stored document and the same run ID.

**pdf.js text with layout reconstruction.** Text fragments are grouped into visual lines by y-coordinate, and wide x-gaps become ` | ` column separators. That keeps table structure, which makes line items parseable across different vendor layouts.

**Tesseract.js for OCR.** Pure WASM: no system packages, works in Docker, serverless and locally. The English model is bundled (`@tesseract.js-data/eng`), so there are no network calls at runtime. Pages are rasterised at 2.5× with pdf.js + `@napi-rs/canvas` (prebuilt binaries, no native build). OCR noise such as `P0O-2026-0150` is normalised and reported as a correction.

**Field-level confidence.** Each field records how it was found (labelled field, column header, fallback pattern). OCR confidence scales it down. Overall confidence weights critical fields, and missing critical fields pull it below the auto-approval threshold.

**Claude for structured extraction (optional).** It runs only when a key is configured *and* the deterministic result is weak. It uses JSON-schema structured output, zod validation, a timeout and one retry. Failure falls back to the deterministic result with a warning. The model ID is configurable.

**Supabase Storage via a server-side proxy.** The service-role key never leaves the server. Original PDFs are served through `/api/runs/:id/document`, and RLS is enabled on all tables so the public API can't read them.

**pdf-lib for reports.** Pure JS, no headless browser needed, so it stays small and portable.

**Vitest + real fixtures.** Tests run the real pipeline on real PDFs (including the scanned one) against real Postgres semantics. That's the closest thing to the live demo.

## Edge-case selection

1. **Duplicate invoice.** The most expensive AP error (paying twice), including the hard concurrent case.
2. **Amount over PO balance.** Tests tolerance, cumulative tracking and line-level explanation of *why* (an unplanned emergency repair).
3. **Missing PO with two plausible candidates.** Shows judgment: search, explain, but refuse to guess.
4. **Missing invoice number and date.** Shows that the system never invents data and that critical gaps block automation.

Bonus scenarios: a scanned invoice (OCR plus correction of OCR errors), an inactive vendor (hard rule), a tax miscalculation, and partial invoicing against an annual PO.
