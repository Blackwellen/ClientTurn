import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAzureConfigured } from "@/lib/ai/azure-client";
import { runTask } from "@/lib/ai/model-router";
import type { VariantGenerationResult } from "@/lib/ai/schemas";
import { wrapUntrustedContent } from "@/lib/ai/safety";
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  MERGE_FIELDS,
  unknownMergeFields,
  type CampaignDraft,
  type SequenceStep,
} from "../campaign-draft";

/**
 * AI-assisted message variants (V4 section 17.6, resolved conflict 1).
 *
 * The assist layer's whole remit here is *wording*. It cannot decide who is
 * contacted, when, or how often, and everything it returns is a proposal a
 * person has to accept before it can be sent. That is what keeps the
 * deterministic engine the system of record.
 *
 * Two guards on the way out, applied to every proposal:
 *   - no merge field we cannot fill, so nothing renders as `{{...}}` in a
 *     stranger's inbox;
 *   - no unsupported claim, so the model cannot invent a price, a guarantee,
 *     an availability or an accreditation on the customer's behalf.
 */

export type VariantProposal = {
  label: string;
  subject: string;
  body: string;
  /** Anything a person should look at before accepting it. */
  warnings: string[];
};

export type VariantResult =
  | { ok: true; variants: VariantProposal[] }
  | { ok: false; error: string };

/**
 * Claims the model must not make on a business's behalf.
 *
 * Deliberately blunt: a proposal containing any of these is rejected rather
 * than edited, because a half-corrected guarantee is still a guarantee.
 */
const PROHIBITED = [
  /\bguarantee(d|s)?\b/i,
  /\bcheapest\b/i,
  /\blowest price\b/i,
  /\bfree\s+(?:quote|survey)\b.*\bguarantee/i,
  /\bno\.?\s*1\b/i,
  /\bbest in\b/i,
  /\baward[- ]winning\b/i,
  /\bcertified\b/i,
  /\baccredited\b/i,
  /£\s?\d/,
  /\b\d+\s*%\s*(?:off|discount)\b/i,
  /\bsame[- ]day\b/i,
  /\bwithin \d+ (?:hours|days)\b/i,
];

/**
 * The prompt itself now lives in `ai/prompts.ts` under `variant_generation`,
 * and the call goes through `runTask` rather than `chat`.
 *
 * That is the whole point of the change: `chat()` is the transport. Everything
 * that makes AI spend accountable -- the prompt version stamped on the run, the
 * per-workspace token gate checked *before* the call, the `ai_runs` row and the
 * cost event -- lives in `runTask`, and a caller that goes straight to the
 * transport gets none of it. This was the only such caller left, which meant
 * every variant generated was invisible to the customer's usage meter and to
 * margin reporting at the same time.
 */

export async function generateVariants(input: {
  businessId: string;
  draft: CampaignDraft;
  step: SequenceStep;
  count: number;
}): Promise<VariantResult> {
  if (!isAzureConfigured()) {
    return {
      ok: false,
      error: "AI assistance is not configured for this workspace.",
    };
  }

  // Per-workspace switch, off by default (resolved conflict 1). A plan that
  // includes the assist layer still does not turn it on without a decision.
  const enabled = await assistEnabled(input.businessId);
  if (!enabled) {
    return {
      ok: false,
      error: "AI assistance is switched off. Turn it on in Settings, AI.",
    };
  }

  const context = await businessContext(input.businessId, input.draft);

  const result = await runTask<VariantGenerationResult>({
    taskType: "variant_generation",
    businessId: input.businessId,
    maxOutputTokens: 1200,
    // The customer's own copy is untrusted input to the model, not instructions
    // to it: a campaign body containing "ignore previous instructions" must stay
    // a campaign body.
    context: [
      `Business: ${context.businessName}`,
      `Service being promoted: ${context.serviceName ?? "not specified"}`,
      `Goal: ${input.draft.goal.conversionGoal ?? "not specified"}`,
      `Audience: ${describeAudience(input.draft)}`,
      // Supplied rather than baked into the prompt, so the list the model is
      // told about and the list `unknownMergeFields` enforces are the same list.
      `Merge fields you may use: ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(", ")}`,
      `Write ${input.count} variant${input.count === 1 ? "" : "s"} of this email.`,
      "",
      "Existing subject:",
      wrapUntrustedContent(input.step.subject || "(none yet)"),
      "",
      "Existing body:",
      wrapUntrustedContent(input.step.body || "(none yet)"),
    ].join("\n"),
  });

  // `NO_TOKENS` is a billing state, not a failure. Saying so is the difference
  // between a customer topping up and a customer filing a bug.
  if (result.skippedReason === "NO_TOKENS") {
    return {
      ok: false,
      error: "This workspace has used its AI allowance for the period.",
    };
  }
  if (result.skippedReason === "AI_UNAVAILABLE" || result.data === null) {
    return { ok: false, error: "AI assistance is unavailable right now. Try again shortly." };
  }

  const parsed = result.data.variants;
  if (parsed.length === 0) {
    return { ok: false, error: "The generated variants could not be used. Try again." };
  }

  // Rejected proposals are dropped, never repaired. Presenting a cleaned-up
  // version of a prohibited claim would hide that it was made at all.
  const usable = parsed
    .map((variant, index) => review(variant, index))
    .filter((variant): variant is VariantProposal => variant !== null)
    .slice(0, input.count);

  if (usable.length === 0) {
    return {
      ok: false,
      error:
        "Every generated variant made a claim we cannot support, so none were kept. Try again, or write them yourself.",
    };
  }

  return { ok: true, variants: usable };
}

function review(
  variant: { label?: string; subject?: string; body?: string },
  index: number,
): VariantProposal | null {
  const subject = (variant.subject ?? "").trim().slice(0, MAX_SUBJECT_LENGTH);
  const body = (variant.body ?? "").trim().slice(0, MAX_BODY_LENGTH);

  if (!subject || body.length < 20) return null;
  if (PROHIBITED.some((pattern) => pattern.test(subject) || pattern.test(body))) return null;

  const unknown = [...unknownMergeFields(subject), ...unknownMergeFields(body)];
  if (unknown.length > 0) return null;

  const warnings: string[] = [];
  if (body.length > 900) warnings.push("Longer than a cold email usually wants to be.");
  if (!/\?/.test(body)) warnings.push("No question, so there is nothing obvious to reply to.");

  return {
    // B, C, D — A is always the copy the customer wrote.
    label: (variant.label ?? "").trim().slice(0, 4) || String.fromCharCode(66 + index),
    subject,
    body,
    warnings,
  };
}

function describeAudience(draft: CampaignDraft): string {
  const parts = [
    draft.audience.roles.join(", "),
    draft.audience.industries.join(", "),
    draft.audience.locations.join(", "),
  ].filter((part) => part.length > 0);

  return parts.length > 0 ? parts.join(" · ") : "not specified";
}

async function businessContext(
  businessId: string,
  draft: CampaignDraft,
): Promise<{ businessName: string; serviceName: string | null }> {
  const admin = createAdminClient();

  const [business, service] = await Promise.all([
    admin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    draft.goal.primaryServiceId
      ? admin
          .from("services")
          .select("name")
          .eq("business_id", businessId)
          .eq("id", draft.goal.primaryServiceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    businessName: business.data?.name ?? "the business",
    serviceName: service.data?.name ?? null,
  };
}

/**
 * The per-workspace assist toggle, read from the one column that owns it.
 *
 * `business_settings.ai_assist_enabled` is what Settings writes and what the
 * conversation agent reads; a second flag on `business_ai_settings` would let
 * the two disagree about whether AI is on.
 */
async function assistEnabled(businessId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_settings")
    .select("ai_assist_enabled")
    .eq("business_id", businessId)
    .maybeSingle();

  return Boolean(data?.ai_assist_enabled);
}
