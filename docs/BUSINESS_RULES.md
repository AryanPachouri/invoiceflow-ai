# Business Rules

The decision engine (`src/server/rules/decision.ts`) is deterministic. Every rule produces an individually recorded **check** with a status (`PASS`, `FAIL`, `WARN`, `SKIP`), a severity, and an **action** that says what a failure means:

* `REJECT`: hard failure. Any one of these → **REJECTED**.
* `REVIEW`: needs a human. Any one of these (with no REJECT) → **NEEDS_REVIEW**.
* `NONE`: informational only.

Evaluation order:

1. Any failed check with action REJECT → **REJECTED**
2. Any failed/warned check with action REVIEW → **NEEDS_REVIEW**
3. Auto-approval policy: disabled, or total above the limit → **NEEDS_REVIEW**
4. Otherwise → **APPROVED**, and the PO allocation is committed under a row lock. If the live balance no longer covers the invoice (a concurrent approval consumed it), the run is downgraded to **NEEDS_REVIEW** with check `PO_BALANCE_AT_COMMIT`.

## Default configuration (editable in Settings, validated, versioned)

| Setting | Default | Validation |
|---|---|---|
| Tolerance | 2% of remaining PO balance (min 1.00 currency unit) | 0–20% |
| Allowed currencies | USD, EUR, GBP, INR | ≥1 ISO-4217 code |
| Duplicate detection | vendor + invoice # **and** document fingerprint; action REJECT | at least one method on; action REJECT or REVIEW (never "ignore") |
| Auto-approval | enabled; max total 50,000; min extraction confidence 70%; explicit PO required | amount > 0; confidence 0–100 |
| Inactive vendor | REJECT | REJECT / REVIEW |
| PO owned by another vendor | REJECT | REJECT / REVIEW |
| Unknown vendor | REVIEW | REJECT / REVIEW |

## Rule catalogue

### Stage 3: Validation
| Code | Rule | On failure |
|---|---|---|
| `REQUIRED_VENDORNAME/INVOICENUMBER/INVOICEDATE/TOTALAMOUNT/CURRENCY` | Field present | REVIEW (critical) |
| `INVOICE_NUMBER_FORMAT` | 3–32 chars, alphanumeric with `- / _ .`, contains a digit | REVIEW |
| `INVOICE_DATE_VALID` | Not >1 day in future (FAIL); >365 days old (WARN) | REVIEW |
| `DUE_DATE_VALID` | Due date ≥ invoice date | REVIEW |
| `CURRENCY_ALLOWED` | In allowed list | REVIEW |
| `AMOUNTS_NON_NEGATIVE`, `TOTAL_NON_ZERO` | No negative/invalid/zero amounts (credit notes are manual) | REVIEW |
| `LINE_ARITHMETIC` | qty × unit price = amount (±0.05) | REVIEW |
| `SUBTOTAL_CALC` | Σ lines = subtotal (±0.05) | REVIEW |
| `TAX_CALC` | Stated rate × subtotal = tax (±0.05); if no rate, implied rate ≤ 30% | REVIEW |
| `TOTAL_CALC` | subtotal + tax = total (±0.05) | REVIEW |
| `EXTRACTION_CONFIDENCE` | ≥ configured minimum | REVIEW |

### Stage 4: Vendor
| `VENDOR_EXISTS` | Match by tax ID → exact name → fuzzy name (≥ 0.82 and clearly better than the runner-up) | configurable (REVIEW) |
| `VENDOR_ACTIVE` | Vendor status ACTIVE. INACTIVE → configurable (**REJECT**); PENDING_VERIFICATION (e.g. registered from an invoice) → REVIEW, never approved until verified | configurable / REVIEW |
| `VENDOR_NAME_CONSISTENT` | Invoice name ≥ 82% similar to master | REVIEW |
| `VENDOR_TAX_ID_CONSISTENT` | Tax ID equals master (possible fraud / changed details) | REVIEW |

### Stage 5: Duplicates
| `DUPLICATE_INVOICE` | No other in-flight, approved or under-review run holds the same `vendor + normalised invoice number` or the same SHA-256 fingerprint | configurable (**REJECT**) |

Claims are released when a run ends REJECTED or FAILED, so a corrected resubmission of a rejected invoice can be processed. Invoice numbers are normalised (case and punctuation insensitive: `INV-0398` = `inv0398`). When the vendor is unknown, the extracted vendor name is used as the vendor key.

### Stage 6: PO matching
| `PO_EXISTS` | Referenced PO exists | REVIEW (then candidate search) |
| `PO_VENDOR_MATCH` | PO issued to the invoicing vendor | configurable (**REJECT**) |
| `PO_OPEN` | PO status OPEN | REVIEW |
| `PO_REFERENCE_PRESENT` | Invoice cites a PO | REVIEW if explicit PO required (**never rejects**) |
| `PO_CANDIDATES` | 0 viable → REVIEW; >1 viable → REVIEW (ambiguous, none selected); exactly 1 → inferred, REVIEW if explicit PO required | REVIEW |

A candidate is viable if it is the vendor's OPEN PO in the same currency with remaining balance ≥ subtotal (within tolerance). Candidates are scored on currency, amount fit and line-item description similarity, and the scores are shown for explainability.

### Stage 7: Reconciliation (PO values are net of tax)
| `CURRENCY_MATCH` | Invoice currency = PO currency | REVIEW |
| `SUBTOTAL_WITHIN_PO_BALANCE` | subtotal − remaining ≤ max(remaining × tolerance%, absolute min) | REVIEW |
| `CUMULATIVE_WITHIN_PO` | previously invoiced + subtotal ≤ PO total + tolerance | REVIEW |
| `TAX_REASONABLE` | tax ≤ 30% of subtotal | REVIEW |
| `LINE_ITEMS_MATCH_PO` | each line maps to a PO line (≥ 0.6 similarity), unit price within tolerance, qty ≤ PO qty | REVIEW |

Partial invoicing is supported: any subtotal up to the remaining balance passes, and the remaining balance after approval is shown.

### Stage 8: Decision guards
| `PO_ALLOCATION` | An approval must have a PO to allocate against | REVIEW |
| `PO_BALANCE_AT_COMMIT` | Live balance re-checked under row lock at commit | REVIEW |
| `DOCUMENT_READABLE` (stage 2) | PDF parses / OCR succeeds | REVIEW (manual entry) |

## Vendor onboarding and re-processing

* A vendor registered from an invoice is created as **PENDING_VERIFICATION** (the API refuses ACTIVE for invoice-sourced vendors). Activation is a separate, explicit action on the Vendors page.
* Re-running verification creates a **new run** linked by `reprocessed_from_run_id`. The original is marked `superseded_by_run_id`, keeps its decision and stages, and hands its duplicate claims to the new run. All nine stages are re-evaluated with the current rules and vendor master. Approved runs and duplicate submissions can't be re-processed.

## Vendor emails

* Drafts are generated from recorded checks only. Scenarios: REJECTED (hard-fail reasons only), MISSING_INFORMATION (only missing fields / PO), NEEDS_REVIEW (discrepancies plus any missing items), APPROVED (confirmation, no payment claims).
* Nothing is sent automatically. Sending requires explicit confirmation, a configured provider, and valid recipients. A send is recorded as SENT only on provider acceptance.
