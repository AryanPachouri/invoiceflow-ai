/**
 * Deterministic, layout-tolerant invoice parser.
 *
 * Input: visual lines of text (from the PDF text layer or OCR), with table columns
 * separated by " | ". Output: structured fields + per-field confidence + warnings.
 *
 * Design rules:
 *  - Never invent data. A field that is not present in the document stays null.
 *  - Every value records how it was found (labelled field vs. fallback pattern) so the
 *    confidence score is explainable.
 */
import type { ExtractedInvoice, FieldKey, FieldWarning, LineItem } from "./types";
import { CRITICAL_FIELDS } from "./types";

type Found = { value: string; conf: number; how: string };

const PLACEHOLDER = /^(—|–|-+|n\/?a|none|tbd|null|\.+)$/i;

const LABELS: { field: FieldKey | "terms"; re: RegExp }[] = [
  { field: "invoiceNumber", re: /^(invoice\s*(number|no\.?|#|num|id)|inv\.?\s*(no\.?|#|number)|bill\s*(no\.?|number|#)|document\s*(no\.?|number))$/i },
  { field: "dueDate", re: /^(due\s*date|payment\s*due(\s*date)?|due\s*by|pay\s*by|date\s*due)$/i },
  { field: "invoiceDate", re: /^(invoice\s*date|issue\s*date|date\s*issued|issued\s*date|date\s*of\s*(issue|invoice)|issued(\s*on)?|dated|bill\s*date|date)$/i },
  { field: "poReference", re: /^(p\.?\s*o\.?(\s*(number|no\.?|#|ref(erence)?))?|purchase\s*order(\s*(number|no\.?|#|ref(erence)?))?|customer\s*p\.?\s*o\.?(\s*(ref(erence)?|number|no\.?|#))?|your\s*(order|po)\s*(ref(erence)?|no\.?)?|order\s*ref(erence)?)$/i },
  { field: "currency", re: /^(currency|invoice\s*currency)$/i },
  { field: "terms", re: /^(terms|payment\s*terms)$/i },
  { field: "subtotal", re: /^(sub\s*-?\s*total|net\s*(amount|total|value)|total\s*(before|excl\.?|excluding)\s*(tax|vat)|amount\s*before\s*tax|taxable\s*(amount|value))$/i },
  { field: "discountAmount", re: /^((less\s*)?discount|discount\s*amount|rebate)(\s*\(?\s*-?\d+(\.\d+)?\s*%\s*\)?)?$/i },
  { field: "taxAmount", re: /^((sales\s*)?tax|vat|gst|hst|tax\s*amount|vat\s*amount)(\s*\(?\s*@?\s*-?\d+(\.\d+)?\s*%\s*\)?)?$/i },
  { field: "totalAmount", re: /^(total(\s*(due|amount|payable|incl\.?\s*(tax|vat)))?|grand\s*total|amount\s*(due|payable)|balance\s*due|invoice\s*total)(\s*\(\s*[a-z]{3}\s*\))?$/i },
];

/** Labels that structure a document but don't map to a field (used to split merged header cells). */
const CONTEXT_LABEL = /^(bill(ed)?\s*to|ship(ped)?\s*to|sold\s*to|customer|client|from|to|description|item|items|qty|quantity|rate|price|unit\s*price|amount|notes?|deposit(\s*(requested|due))?)$/i;

/** Split a cell such as "Invoice Number Amount Due" into known label phrases, or null. */
function splitLabelPhrases(cell: string): string[] | null {
  const words = stripColon(cell).split(/\s+/);
  if (words.length < 2 || words.length > 10) return null;
  const isLabel = (t: string) => !!labelOf(t) || CONTEXT_LABEL.test(t);
  const memo = new Map<number, string[] | null>();
  const go = (i: number): string[] | null => {
    if (i === words.length) return [];
    if (memo.has(i)) return memo.get(i)!;
    let res: string[] | null = null;
    for (let j = Math.min(words.length, i + 5); j > i && !res; j--) {
      const phrase = words.slice(i, j).join(" ");
      if (isLabel(phrase)) {
        const rest = go(j);
        if (rest) res = [phrase, ...rest];
      }
    }
    memo.set(i, res);
    return res;
  };
  const parts = go(0);
  return parts && parts.length >= 2 ? parts : null;
}

const COMPANY_SUFFIX = /\b(inc|llc|l\.l\.c|ltd|limited|gmbh|co|corp|corporation|company|plc|ag|s\.?a|b\.?v|pvt|llp|group|management|services|systems|logistics|supplies|solutions)\b\.?/i;
const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY" };
const KNOWN_CODES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY", "CHF", "SGD", "AED"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const cellsOf = (line: string) => line.split(/\s*\|\s*/).map((c) => c.trim()).filter(Boolean);
const stripColon = (s: string) => s.replace(/[:：]\s*$/, "").trim();

function labelOf(cell: string) {
  const c = stripColon(cell);
  for (const l of LABELS) if (l.re.test(c)) return l.field;
  return null;
}

// ---------- value parsers ----------

export function parseMoney(raw: string): { value: number; currency?: string } | null {
  let s = raw.trim();
  if (!s || PLACEHOLDER.test(s)) return null;
  let currency: string | undefined;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) if (s.includes(sym)) currency = code;
  const code = s.match(/\b([A-Z]{3})\b/);
  if (code && KNOWN_CODES.includes(code[1])) currency = code[1];
  s = s.replace(/^\+\s*/, "");
  const negative = /^\(.*\)$/.test(s) || /^-|\s-\d|^[^\d]*-/.test(s);
  s = s.replace(/[A-Z]{3}|[$€£₹¥()\s]/g, "").replace(/^-/, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{2}$/.test(s)) normalized = s.replace(/\./g, "").replace(",", ".");
  else normalized = s.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return { value: negative ? -n : n, currency };
}

export function parseDate(raw: string): { iso: string; ambiguous: boolean } | null {
  const s = raw.trim().replace(/^(due|on|by)\s+/i, "").replace(/(\d)(st|nd|rd|th)\b/i, "$1");
  if (!s || PLACEHOLDER.test(s)) return null;
  const mk = (y: number, m: number, d: number, ambiguous = false) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    if (y < 1990 || y > 2100) return null;
    return { iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, ambiguous };
  };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi >= 0 ? mk(+m[3], mi + 1, +m[1]) : null;
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi >= 0 ? mk(+m[3], mi + 1, +m[2]) : null;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12) return mk(y, b, a); // dd/mm
    if (b > 12) return mk(y, a, b); // mm/dd
    return mk(y, a, b, a !== b); // assume US mm/dd, flag ambiguity
  }
  return null;
}

/** Normalise PO references, including common OCR confusions (O↔0, I↔1). */
export function normalizePo(raw: string): { value: string; corrected: boolean } | null {
  const s = raw.trim().replace(/^#/, "");
  if (!s || PLACEHOLDER.test(s)) return null;
  const m = s.match(/^P[\s.]*[O0Q]{1,2}[\s.#:-]*([0-9OIl]{4})[\s-]*([0-9OIl]{3,6})$/i);
  if (m) {
    const fix = (d: string) => d.replace(/[O]/gi, "0").replace(/[Il]/g, "1");
    const value = `PO-${fix(m[1])}-${fix(m[2])}`;
    return { value, corrected: value !== s.toUpperCase() };
  }
  if (/^[A-Z0-9][A-Z0-9\-/]{3,24}$/i.test(s) && /\d/.test(s)) return { value: s.toUpperCase(), corrected: false };
  return null;
}

function cleanInvoiceNumber(raw: string): string | null {
  const s = raw.trim().replace(/^[#:]\s*/, "").replace(/[.,;]$/, "");
  if (!s || PLACEHOLDER.test(s)) return null;
  if (!/\d/.test(s) || s.length < 3 || s.length > 32) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/_.]*$/.test(s)) return null;
  return s;
}

// ---------- main parser ----------

export interface ParseOutput {
  invoice: ExtractedInvoice;
  fieldConfidence: Partial<Record<FieldKey | "lineItems", number>>;
  warnings: FieldWarning[];
  notes: string[];
}

export function parseInvoiceText(rawLines: string[], opts: { ocrConfidence?: number } = {}): ParseOutput {
  const lines = rawLines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = lines.join("\n");
  const found: Partial<Record<FieldKey | "terms", Found>> = {};
  const warnings: FieldWarning[] = [];
  const notes: string[] = [];
  const set = (f: FieldKey | "terms", value: string | undefined, conf: number, how: string) => {
    if (!value || PLACEHOLDER.test(value.trim()) || found[f]) return;
    found[f] = { value: value.trim(), conf, how };
  };

  // 1) Labelled key/value pairs
  for (let i = 0; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    const labels = cells.map(labelOf);
    const labelCount = labels.filter(Boolean).length;
    // Header row: label cells whose values sit in the next row, same column order.
    // Merged label cells (e.g. OCR's "Invoice Number Amount Due") are split into slots first.
    if (labelCount >= 1 && i + 1 < lines.length) {
      const slots: { text: string; field: ReturnType<typeof labelOf>; context: boolean }[] = [];
      for (const c of cells) {
        const f = labelOf(c);
        const parts = f ? null : splitLabelPhrases(c);
        if (parts) parts.forEach((t) => slots.push({ text: t, field: labelOf(t), context: !labelOf(t) }));
        else slots.push({ text: c, field: f, context: !f && CONTEXT_LABEL.test(stripColon(c)) });
      }
      const next = cellsOf(lines[i + 1]);
      // a label only takes its value from below if nothing to its right is already its value
      const unpaired = slots.filter((sl, j) => sl.field && (j === slots.length - 1 || slots[j + 1].field || slots[j + 1].context));
      if (unpaired.length && next.length === slots.length && next.every((c) => !labelOf(c) && !CONTEXT_LABEL.test(stripColon(c)))) {
        slots.forEach((sl, j) => { if (sl.field && unpaired.includes(sl)) set(sl.field, next[j], 0.9, "column header"); });
        if (slots.every((sl) => sl.field || sl.context)) continue;
      }
    }
    cells.forEach((cell, j) => {
      // "Label: value" inside one cell
      const inline = cell.match(/^([^:]{2,40}):\s*(.+)$/);
      if (inline) {
        const f = labelOf(inline[1]);
        if (f) set(f, inline[2], 0.95, "labelled field");
      }
      const f = labels[j];
      if (!f) return;
      const nextCell = cells[j + 1];
      if (nextCell && !labelOf(nextCell)) set(f, nextCell, 0.95, "labelled field");
      else if (!nextCell && cells.length === 1 && i + 1 < lines.length && ["invoiceNumber", "invoiceDate", "dueDate", "poReference"].includes(f)) {
        const below = cellsOf(lines[i + 1])[0];
        if (below && !labelOf(below)) set(f, below, 0.8, "value below label");
      }
    });
  }

  const conf: Partial<Record<FieldKey | "lineItems", number>> = {};
  const inv: ExtractedInvoice = {
    vendorName: null, vendorAddress: null, vendorTaxId: null, invoiceNumber: null, invoiceDate: null, dueDate: null,
    poReference: null, currency: null, lineItems: [], subtotal: null, discountAmount: null, taxRate: null, taxAmount: null, totalAmount: null,
  };

  // 2) Invoice number
  if (found.invoiceNumber) {
    const v = cleanInvoiceNumber(found.invoiceNumber.value);
    if (v) { inv.invoiceNumber = v; conf.invoiceNumber = found.invoiceNumber.conf; }
    else warnings.push({ field: "invoiceNumber", severity: "WARNING", message: `Invoice number label found but value "${found.invoiceNumber.value}" is not a valid identifier` });
  }
  if (!inv.invoiceNumber) {
    const m = text.match(/\binvoice\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,30})/i);
    const v = m && cleanInvoiceNumber(m[1]);
    if (v) { inv.invoiceNumber = v; conf.invoiceNumber = 0.7; notes.push("Invoice number found by pattern match (no clear label)"); }
  }

  // 3) Dates
  for (const f of ["invoiceDate", "dueDate"] as const) {
    let src = found[f];
    if (f === "dueDate" && !src && found.terms && parseDate(found.terms.value)) src = { ...found.terms, conf: 0.85 };
    if (!src) continue;
    const d = parseDate(src.value);
    if (d) {
      inv[f] = d.iso;
      conf[f] = d.ambiguous ? src.conf * 0.8 : src.conf;
      if (d.ambiguous) warnings.push({ field: f, severity: "INFO", message: `Date "${src.value}" is ambiguous (MM/DD vs DD/MM); interpreted as US format ${d.iso}` });
    } else {
      warnings.push({ field: f, severity: "WARNING", message: `Could not parse date value "${src.value}"` });
    }
  }

  // 4) PO reference
  if (found.poReference) {
    const p = normalizePo(found.poReference.value);
    if (p) {
      inv.poReference = p.value;
      conf.poReference = found.poReference.conf * (p.corrected ? 0.85 : 1);
      if (p.corrected) warnings.push({ field: "poReference", severity: "INFO", message: `PO reference normalised from "${found.poReference.value}" to "${p.value}" (likely OCR character confusion)` });
    }
  }
  if (!inv.poReference) {
    const m = text.match(/\bP[O0]{1,2}[\s#:-]*(\d{4}[\s-]?\d{3,6})\b/i);
    if (m) {
      const p = normalizePo(m[0]);
      if (p) { inv.poReference = p.value; conf.poReference = 0.7; notes.push(`PO reference ${p.value} found by pattern match`); }
    }
  }

  // 5) Amounts
  const moneyField = (f: "subtotal" | "taxAmount" | "totalAmount") => {
    const src = found[f];
    if (!src) return;
    const m = parseMoney(src.value);
    if (m) { inv[f] = Math.round(m.value * 100) / 100; conf[f] = src.conf; }
    else warnings.push({ field: f, severity: "WARNING", message: `Could not parse amount "${src.value}"` });
  };
  moneyField("subtotal");
  if (found.discountAmount) {
    const m = parseMoney(found.discountAmount.value);
    if (m) { inv.discountAmount = Math.abs(Math.round(m.value * 100) / 100); conf.discountAmount = found.discountAmount.conf; }
  }
  moneyField("taxAmount");
  moneyField("totalAmount");
  const rate = text.match(/\b(?:tax|vat|gst)[^\n|%]{0,12}?(\d{1,2}(?:\.\d{1,3})?)\s*%/i);
  if (rate) inv.taxRate = Number(rate[1]);

  // 6) Line items: rows whose last three columns are qty, unit price, amount
  const items: LineItem[] = [];
  let mismatchedLines = 0;
  for (const line of lines) {
    let cells = cellsOf(line);
    if (cells.length < 4) {
      const m = line.match(/^(.*[A-Za-z].*?)\s+(\d+(?:\.\d+)?)\s+([$€£₹]?\s?[A-Z]{0,3}\s?[\d,]+\.\d{2})\s+([$€£₹]?\s?[A-Z]{0,3}\s?[\d,]+\.\d{2})$/);
      if (!m) continue;
      cells = [m[1], m[2], m[3], m[4]];
    }
    const [c1, c2, c3] = cells.slice(-3);
    const desc = cells.slice(0, -3).join(" ").trim();
    if (!/[A-Za-z]{3,}/.test(desc) || labelOf(desc) || CONTEXT_LABEL.test(desc)) continue;
    const plain = (x: string) => /^\d+(\.\d+)?$/.test(x.replace(/,/g, ""));
    const a = parseMoney(c3);
    if (!a) continue;
    // Column order varies by vendor: "qty | unit price | amount" or "rate | qty | amount".
    let q: number, u: { value: number } | null;
    if (plain(c1) && !plain(c2)) { q = Number(c1.replace(/,/g, "")); u = parseMoney(c2); }
    else if (plain(c2) && !plain(c1)) { q = Number(c2.replace(/,/g, "")); u = parseMoney(c1); }
    else if (plain(c1)) { q = Number(c1.replace(/,/g, "")); u = parseMoney(c2); }
    else continue;
    if (!u) continue;
    const ok = Math.abs(q * u.value - a.value) <= Math.max(0.02, Math.abs(a.value) * 0.005);
    if (!ok) mismatchedLines++;
    items.push({ description: desc, quantity: q, unitPrice: u.value, amount: a.value });
  }
  inv.lineItems = items;
  conf.lineItems = items.length ? (mismatchedLines ? 0.6 : 0.9) : 0;
  if (mismatchedLines) warnings.push({ field: "lineItems", severity: "WARNING", message: `${mismatchedLines} line item(s) where quantity × unit price ≠ line amount` });

  // 7) Currency
  const votes: Record<string, number> = {};
  const vote = (c: string | undefined, w: number) => { if (c) votes[c] = (votes[c] ?? 0) + w; };
  if (found.currency) {
    const c = found.currency.value.toUpperCase().match(/[A-Z]{3}/)?.[0];
    vote(c, 5);
  }
  for (const m of text.matchAll(/\((?:in\s*)?([A-Z]{3})\)|amounts?\s+in\s+([A-Z]{3})\b/gi)) vote((m[1] ?? m[2]).toUpperCase(), 4);
  for (const m of text.matchAll(/(?:^|[\s|(])([A-Z]{3})\s?\d/g)) if (KNOWN_CODES.includes(m[1])) vote(m[1], 1);
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    const n = text.split(sym).length - 1;
    if (n) vote(code, Math.min(n, 3) * 0.8);
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    inv.currency = ranked[0][0];
    conf.currency = ranked[0][1] >= 4 ? 0.95 : 0.8;
    if (ranked[0][1] < 4) notes.push(`Currency ${inv.currency} inferred from currency symbols/codes in amounts`);
    if (ranked.length > 1 && ranked[1][1] >= 2) warnings.push({ field: "currency", severity: "WARNING", message: `Multiple currencies appear in the document (${ranked.map((r) => r[0]).join(", ")})` });
  }

  // 8) Vendor name, address, tax id (top of document, excluding the bill-to party)
  const billTo = new Set<string>();
  lines.forEach((l, i) => {
    const sold = l.match(/^(?:sold|bill(?:ed)?|ship(?:ped)?)\s*to\s*:?\s*(.+)$/i);
    if (sold && cellsOf(sold[1])[0]) billTo.add(cellsOf(sold[1])[0].toLowerCase());
    if (/^(bill(ed)?\s*to|sold\s*to|customer)\s*:?$/i.test(cellsOf(l)[0] ?? "") && lines[i + 1]) billTo.add(cellsOf(lines[i + 1])[0].toLowerCase());
  });
  let vendorLine = -1;
  const top = lines.slice(0, 8);
  const candidates: { s: string; i: number; score: number }[] = [];
  top.forEach((l, i) => {
    for (const c of cellsOf(l)) {
      const cs = stripColon(c);
      if (/^(tax\s*)?invoice$/i.test(cs) || labelOf(cs) || billTo.has(cs.toLowerCase())) continue;
      if (/\d{3,}/.test(cs) || /@/.test(cs) || cs.length < 3 || /^(bill|sold|ship)/i.test(cs)) continue;
      if (/\b(tax\s*id|vat\s*no|ein)\b/i.test(cs)) continue;
      let score = 1 / (i + 1);
      if (COMPANY_SUFFIX.test(cs)) score += 1;
      candidates.push({ s: cs, i, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]) {
    const s = candidates[0].s;
    inv.vendorName = s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()) : s;
    conf.vendorName = COMPANY_SUFFIX.test(s) ? 0.9 : 0.65;
    vendorLine = candidates[0].i;
  }
  if (vendorLine >= 0) {
    const addr: string[] = [];
    for (let i = vendorLine + 1; i < Math.min(lines.length, vendorLine + 4) && addr.length < 2; i++) {
      const c = cellsOf(lines[i])[0] ?? "";
      if (labelOf(c) || /\b(tax\s*id|vat\s*no|ein|invoice|bill|sold)\b/i.test(c) || /@/.test(c)) break;
      if (/\d/.test(c) && (/,/.test(c) || /\b(st|street|ave|blvd|road|rd|suite|strasse|str\.)\b/i.test(c))) addr.push(c);
      else break;
    }
    if (addr.length) { inv.vendorAddress = addr.join(", "); conf.vendorAddress = 0.8; }
  }
  const tax = text.match(/\b(?:tax\s*id|vat\s*(?:no\.?|number|reg(?:istration)?(?:\s*no\.?)?)|ein|tin|gstin|abn)\s*[:#.]?\s*([A-Z]{2}\s?[0-9][0-9A-Z \-]{5,16}[0-9A-Z]|[0-9][0-9\- ]{6,14}[0-9])/i);
  if (tax) { inv.vendorTaxId = tax[1].replace(/\s+/g, "").toUpperCase(); conf.vendorTaxId = 0.9; }

  // 9) OCR scaling of confidences
  if (opts.ocrConfidence !== undefined) {
    const k = Math.min(1, opts.ocrConfidence / 100 + 0.05);
    for (const key of Object.keys(conf) as (keyof typeof conf)[]) conf[key] = Math.round((conf[key] ?? 0) * k * 100) / 100;
  }

  return { invoice: inv, fieldConfidence: conf, warnings, notes };
}

/** Warnings for fields that are absent. Missing values are reported, never filled in by guesswork. */
export function missingFieldWarnings(inv: ExtractedInvoice): FieldWarning[] {
  const warnings: FieldWarning[] = [];
  const human: Record<string, string> = {
    vendorName: "Vendor name", invoiceNumber: "Invoice number", invoiceDate: "Invoice date", totalAmount: "Total amount",
  };
  for (const f of CRITICAL_FIELDS) if (inv[f] === null) warnings.push({ field: f, severity: "CRITICAL", message: `${human[f]} not found in document` });
  if (!inv.currency) warnings.push({ field: "currency", severity: "CRITICAL", message: "Currency could not be determined" });
  if (!inv.poReference) warnings.push({ field: "poReference", severity: "WARNING", message: "No purchase order reference found on invoice" });
  if (!inv.dueDate) warnings.push({ field: "dueDate", severity: "INFO", message: "Due date not stated" });
  if (inv.subtotal === null) warnings.push({ field: "subtotal", severity: "WARNING", message: "Subtotal not stated on invoice" });
  if (inv.taxAmount === null) warnings.push({ field: "taxAmount", severity: "INFO", message: "Tax amount not stated on invoice" });
  if (!inv.vendorTaxId) warnings.push({ field: "vendorTaxId", severity: "INFO", message: "Vendor tax ID not present" });
  if (!inv.lineItems.length) warnings.push({ field: "lineItems", severity: "WARNING", message: "No itemised line items could be identified" });
  return warnings;
}

/** Overall extraction confidence (0..100). Missing critical fields pull it down. */
export function overallConfidence(inv: ExtractedInvoice, conf: Partial<Record<FieldKey | "lineItems", number>>) {
  const weights: [FieldKey | "lineItems", number][] = [
    ["vendorName", 2], ["invoiceNumber", 2], ["invoiceDate", 2], ["totalAmount", 2], ["currency", 1.5],
    ["subtotal", 1], ["lineItems", 1],
  ];
  let sum = 0, wsum = 0;
  for (const [k, w] of weights) { sum += (conf[k] ?? 0) * w; wsum += w; }
  for (const k of ["poReference", "dueDate", "taxAmount", "vendorTaxId"] as const) {
    if (inv[k] !== null) { sum += (conf[k] ?? 0) * 0.5; wsum += 0.5; }
  }
  return Math.round((sum / wsum) * 1000) / 10;
}
