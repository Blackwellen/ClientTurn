import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { bucketFor, chooseVariant } from "./variant-allocation";

/**
 * Variant assignment at send time.
 *
 * `campaigns/variants.ts` can author an experiment and allocate traffic across
 * its variants. Nothing chose one for a particular recipient, applied its
 * content, or recorded which one they got — so the A/B machinery was writable
 * and unmeasurable at the same time. An experiment nobody can read the result
 * of is worse than no experiment: it costs sends and settles nothing.
 *
 * Three properties this module holds:
 *
 *   * **Sticky.** A recipient keeps the variant they were first assigned for
 *     the whole sequence. Switching a person between variants mid-sequence
 *     would make every downstream reply unattributable, because you could not
 *     say which message earned it.
 *   * **Deterministic.** Assignment is a hash of the recipient run id, not a
 *     random draw, so a retried send re-derives the same variant instead of
 *     re-rolling and double-counting.
 *   * **Honest about samples.** Counts are incremented on real events only.
 *     Nothing here estimates or back-fills.
 */

export type AssignedVariant = {
  id: string;
  label: string;
  subject: string | null;
  body: string | null;
};

type VariantRow = {
  id: string;
  label: string;
  content_json: unknown;
  allocation_percent: number;
};

function contentField(content: unknown, key: string): string | null {
  if (!content || typeof content !== "object") return null;
  const value = (content as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Resolves the variant this recipient should receive for this step.
 *
 * Returns null when the step has no running experiment, which is the common
 * case — most steps are not being tested.
 */
export async function assignVariant(input: {
  businessId: string;
  campaignId: string;
  stepId: string;
  recipientRunId: string;
  /** The variant already assigned to this recipient, if any. */
  existingVariantId: string | null;
}): Promise<AssignedVariant | null> {
  const admin = createAdminClient();

  // Stickiness first: a recipient already in a variant stays in it, even if
  // allocations have since been re-weighted.
  if (input.existingVariantId) {
    const { data: existing } = await admin
      .from("campaign_variants")
      .select("id, label, content_json")
      .eq("business_id", input.businessId)
      .eq("id", input.existingVariantId)
      .maybeSingle();

    if (existing) {
      return {
        id: existing.id,
        label: existing.label,
        subject: contentField(existing.content_json, "subject"),
        body: contentField(existing.content_json, "body"),
      };
    }
  }

  const { data: experiment } = await admin
    .from("campaign_experiments")
    .select("id")
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .eq("status", "RUNNING")
    .limit(1)
    .maybeSingle();

  if (!experiment) return null;

  const { data: variants } = await admin
    .from("campaign_variants")
    .select("id, label, content_json, allocation_percent")
    .eq("business_id", input.businessId)
    .eq("experiment_id", experiment.id)
    .eq("step_id", input.stepId)
    .eq("active", true)
    .order("created_at", { ascending: true });

  const chosen = chooseVariant(
    (variants ?? []) as VariantRow[],
    bucketFor(input.recipientRunId),
  );
  if (!chosen) return null;

  return {
    id: chosen.id,
    label: chosen.label,
    subject: contentField(chosen.content_json, "subject"),
    body: contentField(chosen.content_json, "body"),
  };
}

/**
 * Records one real event against a variant.
 *
 * Read-modify-write rather than a raw increment because supabase-js has no
 * atomic increment; the counters are reporting aggregates, not money, and a
 * lost increment under concurrency understates a sample rather than
 * overstating a result. The dispatcher is the only writer of `sent`, and it
 * holds a per-sender slot while it sends, so contention is minimal.
 */
export async function recordVariantEvent(input: {
  businessId: string;
  variantId: string;
  event: "sent" | "delivered" | "reply" | "positive_reply" | "conversion" | "bounce" | "complaint";
}): Promise<void> {
  const admin = createAdminClient();

  const { data: current } = await admin
    .from("campaign_variants")
    .select(
      "sent_count, delivered_count, reply_count, positive_reply_count, conversion_count, bounce_count, complaint_count",
    )
    .eq("business_id", input.businessId)
    .eq("id", input.variantId)
    .maybeSingle();

  if (!current) return;

  // Written as an explicit object per event rather than a computed key: the
  // generated Insert type rejects an index signature, and spelling the seven
  // cases out is what makes it impossible to increment a column that is not a
  // counter.
  const patch =
    input.event === "sent"
      ? { sent_count: current.sent_count + 1 }
      : input.event === "delivered"
        ? { delivered_count: current.delivered_count + 1 }
        : input.event === "reply"
          ? { reply_count: current.reply_count + 1 }
          : input.event === "positive_reply"
            ? { positive_reply_count: current.positive_reply_count + 1 }
            : input.event === "conversion"
              ? { conversion_count: current.conversion_count + 1 }
              : input.event === "bounce"
                ? { bounce_count: current.bounce_count + 1 }
                : { complaint_count: current.complaint_count + 1 };

  await admin
    .from("campaign_variants")
    .update(patch)
    .eq("business_id", input.businessId)
    .eq("id", input.variantId);
}

// Re-exported so callers keep one import site for variant behaviour.
export { bucketFor, chooseVariant };
