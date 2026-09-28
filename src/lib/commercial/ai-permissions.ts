/**
 * What the AI may do (brief §74): commercial authority v2.
 *
 * One switch per commercial capability, least privilege: everything is OFF
 * until an owner or admin turns it on, except qualifying a lead and booking a
 * meeting, which is what the assistant has always done. The deterministic
 * gates read these switches server-side (agent/quote-flow.ts `quoteToolGate`,
 * agent/tools.ts); the settings card only writes them.
 *
 * The discount block is the owner's discount policy for the assistant, in the
 * units a person thinks in (percent and pounds). `discountPolicyFromAuthority`
 * (quotes/discount-policy.ts) maps it onto the basis-point policy that
 * `evaluateDiscount` decides with, so there is one discount decision for the
 * quote builder, the approval flow and the assistant.
 *
 * Stored as two jsonb columns on commercial_authority (migration 0158):
 * `ai_permissions` and `ai_discount_policy`. Read defensively: a malformed or
 * missing value means the defaults, never "allowed".
 *
 * Pure: zod and relative imports only.
 */

import { z } from "zod";

/* ----------------------------------------------------------- capabilities */

export const AI_PERMISSIONS = [
  "qualify",
  "book",
  "call",
  "create_quote",
  "send_quote",
  "discount",
  "request_signature",
  "create_invoice",
  "send_payment_link",
  "mark_won",
  "transfer_human",
] as const;
export type AiPermission = (typeof AI_PERMISSIONS)[number];

/** Least privilege (owner decision 2026-09-27): only qualify and book start on. */
export const AI_PERMISSION_DEFAULTS: Readonly<Record<AiPermission, boolean>> = {
  qualify: true,
  book: true,
  call: false,
  create_quote: false,
  send_quote: false,
  discount: false,
  request_signature: false,
  create_invoice: false,
  send_payment_link: false,
  mark_won: false,
  transfer_human: false,
};

export const AI_PERMISSION_LABEL: Readonly<Record<AiPermission, string>> = {
  qualify: "Qualify leads",
  book: "Book meetings",
  call: "Phone leads",
  create_quote: "Draft quotes",
  send_quote: "Send quotes",
  discount: "Offer discounts",
  request_signature: "Ask for a signature",
  create_invoice: "Raise invoices",
  send_payment_link: "Send payment links",
  mark_won: "Mark deals won",
  transfer_human: "Transfer live calls to a person",
};

export const AI_PERMISSION_DESCRIPTION: Readonly<Record<AiPermission, string>> = {
  qualify: "Ask your qualification questions and record the answers. Your rules decide the result.",
  book: "Offer real times from your calendar and book the meeting the lead picks.",
  call: "Phone a lead the assistant decides to call (a lead who asked for a call, or agreed a call-back). Only leads who asked for or consented to calls; calling hours and your Voice settings still apply. A person pressing Call with AI is not affected.",
  create_quote: "Draft a quote from your catalogue when a lead asks for a price. Prices always come from your catalogue.",
  send_quote: "Send a drafted quote to the lead without a person pressing send. Off: a person sends it.",
  discount: "Offer a discount within the limits below. Anything above them goes to a person.",
  request_signature: "Point a lead who accepted a quote to the signature step on their quote page.",
  create_invoice: "Raise an invoice from a signed quote.",
  send_payment_link: "Point a lead to the payment step on their quote page.",
  mark_won: "Mark a deal won. Payment confirmation does this already, with evidence.",
  transfer_human: "Hand a live phone call to a colleague, using the transfer number in your Voice settings. Off: the assistant offers a call-back instead.",
};

/**
 * Capabilities the assistant has a code path for today. The rest are stored
 * and shown, and are enforced by the feature that owns them (voice calling,
 * invoicing) when it reads `aiMay`. The settings card says which.
 */
export const AI_PERMISSIONS_ENFORCED_BY_ASSISTANT: readonly AiPermission[] = [
  "qualify",
  "book",
  "create_quote",
  "send_quote",
  "discount",
  "request_signature",
  "send_payment_link",
  // Voice P3 (voice/tools, voice/channel-orchestration): an AI-initiated call
  // (the next-action engine choosing a call, an AI call-back agreed on a call)
  // needs "call"; the in-call transfer tool needs "transfer_human". A person
  // pressing "Call with AI" and a call the lead makes back are not gated.
  "call",
  "transfer_human",
];

/** Capabilities that only make sense together: sending needs drafting. */
export const AI_PERMISSION_REQUIRES: Partial<Record<AiPermission, AiPermission>> = {
  send_quote: "create_quote",
  discount: "create_quote",
  request_signature: "send_quote",
  send_payment_link: "send_quote",
};

export const aiCapabilitiesSchema = z.object(
  Object.fromEntries(AI_PERMISSIONS.map((key) => [key, z.boolean()])) as Record<AiPermission, z.ZodBoolean>,
);
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>;

/* --------------------------------------------------------------- discount */

export const DISCOUNT_RESTRAINTS = ["NEVER", "ONLY_AFTER_OBJECTION", "PROACTIVE"] as const;
export type DiscountRestraint = (typeof DISCOUNT_RESTRAINTS)[number];

export const DISCOUNT_RESTRAINT_LABEL: Readonly<Record<DiscountRestraint, string>> = {
  NEVER: "Never",
  ONLY_AFTER_OBJECTION: "Only after the lead objects on price",
  PROACTIVE: "May offer it unprompted",
};

const percent = z.number().min(0).max(100);
const money = z.number().int().min(0).max(1_000_000_000_000);

/**
 * The owner's discount policy for the assistant. Percentages are of the
 * price before the discount; money is minor units of the workspace currency.
 */
export const aiDiscountSettingsSchema = z
  .object({
    restraint: z.enum(DISCOUNT_RESTRAINTS).default("NEVER"),
    /** The most the assistant may take off, as a percentage. */
    maxPercent: percent.default(0),
    /** The most the assistant may take off in money. null = no money cap. */
    maxAmountMinor: money.nullable().default(null),
    /** The assistant's first, small concession. null = the maximum. */
    firstConcessionPercent: percent.nullable().default(null),
    /** The lowest margin a discounted quote may keep. null = no floor. */
    marginFloorPercent: z.number().min(-100).max(100).nullable().default(null),
    /** A discount above this percentage needs a person's approval. */
    approvalAbovePercent: percent.nullable().default(null),
    /** A discount above this amount needs a person's approval. */
    approvalAboveAmountMinor: money.nullable().default(null),
    /** A quote above this value needs a person's approval. */
    approvalAboveValueMinor: money.nullable().default(null),
    /** Who approves. */
    approvalRole: z.enum(["admin", "owner"]).default("admin"),
  })
  .superRefine((value, ctx) => {
    if (value.firstConcessionPercent !== null && value.firstConcessionPercent > value.maxPercent) {
      ctx.addIssue({ code: "custom", path: ["firstConcessionPercent"], message: "The first concession cannot be above the maximum." });
    }
    if (value.restraint !== "NEVER" && value.maxPercent === 0 && value.maxAmountMinor === null) {
      ctx.addIssue({ code: "custom", path: ["maxPercent"], message: "Set a maximum, or choose Never." });
    }
  });
export type AiDiscountSettings = z.infer<typeof aiDiscountSettingsSchema>;

export const DEFAULT_AI_DISCOUNT: AiDiscountSettings = aiDiscountSettingsSchema.parse({});

/* ----------------------------------------------------------------- whole */

export const aiAuthoritySchema = z.object({
  version: z.literal(2),
  capabilities: aiCapabilitiesSchema,
  discount: aiDiscountSettingsSchema,
});
export type AiAuthority = z.infer<typeof aiAuthoritySchema>;

export const DEFAULT_AI_AUTHORITY: AiAuthority = {
  version: 2,
  capabilities: { ...AI_PERMISSION_DEFAULTS },
  discount: DEFAULT_AI_DISCOUNT,
};

/**
 * The stored jsonb, read defensively. Each capability is `true` only when
 * the stored value is literally `true` (an unknown key or a string "yes" is
 * the default); a discount policy that does not parse is the default (NEVER).
 */
export function parseAiAuthority(permissions: unknown, discount: unknown): AiAuthority {
  const raw = permissions && typeof permissions === "object" && !Array.isArray(permissions) ? (permissions as Record<string, unknown>) : {};
  const capabilities = { ...AI_PERMISSION_DEFAULTS };
  for (const key of AI_PERMISSIONS) {
    if (typeof raw[key] === "boolean") capabilities[key] = raw[key] as boolean;
  }
  // Dependencies hold even on a hand-edited row: sending without drafting is
  // not a state the gates have to reason about.
  for (const [key, needs] of Object.entries(AI_PERMISSION_REQUIRES) as [AiPermission, AiPermission][]) {
    if (capabilities[key] && !capabilities[needs]) capabilities[key] = false;
  }
  const parsed = aiDiscountSettingsSchema.safeParse(discount ?? {});
  return { version: 2, capabilities, discount: parsed.success ? parsed.data : DEFAULT_AI_DISCOUNT };
}

/** The one question every gate asks. */
export function aiMay(authority: AiAuthority | null | undefined, permission: AiPermission): boolean {
  return (authority ?? DEFAULT_AI_AUTHORITY).capabilities[permission] === true;
}

/**
 * A save from the settings card: validates, applies the dependencies (turning
 * drafting off turns sending, discounting, signature and payment prompts off
 * too) and returns the two column values.
 */
export function normaliseAiAuthorityInput(input: unknown):
  | { ok: true; value: AiAuthority }
  | { ok: false; path: string; message: string } {
  const shape = z.object({ capabilities: aiCapabilitiesSchema.partial(), discount: z.record(z.string(), z.unknown()).default({}) }).safeParse(input);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    return { ok: false, path: issue?.path.join(".") ?? "", message: issue?.message ?? "Those settings are not valid." };
  }
  const capabilities = parseAiAuthority(shape.data.capabilities, null).capabilities;
  // Without the discount switch the policy is NEVER, whatever the form held.
  const discountInput = capabilities.discount ? shape.data.discount : { ...shape.data.discount, restraint: "NEVER" };
  const discount = aiDiscountSettingsSchema.safeParse(discountInput);
  if (!discount.success) {
    const issue = discount.error.issues[0];
    return { ok: false, path: ["discount", ...(issue?.path ?? [])].join("."), message: issue?.message ?? "That discount policy is not valid." };
  }
  if (capabilities.discount && discount.data.restraint === "NEVER") {
    return { ok: false, path: "discount.restraint", message: "Choose when the assistant may offer a discount, or turn discounts off." };
  }
  return { ok: true, value: { version: 2, capabilities, discount: discount.data } };
}
