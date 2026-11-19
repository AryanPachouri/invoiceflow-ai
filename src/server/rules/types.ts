export type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";
export type CheckAction = "REJECT" | "REVIEW" | "NONE";

/** One individually-recorded business rule evaluation. */
export interface Check {
  code: string;
  stage: string;
  label: string;
  status: CheckStatus;
  severity: "CRITICAL" | "MAJOR" | "MINOR";
  /** What a non-passing result means for the decision. */
  action: CheckAction;
  message: string;
  expected?: string | number | null;
  actual?: string | number | null;
  difference?: number | null;
  differencePct?: number | null;
}

export const pass = (c: Omit<Check, "status" | "action"> & { action?: CheckAction }): Check => ({ action: "NONE", ...c, status: "PASS" });
export const fail = (c: Omit<Check, "status">): Check => ({ ...c, status: "FAIL" });
export const warn = (c: Omit<Check, "status">): Check => ({ ...c, status: "WARN" });
export const skip = (c: Omit<Check, "status" | "action" | "severity"> & { severity?: Check["severity"] }): Check => ({ severity: "MINOR", ...c, status: "SKIP", action: "NONE" });

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number | null | undefined, ccy?: string | null) =>
  n === null || n === undefined ? "—" : `${ccy ? ccy + " " : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Normalise company names for comparison. */
export function normalizeName(s: string) {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|llc|ltd|limited|gmbh|co|corp|corporation|company|plc|ag|sa|bv|pvt|llp|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similarity 0..1 combining token overlap and character bigrams (robust to OCR noise). */
export function similarity(a: string, b: string) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = inter / new Set([...ta, ...tb]).size;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    const t = s.replace(/ /g, "");
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const ba = bigrams(na), bb = bigrams(nb);
  let overlap = 0, total = 0;
  for (const [k, v] of ba) { overlap += Math.min(v, bb.get(k) ?? 0); total += v; }
  for (const v of bb.values()) total += v;
  const dice = total ? (2 * overlap) / total : 0;
  return Math.round(Math.max(jaccard, dice) * 1000) / 1000;
}

export const normalizeTaxId = (s: string | null | undefined) => (s ? s.replace(/[^A-Z0-9]/gi, "").toUpperCase() : "");
export const normalizeInvoiceNumber = (s: string) => s.replace(/[^A-Z0-9]/gi, "").toUpperCase();
