# InvoiceFlow AI — Narration Script

**For:** `InvoiceFlow_Demo.mp4` (4:31, silent screen recording)
**Pace:** about 130 words per minute, relaxed. Each scene's narration is sized to fit its time slot with a little breathing room. If you finish a scene early, simply pause; the screen keeps showing that scene.
**Before recording:** replace the name in Scene 1 if needed. Read once along with the video before the real take.

> Everything described below is visible in the recording. All numbers quoted come from the actual run shown on screen.

---

## Scene 1 — Introduction
**Timestamp:** 00:00 – 00:15
**Screen:** InvoiceFlow AI dashboard (Accounts Payable Overview) loads.
**Action:** None. The page settles.

**Narration:**
> "Hi, I'm Aryan. This is InvoiceFlow AI, my prototype for the Zamp case study. It takes a vendor invoice PDF, checks it like an AP team would, and makes a decision it can explain."

---

## Scene 2 — Dashboard
**Timestamp:** 00:15 – 00:41
**Screen:** Cursor moves across the six KPI cards → page scrolls to the *Processing outcomes* chart and *Recent activity* → scrolls to the *Invoice history* table → back to the top.
**Action:** Hovering and scrolling only.

**Narration:**
> "This is the dashboard. Every number here comes from runs saved in the database. Right now there are four invoices, all approved. They're tagged *Sample* because I processed them at setup to give the purchase orders some history.
>
> Below are the outcome chart, recent activity, and the full invoice history."

---

## Scene 3 — Uploading the happy-path invoice
**Timestamp:** 00:41 – 01:01
**Screen:** *Process Invoice* page. The sample *Happy path — Apex Industrial* is clicked; the file `01-apex-happy-path.pdf` appears with an inline PDF preview. *Start processing* is clicked at 01:01.
**Action:** Load a real sample PDF, then start processing.

**Narration:**
> "Let's process an invoice. I'll load one of these samples. They're real PDF files.
>
> This one is from Apex Industrial Supplies. The preview shows the actual document: a PO reference, two line items, and a total of twelve thousand seven hundred forty-four dollars. Start processing."

---

## Scene 4 — Live execution
**Timestamp:** 01:01 – 01:21
**Screen:** Run #5 live monitor. Nine stages move from *Pending* to *Running* to *Completed*, with a progress bar and timings. The green **Approved for payment** banner appears at 01:15.
**Action:** None. Watching the pipeline run.

**Narration:**
> "This is the live view. All nine stages run on the server, and a stage only turns green once it has really finished. I've slowed the display a little so it's easy to follow.
>
> Extraction, validation, vendor, duplicates, PO matching, reconciliation… and it's approved."

---

## Scene 5 — What was extracted
**Timestamp:** 01:21 – 01:35
**Screen:** *2. Document Extraction* expanded: 12 fields with confidence percentages and the two line items.
**Action:** Expand and read.

**Narration:**
> "Here's what was read from the PDF: vendor, invoice number, dates, PO and amounts, each with a confidence score, plus both line items. Nothing is ever guessed."

---

## Scene 6 — Vendor and duplicate checks
**Timestamp:** 01:35 – 01:50
**Screen:** *4. Vendor Verification* (Apex Industrial Supplies, V-1001, Active, matched by tax ID) and *5. Duplicate Detection* (no duplicate) expanded.
**Action:** Expand and read.

**Narration:**
> "The vendor is matched against our approved vendor list, here by tax ID, and it's active.
>
> And there's no earlier or in-progress invoice with the same vendor and invoice number, or the same file."

---

## Scene 7 — Purchase order and reconciliation
**Timestamp:** 01:50 – 02:13
**Screen:** *6. Purchase Order Matching* (PO-2026-0141, $25,000 total, $9,000 previously invoiced, $16,000 remaining), then *7. Financial Reconciliation* (this invoice $11,800 net of tax, 2% tolerance, $4,200 remaining after, line items matched).
**Action:** Expand and scroll.

**Narration:**
> "The invoice points to PO 2026-0141, issued to this vendor. It's for twenty-five thousand dollars, and nine thousand is already invoiced, so sixteen thousand is left.
>
> This invoice's eleven thousand eight hundred, before tax, fits within that balance, so four thousand two hundred will remain. The line items match too."

---

## Scene 8 — The decision
**Timestamp:** 02:13 – 02:24
**Screen:** *8. Decision Engine* expanded: rule trace (Rule 1 none, Rule 2 none, Rule 3 satisfied, Rule 4 APPROVED) and "Allocated 11800 to PO-2026-0141".
**Action:** Expand, then scroll back to the top.

**Narration:**
> "The decision comes from fixed business rules, not AI, so it's consistent and explainable. Everything passed, so it's approved."

---

## Scene 9 — Edge case: amount over the PO balance
**Timestamp:** 02:24 – 02:46
**Screen:** Back on *Process Invoice*; sample *Edge case 2 — Amount exceeds PO balance* (`04-summit-amount-mismatch.pdf`) is loaded and started at 02:32. Run #6's pipeline runs live.
**Action:** Load and start the second invoice; watch it run.

**Narration:**
> "Now an edge case. This invoice is from Summit Facilities. The PO has four thousand five hundred dollars left, but they've billed five thousand seven hundred fifty, because they added an emergency repair that was never on the PO. That's an easy mistake to approve by hand."

---

## Scene 10 — Why it needs review
**Timestamp:** 02:46 – 03:21
**Screen:** Amber **Needs human review** banner with three reasons (02:46). Scrolls to the failed *7. Financial Reconciliation* stage (02:56): difference +$1,250 (27.78%), tolerance $90, remaining after −$1,250, line table showing "Emergency HVAC Repair — not on PO". Then the red *Purchase order position* card (03:11).
**Action:** Read the banner, scroll to reconciliation, then to the PO card.

**Narration:**
> "The system doesn't approve it, and it doesn't reject it either. It sends it to a person, with the reasons listed.
>
> Reconciliation shows exactly why: it's twelve hundred fifty dollars over the remaining balance, about twenty-eight percent, far beyond the ninety dollar tolerance. And the line comparison shows the emergency repair isn't on the PO at all.
>
> The PO card on the right says it plainly: this invoice would take the balance below zero."

---

## Scene 11 — Edge case: duplicate invoice
**Timestamp:** 03:21 – 03:46
**Screen:** *Process Invoice*; sample *Edge case 1 — Duplicate invoice* (`03-apex-duplicate.pdf`) is loaded and started at 03:27. Run #7 runs; the red **Rejected** banner appears at 03:38 and names run #1 as the original.
**Action:** Load and start the third invoice; watch the result.

**Narration:**
> "One more edge case: a duplicate. The vendor has sent invoice 0398 again, maybe as a reminder. It's a different file, but the same vendor and the same invoice number.
>
> It's rejected, and the system points straight to the original, run number one, which was already approved."

---

## Scene 12 — Duplicate detail
**Timestamp:** 03:46 – 03:59
**Screen:** *5. Duplicate Detection* FAILED with a link to run #1; *6. Purchase Order Matching* and *7. Financial Reconciliation* SKIPPED; *8. Decision Engine* "Rule 1 (hard failure) triggered by DUPLICATE_INVOICE".
**Action:** Scroll to the stages.

**Narration:**
> "PO matching and reconciliation were skipped. A confirmed duplicate can never move toward approval, so paying the same invoice twice is blocked."

---

## Scene 13 — Processing history
**Timestamp:** 03:59 – 04:18
**Screen:** *Processing History* lists all seven runs: rejected, needs review and approved, plus the four sample runs. At 04:10 the Apex happy-path run (run #5) is opened again and its approved report loads.
**Action:** Open history, click the earlier run.

**Narration:**
> "Every run is saved. Processing history shows the three invoices I just ran, alongside the sample history.
>
> If I reopen the first one, the full report is still there: the decision, every stage, every check."

---

## Scene 14 — Conclusion
**Timestamp:** 04:18 – 04:31
**Screen:** Dashboard with updated metrics: 7 processed, 5 approved, 1 needs review, 1 rejected, $48,434 total value, 71.4% approval rate; chart and recent activity updated.
**Action:** None.

**Narration:**
> "Back on the dashboard, the numbers have updated: seven invoices, five approved, one for review, one rejected.
>
> That's InvoiceFlow AI: real documents in, clear and explainable decisions out. Thanks for watching."

---

### Recording tips
- Record the voice-over while playing the video muted, starting both at 00:00.
- Every scene leaves a little slack. If you finish early, let the screen speak for a second before the next scene.
- If a sentence runs long, drop the last clause rather than rushing; the screen already shows the numbers.
- Pronunciations: "PO" = "P-O"; "INV-APX" can be skipped. Just say "invoice 0398".
