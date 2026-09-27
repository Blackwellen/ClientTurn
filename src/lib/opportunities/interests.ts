import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { interestServiceForEvent, serviceForCheckoutLink, type OpenInterestOpportunity } from "@/lib/qualification-intelligence/interests";
import { parseAuthority } from "@/lib/commercial/authority";
import { closeTargetForMotion } from "./stages";

/**
 * Funnel events for a lead with several interests (08 §B.20, migration 0144).
 *
 * `advanceLeadOpportunity` asks here first: when the event names a service,
 * or the lead has two or more open interest opportunities, the event goes to
 * that interest's own opportunity through `ensure_interest_opportunity`. A
 * lead with one interest, or a database without 0144, returns null and the
 * legacy one-per-lead path runs exactly as before.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type InterestAdvance = {
  id: string;
  created: boolean;
  advanced: boolean;
  stage: string;
  previous_stage: string | null;
};

async function openInterestOpportunities(businessId: string, leadId: string): Promise<OpenInterestOpportunity[] | null> {
  const { data, error } = await db()
    .from("opportunities")
    .select("id, service_id, stage, close_target, goal, created_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("outcome", "OPEN")
    .limit(20);
  if (error) {
    if (!isSchemaLag(error)) console.error("[opportunities] interest read failed", { leadId, code: error.code, message: error.message });
    return null;
  }
  return ((data ?? []) as { id: string; service_id: string | null; stage: string; close_target: string; goal: string | null; created_at: string }[]).map(
    (row) => ({ id: row.id, serviceId: row.service_id, stage: row.stage, closeTarget: row.close_target, goal: row.goal, createdAt: row.created_at }),
  );
}

/** The service an approved checkout link sells (interests.ts serviceForCheckoutLink). */
async function serviceForLink(businessId: string, linkId: string | null): Promise<string | null> {
  if (!linkId) return null;
  const [{ data: authority }, { data: services }] = await Promise.all([
    db().from("commercial_authority").select("approved_checkout_links").eq("business_id", businessId).maybeSingle(),
    db().from("services").select("id, name, offer_profile").eq("business_id", businessId).eq("active", true).limit(100),
  ]);
  const links = parseAuthority(authority ?? null).approved_checkout_links;
  return serviceForCheckoutLink(
    links,
    ((services ?? []) as { id: string; name: string | null; offer_profile: unknown }[]).map((s) => ({ id: s.id, name: s.name ?? "", offerProfile: s.offer_profile })),
    linkId,
  );
}

/**
 * The interest-aware advance, or null for the legacy path. `stage` is the
 * stage the workspace's motion maps the event to (already decided).
 */
export async function advanceInterestOpportunity(input: {
  businessId: string;
  leadId: string;
  event: "QUALIFIED" | "MEETING_BOOKED" | "CHECKOUT_SENT";
  stage: string;
  serviceId?: string | null;
  /** A checkout's approved link: the offer it sells is the interest it belongs to. */
  checkoutLinkId?: string | null;
  motion: string | null;
  name: string;
  value: number | null;
}): Promise<InterestAdvance | null> {
  const open = await openInterestOpportunities(input.businessId, input.leadId);
  if (open === null) return null;
  const { data: lead } = await db().from("leads").select("service_id").eq("id", input.leadId).eq("business_id", input.businessId).maybeSingle();
  const leadServiceId = (lead as { service_id: string | null } | null)?.service_id ?? null;

  // A named service (the event's own, or the one the approved checkout link
  // sells) that is not the lead's own and has no open opportunity yet is a
  // new interest: it gets its own row rather than moving another's.
  const linkServiceId =
    !input.serviceId && input.event === "CHECKOUT_SENT" ? await serviceForLink(input.businessId, input.checkoutLinkId ?? null) : null;
  const { serviceId, picked } = interestServiceForEvent(open, input.event, { serviceId: input.serviceId ?? null, linkServiceId, leadServiceId });
  if (!serviceId) return null;

  const { data: service } = await db().from("services").select("name, average_value").eq("id", serviceId).eq("business_id", input.businessId).maybeSingle();
  const row = service as { name: string | null; average_value: number | null } | null;
  const person = input.name.split(" - ")[0] || "New lead";
  const { data, error } = await db().rpc("ensure_interest_opportunity", {
    p_business_id: input.businessId,
    p_lead_id: input.leadId,
    p_service_id: serviceId,
    p_stage: input.stage,
    p_close_target: picked?.closeTarget ?? closeTargetForMotion(input.motion),
    p_motion: input.motion,
    p_name: row?.name ? `${person} - ${row.name}`.slice(0, 200) : input.name,
    p_value: row?.average_value ?? input.value,
    p_currency: "GBP",
    p_goal: null,
    p_source: null,
  });
  if (error) {
    if (!isSchemaLag(error)) console.error("[opportunities] ensure_interest_opportunity failed", { leadId: input.leadId, code: error.code, message: error.message });
    return null;
  }
  return (data as InterestAdvance | null) ?? null;
}
