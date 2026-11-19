# InvoiceFlow AI — Demo Video Timeline

**File:** `InvoiceFlow_Demo.mp4` · **Duration:** 4:31 · **Resolution:** 1920 × 1080 (16:9) · **Frame rate:** 30 fps · **Codec:** H.264, no audio track (narration to be added)

Recorded from the real, running production build of InvoiceFlow AI. Nothing in the video is simulated: every invoice was uploaded as a PDF, processed by the backend, and its decision stored in the database. Timestamps come from the recorder's frame clock, which matches wall-clock time exactly.

## Recording setup (for transparency)

| Item | Value |
|---|---|
| App build | Production Next.js standalone server (`npm run build`) |
| Data | Fresh embedded database seeded with sample vendors, POs and 4 sample history invoices (tagged **SAMPLE**) |
| Stage pacing | `PIPELINE_STAGE_DELAY_MS=1400`: each stage stays on screen for at least 1.4 s so viewers can follow it. Durations shown inside the app are the real processing times. |
| Browser | Chromium driven by Playwright at a 1536 × 864 layout, captured in real time and scaled to 1080p |
| Cursor | A small blue dot marks the pointer position (headless browsers don't draw a cursor) |
| Theme | Light mode |

## Sample invoices used

| # | File | Scenario | Result shown |
|---|---|---|---|
| 1 | `01-apex-happy-path.pdf` | Happy path: Apex Industrial, explicit PO-2026-0141 | **APPROVED** (run #5) |
| 2 | `04-summit-amount-mismatch.pdf` | **Edge case:** invoice exceeds the remaining PO balance | **NEEDS REVIEW** (run #6) |
| 3 | `03-apex-duplicate.pdf` | **Edge case:** re-sent invoice INV-APX-2026-0398 | **REJECTED** (run #7, duplicate of run #1) |

## Scene timeline

| Scene | Start–End | Page | What happens on screen |
|---|---|---|---|
| 1. Introduction | 00:00–00:15 | Dashboard | App loads; Accounts Payable Overview with 4 sample-history runs |
| 2. Dashboard | 00:15–00:41 | Dashboard | Cursor moves across the six KPI cards (00:15); scrolls to *Processing outcomes* chart and *Recent activity* (00:24); scrolls to the *Invoice history* table (00:33), then back to top |
| 3. Upload | 00:41–01:01 | Process Invoice | Opens upload page (00:42); clicks sample *Happy path — Apex Industrial* (00:48); file chip and inline PDF preview appear (00:51); clicks **Start processing** (01:01) |
| 4. Live pipeline | 01:01–01:21 | Run #5 monitor | Nine stages run one by one with live statuses, timings and progress bar; **Approved for payment** banner at 01:15 |
| 5. Extraction | 01:21–01:35 | Run #5 report | Expands *2. Document Extraction*: 12 fields with per-field confidence, 2 line items |
| 6. Vendor & duplicates | 01:35–01:50 | Run #5 report | Expands *4. Vendor Verification* (V-1001, Active, matched by tax ID) and *5. Duplicate Detection* (no duplicate) |
| 7. PO & reconciliation | 01:50–02:13 | Run #5 report | Expands *6. Purchase Order Matching* (PO-2026-0141, $16,000 remaining) and *7. Financial Reconciliation* ($11,800 vs $16,000, 2% tolerance, $4,200 remaining after) |
| 8. Decision | 02:13–02:24 | Run #5 report | Expands *8. Decision Engine*: rule trace and "Allocated 11800 to PO-2026-0141" |
| 9. Edge case: mismatch | 02:24–02:46 | Process Invoice → Run #6 | Loads *Edge case 2 — Amount exceeds PO balance* (02:25), starts processing (02:32), live pipeline runs |
| 10. Mismatch result | 02:46–03:21 | Run #6 report | **Needs human review** banner with 3 reasons (02:46); scrolls to failed *Financial Reconciliation* (02:56): +$1,250 (27.78%) over the $4,500 remaining, tolerance $90, "Emergency HVAC Repair" not on PO; *Purchase order position* card in red (03:11) |
| 11. Edge case: duplicate | 03:21–03:46 | Process Invoice → Run #7 | Loads *Edge case 1 — Duplicate invoice* (03:22), starts processing (03:27); **Rejected** banner at 03:38 |
| 12. Duplicate detail | 03:46–03:59 | Run #7 report | Shows *5. Duplicate Detection* FAILED (original = run #1), stages 6 and 7 SKIPPED, *8. Decision Engine* "Rule 1 (hard failure) triggered by DUPLICATE_INVOICE" |
| 13. History | 03:59–04:18 | Processing History → Run #5 | History lists all 7 runs (3 new + 4 sample) with status badges (04:00); opens run #5 again (04:10): its approved report is intact |
| 14. Conclusion | 04:18–04:31 | Dashboard | Metrics updated from the database: 7 processed, 5 approved, 1 needs review, 1 rejected, $48,434 total, 71.4% approval rate |

## Edge cases demonstrated

1. **Amount mismatch (primary):** invoice subtotal $5,750 against $4,500 remaining on PO-2026-0172. The system calculates the exact difference (+$1,250, 27.78%), compares it to the 2% tolerance ($90), flags a line not on the PO, and routes the invoice to **NEEDS REVIEW**.
2. **Duplicate invoice:** INV-APX-2026-0398 was already processed (run #1). The system identifies the original run, records a hard failure, skips PO matching and reconciliation, and **REJECTS** the invoice.
