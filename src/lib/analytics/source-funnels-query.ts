import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { RangeBounds } from "./v4-queries";
import {
  assembleSourceFunnels,
  classifyTouch,
  COLD_EMAIL_GROUP,
  socialOutreachGroup,
  type Journey,
  type SourceFunnel,
  type SourceGroup,
  type StageKey,
} from "./source-funnels";

/**
 * The read behind the Source funnels view (coverage tracker 8.16).
 *
 * Three cohorts, each taken by its own entry moment within the period:
 *   * leads created in the period, grouped by their first touch (0123) —
 *     except leads promoted from a prospect, which belong to the outbound
 *     funnel they came through;
 *   * Find Leads prospects found in the period (cold email);
 *   * social connection requests sent in the period (LinkedIn and others).
 *
 * Everything is read under the person's own session, so RLS applies. A failed
 * read of the lead cohort makes the view unavailable; a failed read of one
 * outbound source drops that source with a note — never a table of zeros.
 */

export type SourceFunnelResult =
  | { status: "ok"; funnels: SourceFunnel[]; notes: string[]; truncated: boolean }
  | { status: "unavailable"; message: string };

const COHORT_LIMIT = 5000;
const CHUNK = 200;

class FunnelReadError extends Error {}

type LeadRow = {
  id: string;
  created_at: string;
  first_contacted_at: string | null;
  first_replied_at: string | null;
  qualified_at: string | null;
  booked_at: string | null;
  won_at: string | null;
  promoted_from_prospect_id: string | null;
};

const LEAD_FIELDS =
  "id, created_at, first_contacted_at, first_replied_at, qualified_at, booked_at, won_at, promoted_from_prospect_id";

async function inChunks<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw new FunnelReadError(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/** Showed (a person marked the booking attended) and the won close type, per lead. */
async function leadOutcomes(
  supabase: SupabaseClient,
  businessId: string,
  leadIds: string[],
): Promise<{ showedAt: Map<string, string>; closeType: Map<string, string> }> {
  const [bookings, wins] = await Promise.all([
    inChunks<{ lead_id: string; starts_at: string | null; created_at: string }>(leadIds, (chunk) =>
      supabase
        .from("bookings")
        .select("lead_id, starts_at, created_at")
        .eq("business_id", businessId)
        .eq("status", "completed")
        .in("lead_id", chunk),
    ),
    inChunks<{ lead_id: string | null; close_target: string; closed_at: string | null }>(leadIds, (chunk) =>
      supabase
        .from("opportunities")
        .select("lead_id, close_target, closed_at")
        .eq("business_id", businessId)
        .eq("outcome", "WON")
        .in("lead_id", chunk)
        .order("closed_at", { ascending: false }),
    ),
  ]);

  const showedAt = new Map<string, string>();
  for (const booking of bookings) {
    const at = booking.starts_at ?? booking.created_at;
    const current = showedAt.get(booking.lead_id);
    if (!current || at < current) showedAt.set(booking.lead_id, at);
  }
  const closeType = new Map<string, string>();
  for (const win of wins) {
    if (win.lead_id && !closeType.has(win.lead_id)) closeType.set(win.lead_id, win.close_target);
  }
  return { showedAt, closeType };
}

function leadTail(
  lead: LeadRow | undefined,
  outcomes: { showedAt: Map<string, string>; closeType: Map<string, string> },
): Pick<Journey, "closeType"> & { stages: Partial<Record<StageKey, string | null>> } {
  if (!lead) return { stages: {} };
  return {
    stages: {
      qualified: lead.qualified_at,
      booked: lead.booked_at,
      showed: outcomes.showedAt.get(lead.id) ?? null,
      won: lead.won_at,
    },
    closeType: lead.won_at ? (outcomes.closeType.get(lead.id) ?? null) : null,
  };
}

export async function getSourceFunnels(
  businessId: string,
  bounds: RangeBounds,
): Promise<SourceFunnelResult> {
  const from = bounds.from.toISOString();
  const to = bounds.to.toISOString();
  const notes: string[] = [];
  const rows: { group: SourceGroup; journey: Journey }[] = [];
  let truncated = false;

  let supabase: SupabaseClient;
  try {
    supabase = (await createClient()) as unknown as SupabaseClient;
  } catch {
    return { status: "unavailable", message: "Source funnels could not be loaded." };
  }

  /* ------------------------------------------------------ inbound leads */
  try {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_FIELDS)
      .eq("business_id", businessId)
      .eq("is_test", false)
      .is("promoted_from_prospect_id", null)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false })
      .limit(COHORT_LIMIT);
    if (error) throw new FunnelReadError(error.message);
    const leads = (data ?? []) as LeadRow[];
    truncated ||= leads.length >= COHORT_LIMIT;
    const ids = leads.map((lead) => lead.id);

    const [touches, outcomes] = await Promise.all([
      inChunks<{ lead_id: string; source_type: string; provider: string; occurred_at: string }>(
        ids,
        (chunk) =>
          supabase
            .from("lead_first_touch")
            .select("lead_id, source_type, provider, occurred_at")
            .eq("business_id", businessId)
            .in("lead_id", chunk),
      ),
      leadOutcomes(supabase, businessId, ids),
    ]);
    const touchByLead = new Map(touches.map((touch) => [touch.lead_id, touch]));

    for (const lead of leads) {
      const touch = touchByLead.get(lead.id) ?? null;
      const group = classifyTouch(
        touch ? { sourceType: touch.source_type, provider: touch.provider } : null,
      );
      // A form or message is "entered" when the person submitted it, which is
      // what speed-to-lead is measured from; everything else when recorded.
      const entry =
        touch && (group.family === "LEAD_FORM" || group.family === "SOCIAL_INBOUND")
          ? touch.occurred_at
          : lead.created_at;
      const tail = leadTail(lead, outcomes);
      rows.push({
        group,
        journey: {
          stages: {
            entry,
            contacted: lead.first_contacted_at,
            replied: lead.first_replied_at,
            ...tail.stages,
          },
          closeType: tail.closeType,
        },
      });
    }
  } catch (error) {
    console.error("[analytics] source funnels: lead cohort failed", { error });
    return {
      status: "unavailable",
      message: "Source funnels could not be loaded. The data behind them may not be set up for this workspace yet.",
    };
  }

  /* ------------------------------------------------ outbound: shared bits */
  type ProspectRow = {
    id: string;
    created_at: string;
    email: string | null;
    outreach_eligibility: string;
    replied_at: string | null;
    promoted_at: string | null;
    promoted_to_lead_id: string | null;
  };

  async function promotedLeads(prospects: ProspectRow[]) {
    const leadIds = prospects
      .map((prospect) => prospect.promoted_to_lead_id)
      .filter((id): id is string => Boolean(id));
    const leads = await inChunks<LeadRow>(leadIds, (chunk) =>
      supabase.from("leads").select(LEAD_FIELDS).eq("business_id", businessId).in("id", chunk),
    );
    const outcomes = await leadOutcomes(supabase, businessId, leadIds);
    return { byId: new Map(leads.map((lead) => [lead.id, lead])), outcomes };
  }

  /* ------------------------------------------- outbound: Find Leads email */
  try {
    const { data, error } = await supabase
      .from("prospects")
      .select("id, created_at, email, outreach_eligibility, replied_at, promoted_at, promoted_to_lead_id")
      .eq("business_id", businessId)
      .eq("is_test", false)
      // Engagement-sourced prospects (commenters, reactors) are not cold-email
      // candidates; they arrive through the social funnels.
      .is("social_platform", null)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false })
      .limit(COHORT_LIMIT);
    if (error) throw new FunnelReadError(error.message);
    const prospects = (data ?? []) as ProspectRow[];
    truncated ||= prospects.length >= COHORT_LIMIT;

    if (prospects.length > 0) {
      const ids = prospects.map((prospect) => prospect.id);
      const [runs, promoted] = await Promise.all([
        inChunks<{ prospect_id: string }>(ids, (chunk) =>
          supabase
            .from("outreach_recipient_runs")
            .select("prospect_id")
            .eq("business_id", businessId)
            .gt("steps_sent", 0)
            .in("prospect_id", chunk),
        ),
        promotedLeads(prospects),
      ]);
      const emailed = new Set(runs.map((run) => run.prospect_id));

      for (const prospect of prospects) {
        const lead = prospect.promoted_to_lead_id
          ? promoted.byId.get(prospect.promoted_to_lead_id)
          : undefined;
        const tail = leadTail(lead, promoted.outcomes);
        rows.push({
          group: COLD_EMAIL_GROUP,
          journey: {
            stages: {
              entry: prospect.created_at,
              contactable:
                prospect.outreach_eligibility === "ELIGIBLE" && Boolean(prospect.email) ? true : null,
              first_email: emailed.has(prospect.id) ? true : null,
              replied: prospect.replied_at,
              promoted: prospect.promoted_to_lead_id ? prospect.promoted_at : null,
              ...tail.stages,
            },
            closeType: tail.closeType,
          },
        });
      }
    }
  } catch (error) {
    console.error("[analytics] source funnels: Find Leads failed", { error });
    notes.push("Find Leads could not be read, so its funnel is not shown.");
  }

  /* --------------------------------------- outbound: social connections */
  try {
    const { data, error } = await supabase
      .from("social_connection_states")
      .select("prospect_id, platform, invite_sent_at, accepted_at, messaged_at, replied_at")
      .eq("business_id", businessId)
      .gte("invite_sent_at", from)
      .lt("invite_sent_at", to)
      .order("invite_sent_at", { ascending: false })
      .limit(COHORT_LIMIT);
    if (error) throw new FunnelReadError(error.message);
    const invites = (data ?? []) as {
      prospect_id: string;
      platform: string;
      invite_sent_at: string;
      accepted_at: string | null;
      messaged_at: string | null;
      replied_at: string | null;
    }[];
    truncated ||= invites.length >= COHORT_LIMIT;

    if (invites.length > 0) {
      const prospects = await inChunks<ProspectRow>(
        [...new Set(invites.map((invite) => invite.prospect_id))],
        (chunk) =>
          supabase
            .from("prospects")
            .select("id, created_at, email, outreach_eligibility, replied_at, promoted_at, promoted_to_lead_id")
            .eq("business_id", businessId)
            .eq("is_test", false)
            .in("id", chunk),
      );
      const prospectById = new Map(prospects.map((prospect) => [prospect.id, prospect]));
      const promoted = await promotedLeads(prospects);

      for (const invite of invites) {
        const prospect = prospectById.get(invite.prospect_id);
        if (!prospect) continue; // a test prospect, or one erased since
        const lead = prospect.promoted_to_lead_id
          ? promoted.byId.get(prospect.promoted_to_lead_id)
          : undefined;
        const tail = leadTail(lead, promoted.outcomes);
        rows.push({
          group: socialOutreachGroup(invite.platform),
          journey: {
            stages: {
              entry: invite.invite_sent_at,
              accepted: invite.accepted_at,
              messaged: invite.messaged_at,
              replied: invite.replied_at,
              promoted: prospect.promoted_to_lead_id ? prospect.promoted_at : null,
              ...tail.stages,
            },
            closeType: tail.closeType,
          },
        });
      }
    }
  } catch (error) {
    console.error("[analytics] source funnels: social outreach failed", { error });
    notes.push("Social outreach could not be read, so its funnels are not shown.");
  }

  return {
    status: "ok",
    funnels: assembleSourceFunnels(rows),
    notes,
    truncated,
  };
}
