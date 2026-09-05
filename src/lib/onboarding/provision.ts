import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_AUTOMATIONS } from "@/lib/automation/defaults";
import { findUnknownMergeFields } from "@/lib/automation/scheduler";

/**
 * Gives a workspace its published new-lead sequence.
 *
 * Nothing is ever sent without one, so this runs during onboarding rather than
 * leaving the customer to build a sequence before the product does anything.
 * Idempotent: an existing definition is left alone.
 */
export async function ensureDefaultAutomations(
  businessId: string,
  publishedBy: string | null,
): Promise<{ created: number }> {
  const admin = createAdminClient();
  let created = 0;

  for (const automation of DEFAULT_AUTOMATIONS) {
    const { data: existing } = await admin
      .from("automation_definitions")
      .select("id")
      .eq("business_id", businessId)
      .eq("type", automation.type)
      .maybeSingle();

    if (existing) continue;

    // A template with an unknown token would be unpublishable in the editor, so
    // refuse to seed one rather than create a sequence the UI cannot save.
    for (const step of automation.steps) {
      const unknown = findUnknownMergeFields(step.template);
      if (unknown.length > 0) {
        throw new Error(
          `Default template uses unknown merge field(s): ${unknown.join(", ")}`,
        );
      }
    }

    const { data: definition, error: definitionError } = await admin
      .from("automation_definitions")
      .insert({
        business_id: businessId,
        type: automation.type,
        name: automation.name,
        enabled: true,
      })
      .select("id")
      .single();
    if (definitionError || !definition) throw definitionError;

    const { data: version, error: versionError } = await admin
      .from("automation_versions")
      .insert({
        business_id: businessId,
        automation_id: definition.id,
        version_number: 1,
        status: "PUBLISHED",
        published_at: new Date().toISOString(),
        published_by: publishedBy,
      })
      .select("id")
      .single();
    if (versionError || !version) throw versionError;

    const { error: stepsError } = await admin.from("automation_steps").insert(
      automation.steps.map((step) => ({
        business_id: businessId,
        version_id: version.id,
        position: step.position,
        delay_seconds: step.delaySeconds,
        channel: step.channel,
        template: step.template,
        enabled: true,
      })),
    );
    if (stepsError) throw stepsError;

    created += 1;
  }

  return { created };
}

export type ActivationCheck = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  blocking: boolean;
};

/**
 * The activation checklist from the product bible. Read directly from the
 * database rather than from the recorded wizard step, so a workspace cannot be
 * activated on the strength of a step counter alone.
 */
export async function getActivationChecks(
  businessId: string,
): Promise<ActivationCheck[]> {
  const admin = createAdminClient();

  const [business, settings, services, questions, integrations, published, testLead] =
    await Promise.all([
      admin
        .from("businesses")
        .select("name, timezone")
        .eq("id", businessId)
        .maybeSingle(),
      admin
        .from("business_settings")
        .select("booking_mode, booking_url, default_channel, opt_out_wording")
        .eq("business_id", businessId)
        .maybeSingle(),
      admin
        .from("services")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId),
      admin
        .from("qualification_questions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("active", true),
      admin
        .from("integrations")
        .select("provider_type, status")
        .eq("business_id", businessId),
      admin
        .from("automation_versions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", "PUBLISHED"),
      admin
        .from("leads")
        .select("status")
        .eq("business_id", businessId)
        .eq("is_test", true)
        .maybeSingle(),
    ]);

  const providers = integrations.data ?? [];
  const bookingMode = settings.data?.booking_mode ?? "handover";
  const bookingReady =
    bookingMode === "handover"
      ? true
      : Boolean(settings.data?.booking_url) ||
        providers.some(
          (row) => row.provider_type === bookingMode && row.status === "HEALTHY",
        );

  const leadSource = providers.find((row) => row.provider_type === "meta");

  return [
    {
      key: "business",
      label: "Business details complete",
      passed: Boolean(business.data?.name && business.data?.timezone),
      detail: business.data?.name
        ? `${business.data.name} · ${business.data.timezone}`
        : "Add your business name and timezone.",
      blocking: true,
    },
    {
      key: "services",
      label: "At least one service",
      passed: (services.count ?? 0) > 0,
      detail: `${services.count ?? 0} configured`,
      blocking: true,
    },
    {
      key: "qualification",
      label: "Qualification configured",
      passed: (questions.count ?? 0) > 0,
      detail: `${questions.count ?? 0} question${(questions.count ?? 0) === 1 ? "" : "s"}`,
      blocking: true,
    },
    {
      key: "sequence",
      label: "Published follow-up sequence",
      passed: (published.count ?? 0) > 0,
      detail:
        (published.count ?? 0) > 0
          ? "New lead follow-up is published"
          : "No published sequence — nothing would be sent.",
      blocking: true,
    },
    {
      key: "messaging",
      label: "Messaging configured",
      passed: Boolean(settings.data?.default_channel && settings.data?.opt_out_wording),
      detail: settings.data?.default_channel
        ? `${settings.data.default_channel.toUpperCase()}, opt-out wording set`
        : "Choose a default channel.",
      blocking: true,
    },
    {
      key: "booking",
      label: "Booking or handover configured",
      passed: bookingReady,
      detail:
        bookingMode === "handover"
          ? "Qualified leads are handed to a person"
          : bookingReady
            ? `${bookingMode} link set`
            : "Add a booking link, or switch to handover.",
      blocking: true,
    },
    {
      key: "lead_source",
      label: "Lead source connected",
      passed: leadSource?.status === "HEALTHY",
      // Not blocking: a workspace can go live and connect Meta afterwards.
      detail: leadSource
        ? `Meta is ${leadSource.status}`
        : "Not connected yet — you can add this later from Integrations.",
      blocking: false,
    },
    {
      key: "test_lead",
      label: "Test lead successful",
      passed: Boolean(testLead.data),
      // Not blocking: recommended before going live, but not required — a
      // workspace can still activate and run its first test afterwards.
      detail: testLead.data
        ? `Test lead status: ${testLead.data.status}`
        : "Not run yet — send a test lead below.",
      blocking: false,
    },
  ];
}
