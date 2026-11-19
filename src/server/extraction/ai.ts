/**
 * Optional Claude-assisted extraction for difficult layouts.
 *
 * Guardrails:
 *  - Only runs when ANTHROPIC_API_KEY is configured; otherwise the deterministic parser is used.
 *  - Output is constrained with a JSON schema and validated with zod.
 *  - Grounding check: an AI-proposed value is accepted only if it can be found in the
 *    document text. Ungrounded values are discarded (never invented).
 *  - The AI only proposes extracted fields. It never makes or overrides decisions.
 */
import { env } from "../env";
import { ExtractedInvoiceSchema, type ExtractedInvoice } from "./types";

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "vendorName", "vendorAddress", "vendorTaxId", "invoiceNumber", "invoiceDate", "dueDate", "poReference",
    "currency", "lineItems", "subtotal", "discountAmount", "taxRate", "taxAmount", "totalAmount",
  ],
  properties: {
    vendorName: { type: ["string", "null"] },
    vendorAddress: { type: ["string", "null"] },
    vendorTaxId: { type: ["string", "null"] },
    invoiceNumber: { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"], description: "ISO yyyy-mm-dd" },
    dueDate: { type: ["string", "null"], description: "ISO yyyy-mm-dd" },
    poReference: { type: ["string", "null"] },
    currency: { type: ["string", "null"], description: "ISO 4217 code" },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPrice", "amount"],
        properties: {
          description: { type: "string" },
          quantity: { type: ["number", "null"] },
          unitPrice: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
        },
      },
    },
    subtotal: { type: ["number", "null"] },
    discountAmount: { type: ["number", "null"], description: "discount as a positive number, if stated" },
    taxRate: { type: ["number", "null"], description: "percent, e.g. 8 for 8%" },
    taxAmount: { type: ["number", "null"] },
    totalAmount: { type: ["number", "null"] },
  },
} as const;

const SYSTEM = `You extract fields from vendor invoices for an accounts-payable system.
Return only values that literally appear in the invoice text. If a field is absent, unreadable or a placeholder (such as "—"), return null. Never estimate, compute or guess missing values. In particular, do not calculate a missing total, tax or subtotal.
The vendor is the party issuing the invoice, not the "Bill To" or "Sold To" customer.
Dates: convert to yyyy-mm-dd. Amounts: plain numbers without currency symbols or thousands separators.`;

export interface AiExtraction {
  invoice: ExtractedInvoice;
  model: string;
}

export function aiAvailable() {
  return !!env.anthropicApiKey;
}

export async function extractWithClaude(documentText: string): Promise<AiExtraction> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: env.anthropicApiKey, timeout: env.aiTimeoutMs, maxRetries: 1 });
  const response = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: JSON_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: `Invoice text (table columns separated by " | "):\n\n${documentText}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("AI extraction declined the request");
  if (response.stop_reason === "max_tokens") throw new Error("AI extraction output was truncated");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("AI extraction returned no text");
  const parsed = ExtractedInvoiceSchema.safeParse(JSON.parse(text.text));
  if (!parsed.success) throw new Error(`AI output failed schema validation: ${parsed.error.issues[0]?.message}`);
  return { invoice: parsed.data, model: response.model };
}

/** Is an AI-proposed value present in the source document? */
export function isGrounded(value: string | number | null, documentText: string): boolean {
  if (value === null || value === undefined) return true;
  const doc = documentText.toLowerCase().replace(/\s+/g, " ");
  if (typeof value === "number") {
    const plain = documentText.replace(/[,\s]/g, "");
    const variants = [value.toFixed(2), String(value), value.toFixed(2).replace(".", ",")];
    return variants.some((v) => plain.includes(v));
  }
  const v = value.toLowerCase().trim();
  if (doc.includes(v)) return true;
  // dates are normalised by the model; accept when the day and year appear in the text
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return doc.includes(iso[1]) && new RegExp(`\\b0?${Number(iso[3])}\\b`).test(doc);
  // tolerate whitespace/punctuation differences
  const squash = (s: string) => s.replace(/[^a-z0-9]/g, "");
  return squash(doc).includes(squash(v));
}
