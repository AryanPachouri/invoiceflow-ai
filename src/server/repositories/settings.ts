import { z } from "zod";
import type { Queryable } from "../db";
import { DEFAULT_RULES, type BusinessRules } from "../seed/data";

const action = z.enum(["REJECT", "REVIEW"]);

export const BusinessRulesSchema = z.object({
  version: z.number().int().positive(),
  tolerancePercent: z.number().min(0, "Tolerance cannot be negative").max(20, "Tolerance above 20% is not permitted"),
  toleranceAbsoluteMin: z.number().min(0).max(1000),
  allowedCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/, "Currencies must be 3-letter ISO codes")).min(1, "At least one currency is required"),
  duplicateDetection: z.object({
    byVendorAndInvoiceNumber: z.boolean(),
    byFingerprint: z.boolean(),
    // A suspected duplicate can never be silently ignored, so there's no "allow" option.
    action,
  }).refine((d) => d.byVendorAndInvoiceNumber || d.byFingerprint, { message: "At least one duplicate detection method must remain enabled" }),
  autoApproval: z.object({
    enabled: z.boolean(),
    maxAmount: z.number().positive().max(10_000_000),
    minExtractionConfidence: z.number().min(0).max(100),
    requireExplicitPo: z.boolean(),
  }),
  hardFailures: z.object({
    inactiveVendor: action,
    poVendorMismatch: action,
    unknownVendor: action,
  }),
});

const KEY = "business_rules";

export async function getRules(db: Queryable): Promise<BusinessRules> {
  const { rows } = await db.query<{ value: unknown }>("SELECT value FROM app_settings WHERE key = $1", [KEY]);
  if (!rows[0]) return structuredClone(DEFAULT_RULES);
  const parsed = BusinessRulesSchema.safeParse({ ...DEFAULT_RULES, ...(rows[0].value as object) });
  return parsed.success ? (parsed.data as BusinessRules) : structuredClone(DEFAULT_RULES);
}

export async function saveRules(db: Queryable, input: unknown): Promise<{ ok: true; rules: BusinessRules } | { ok: false; errors: string[] }> {
  const current = await getRules(db);
  const parsed = BusinessRulesSchema.safeParse({ ...(input as object), version: current.version + 1 });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "rules"}: ${i.message}`) };
  }
  const rules = { ...parsed.data, allowedCurrencies: [...new Set(parsed.data.allowedCurrencies)] } as BusinessRules;
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(rules)],
  );
  return { ok: true, rules };
}

export async function resetRules(db: Queryable) {
  await db.query("DELETE FROM app_settings WHERE key = $1", [KEY]);
  return getRules(db);
}
