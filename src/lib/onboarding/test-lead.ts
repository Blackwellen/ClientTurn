import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { normalisePhone } from "@/lib/messaging/types";

export type TestLeadOutcome = {
  leadId: string;
  status: string;
  messages: {
    body: string;
    status: string;
    channel: string;
    provider: string | null;
    error: string | null;
  }[];
  conversationId: string | null;
};

const TEST_EXTERNAL_ID = "clientturn-onboarding-test";

/**
 * Creates a synthetic lead and drives it through the same internal path a real
 * Meta lead takes — no shortcut, or the test would prove nothing.
 *
 * The lead is flagged `is_test` so it never reaches production analytics, and
 * carries a fixed external id so re-running replaces the previous attempt
 * rather than accumulating clutter.
 */
export type TestLeadOverrides = {
  name?: string;
  phone?: string;
  serviceId?: string;
  message?: string;
};

export async function createTestLead(
  businessId: string,
  ownerFirstName: string | null,
  overrides?: TestLeadOverrides,
): Promise<{ leadId: string }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("leads")
    .select("id")
    .eq("business_id", businessId)
    .eq("external_id", TEST_EXTERNAL_ID)
    .maybeSingle();

  if (existing) {
    await admin.from("leads").delete().eq("id", existing.id);
  }

  const { data: services } = await admin
    .from("services")
    .select("id, name")
    .eq("business_id", businessId)
    .order("position");

  const service =
    (overrides?.serviceId && services?.find((row) => row.id === overrides.serviceId)) ||
    services?.[0] ||
    null;

  // A number in Ofcom's reserved drama range: valid shape, never a real person,
  // used whenever no (or an invalid) override phone is supplied.
  const fallbackPhone = "+447700900123";
  const phone = (overrides?.phone && normalisePhone(overrides.phone)) || fallbackPhone;

  const trimmedName = overrides?.name?.trim();
  const [firstName, ...rest] = trimmedName ? trimmedName.split(/\s+/) : [];

  const notes = overrides?.message?.trim()
    ? `Created by the onboarding test. Excluded from analytics.\n\nMessage: ${overrides.message.trim()}`
    : "Created by the onboarding test. Excluded from analytics.";

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      business_id: businessId,
      external_id: TEST_EXTERNAL_ID,
      first_name: firstName || ownerFirstName?.trim() || "Test",
      last_name: rest.length > 0 ? rest.join(" ") : "Lead",
      phone,
      phone_normalized: phone,
      email: "test-lead@clientturn.com",
      postcode: "BH14 9XY",
      service_id: service?.id ?? null,
      status: "NEW",
      is_test: true,
      notes,
    })
    .select("id")
    .single();

  if (error || !lead) throw error ?? new Error("Could not create the test lead.");

  await enqueue(
    "lead.process",
    {
      leadId: lead.id,
      serviceName: service?.name,
      source: {
        provider: "test",
        sourceName: "Onboarding test",
        formName: "Onboarding test",
      },
    },
    { businessId, idempotencyKey: `test-lead:${lead.id}` },
  );

  return { leadId: lead.id };
}

export async function getTestLeadOutcome(
  businessId: string,
): Promise<TestLeadOutcome | null> {
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, status")
    .eq("business_id", businessId)
    .eq("external_id", TEST_EXTERNAL_ID)
    .maybeSingle();

  if (!lead) return null;

  const [messagesResult, conversationResult] = await Promise.all([
    admin
      .from("messages")
      .select("body, status, channel, provider, error_message, created_at")
      .eq("business_id", businessId)
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: true })
      .limit(10),
    admin
      .from("conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq("lead_id", lead.id)
      .maybeSingle(),
  ]);

  return {
    leadId: lead.id,
    status: lead.status,
    conversationId: conversationResult.data?.id ?? null,
    messages: (messagesResult.data ?? []).map((row) => ({
      body: row.body,
      status: row.status,
      channel: row.channel,
      provider: row.provider,
      error: row.error_message,
    })),
  };
}
