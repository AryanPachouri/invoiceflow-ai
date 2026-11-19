import type { BusinessRules } from "../seed/data";
import { money, type Check } from "./types";

export type FinalStatus = "APPROVED" | "NEEDS_REVIEW" | "REJECTED";

export interface Decision {
  status: FinalStatus;
  headline: string;
  reasons: string[];
  passedChecks: Check[];
  failedChecks: Check[];
  warnings: Check[];
  ruleTrace: string[];
}

/**
 * Stage 8 — deterministic decision engine.
 *
 *   1. Any failed check whose action is REJECT       → REJECTED   (hard failures)
 *   2. Any failed/warned check whose action is REVIEW → NEEDS_REVIEW
 *   3. Auto-approval policy gates (enabled, max amount)
 *   4. Otherwise                                     → APPROVED
 *
 * No AI is involved here, so an AI model can never override a hard-failure rule.
 */
export function decide(
  checks: Check[],
  rules: BusinessRules,
  ctx: { totalAmount: number | null; currency: string | null; systemNotes?: string[] },
): Decision {
  const failed = checks.filter((c) => c.status === "FAIL");
  const warnings = checks.filter((c) => c.status === "WARN");
  const passed = checks.filter((c) => c.status === "PASS");
  const trace: string[] = [];

  const rejecting = failed.filter((c) => c.action === "REJECT");
  if (rejecting.length) {
    trace.push(`Rule 1 (hard failure) triggered by: ${rejecting.map((c) => c.code).join(", ")}`);
    return {
      status: "REJECTED",
      headline: rejecting[0].message,
      reasons: rejecting.map((c) => c.message).concat(failed.filter((c) => c.action !== "REJECT").map((c) => c.message)),
      passedChecks: passed, failedChecks: failed, warnings, ruleTrace: trace,
    };
  }
  trace.push("Rule 1 (hard failure): none");

  const reviewing = [...failed, ...warnings].filter((c) => c.action === "REVIEW");
  if (reviewing.length) {
    trace.push(`Rule 2 (needs human review) triggered by: ${reviewing.map((c) => c.code).join(", ")}`);
    const ordered = [...reviewing].sort((a, b) => sevRank(a) - sevRank(b) || (a.status === "FAIL" ? -1 : 1));
    return {
      status: "NEEDS_REVIEW",
      headline: ordered[0].message,
      reasons: ordered.map((c) => c.message),
      passedChecks: passed, failedChecks: failed, warnings, ruleTrace: trace,
    };
  }
  trace.push("Rule 2 (needs review): none");

  if (!rules.autoApproval.enabled) {
    trace.push("Rule 3: automatic approval is disabled in settings");
    return { status: "NEEDS_REVIEW", headline: "All checks passed, but automatic approval is disabled. Ready for one-click approval", reasons: ["Automatic approval is disabled by configuration"], passedChecks: passed, failedChecks: failed, warnings, ruleTrace: trace };
  }
  if (ctx.totalAmount !== null && ctx.totalAmount > rules.autoApproval.maxAmount) {
    trace.push(`Rule 3: total ${ctx.totalAmount} exceeds auto-approval limit ${rules.autoApproval.maxAmount}`);
    return { status: "NEEDS_REVIEW", headline: `All checks passed, but the total ${money(ctx.totalAmount, ctx.currency)} exceeds the auto-approval limit of ${money(rules.autoApproval.maxAmount, ctx.currency)}`, reasons: [`Total exceeds auto-approval limit of ${money(rules.autoApproval.maxAmount, ctx.currency)}`], passedChecks: passed, failedChecks: failed, warnings, ruleTrace: trace };
  }
  trace.push("Rule 3 (auto-approval policy): satisfied");
  trace.push("Rule 4: APPROVED");
  return {
    status: "APPROVED",
    headline: `All ${passed.length} checks passed. Vendor verified, no duplicate, PO matched and amounts reconciled`,
    reasons: [`Approved: ${passed.length} checks passed with no failures or review flags`],
    passedChecks: passed, failedChecks: failed, warnings, ruleTrace: trace,
  };
}

const sevRank = (c: Check) => (c.severity === "CRITICAL" ? 0 : c.severity === "MAJOR" ? 1 : 2);
