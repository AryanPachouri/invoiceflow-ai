/**
 * Optional Claude rewrite of a deterministic email draft for tone and readability.
 * Guardrail: every amount, date, percentage and reference in the AI output must already appear
 * in the deterministic draft. If anything new appears (a hallucinated figure or reference),
 * the AI version is discarded and the template draft is kept.
 */
import { env } from "../env";
import type { EmailDraft } from "./draft";

const TOKEN_RE = /(?:[A-Z]{2,5}[-/]?\d[\w-]*|\d[\d,]*(?:\.\d+)?%?)/g;

export function ungroundedTokens(candidate: string, source: string) {
  const norm = (t: string) => t.replace(/,/g, "");
  const allowed = new Set((source.match(TOKEN_RE) ?? []).map(norm));
  return [...new Set((candidate.match(TOKEN_RE) ?? []).map(norm))].filter((t) => !allowed.has(t) && !/^[0-9]$/.test(t));
}

export async function polishWithClaude(draft: EmailDraft): Promise<{ subject: string; body: string } | { error: string }> {
  if (!env.anthropicApiKey) return { error: "AI drafting requires ANTHROPIC_API_KEY" };
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: env.anthropicApiKey, timeout: env.aiTimeoutMs, maxRetries: 1 });
    const res = await client.messages.create({
      model: env.anthropicModel,
      max_tokens: 2000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["subject", "body"], properties: { subject: { type: "string" }, body: { type: "string" } } } },
      },
      system: "You edit accounts-payable emails to suppliers. Improve clarity and professional tone only. Keep every fact, amount, date, invoice/PO number and requested action exactly as given. Do not add facts, promises, payment dates or new requests. Plain text, no markdown. Keep the greeting and sign-off.",
      messages: [{ role: "user", content: `Rewrite this email.\n\nSUBJECT: ${draft.subject}\n\nBODY:\n${draft.body}` }],
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return { error: `AI drafting stopped (${res.stop_reason})` };
    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { error: "AI returned no text" };
    const out = JSON.parse(block.text) as { subject: string; body: string };
    const extra = ungroundedTokens(`${out.subject}\n${out.body}`, `${draft.subject}\n${draft.body}`);
    if (extra.length) return { error: `AI draft discarded: it introduced values not in the invoice record (${extra.slice(0, 3).join(", ")})` };
    return { subject: out.subject.trim(), body: out.body.trim() + "\n" };
  } catch (e) {
    return { error: `AI drafting failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
