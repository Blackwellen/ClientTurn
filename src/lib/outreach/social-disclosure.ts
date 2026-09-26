import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadDataControls } from "@/lib/compliance/queries";
import {
  planSocialDisclosure,
  type SocialDisclosurePlan,
} from "@/lib/compliance/source-disclosure";

/**
 * The Article 14 plan for one social message, from live rows.
 *
 * `planSocialDisclosure` (pure) decides; this only gathers what it decides on:
 *
 *   * **First contact?** Nothing has yet been delivered to this person on any
 *     social platform, and no cold email step has gone out either. Once any of
 *     those has, the information was given (the email path attaches it to its
 *     first step), and repeating it is noise.
 *   * **Provenance** -- the `prospect_data_sources` rows, the same ones the
 *     email disclosure reads.
 *   * **Controller name and privacy notice** from data controls.
 *
 * A read that fails is a PARK with the reason, never a NONE: "could not check"
 * is not "nothing owed".
 */
export async function loadSocialDisclosurePlan(input: {
  businessId: string;
  prospectId: string;
  maxLength: number;
  personInitiated?: boolean;
}): Promise<SocialDisclosurePlan> {
  const admin = createAdminClient();

  const [sentSocial, sentEmail, sources, controls] = await Promise.all([
    admin
      .from("social_outbound_messages")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("prospect_id", input.prospectId)
      .eq("status", "SENT")
      .limit(1),
    admin
      .from("outreach_recipient_runs")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("prospect_id", input.prospectId)
      .gt("steps_sent", 0)
      .limit(1),
    admin
      .from("prospect_data_sources")
      .select("source_type")
      .eq("business_id", input.businessId)
      .eq("prospect_id", input.prospectId)
      .limit(50),
    loadDataControls(input.businessId),
  ]);

  const failed = sentSocial.error ?? sentEmail.error ?? sources.error;
  if (failed) {
    return {
      kind: "PARK",
      gap: `Could not confirm whether this person has already been told where their details came from (${failed.message}). The message is held until that can be checked.`,
    };
  }

  const isFirstContact =
    (sentSocial.data ?? []).length === 0 && (sentEmail.data ?? []).length === 0;

  return planSocialDisclosure({
    isFirstContact,
    personInitiated: input.personInitiated ?? false,
    provenanceTypes: [...new Set((sources.data ?? []).map((row) => row.source_type))],
    legalName: controls.legalName,
    privacyPolicyUrl: controls.privacyPolicyUrl,
    maxLength: Math.min(input.maxLength, 160),
  });
}
