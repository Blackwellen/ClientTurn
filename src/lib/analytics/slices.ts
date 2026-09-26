import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { archetypeFor } from "@/lib/sales-library/archetypes";
import { getWorkspaceMembers } from "@/lib/leads/queries";
import type { RangeBounds } from "./v4-queries";
import {
  aggregateSlices,
  ATTRIBUTION_VIEW,
  scoreBand,
  SLICE_AVAILABILITY,
  type AttributionModel,
  type SliceDimension,
  type SliceOutcomeFlags,
  type SliceRow,
} from "./revenue-surfaces";

/**
 * Analytics slices (design doc 05, Phase 5): the workspace's lead cohort for a
 * period, broken down by one dimension, with every rate low-sample flagged.
 *
 * Source and campaign read the 0123 attribution views, by the chosen model
 * (first / last / linear). Leads that arrived before per-touch attribution
 * existed have no touch and are grouped as such rather than guessed at.
 *
 * Tables here are 0121-0123 or otherwise not in the generated types, so reads
 * go through one untyped seam, and any failed read makes the slice
 * "unavailable" with a reason -- never an empty table dressed as a result.
 */

export type SliceResult =
  | {
      status: "ok";
      rows: SliceRow[];
      cohort: number;
      note: string;
      truncated: boolean;
    }
  | { status: "unavailable"; message: string };

type Cohort = {
  id: string;
  assigned_user_id: string | null;
  first_contacted_at: string | null;
  first_replied_at: string | null;
  qualified_at: string | null;
  booked_at: string | null;
  won_at: string | null;
};

const COHORT_LIMIT = 5000;
const CHUNK = 200;

function outcome(lead: Cohort): SliceOutcomeFlags {
  return {
    contacted: Boolean(lead.first_contacted_at),
    replied: Boolean(lead.first_replied_at),
    qualified: Boolean(lead.qualified_at),
    booked: Boolean(lead.booked_at),
    won: Boolean(lead.won_at),
  };
}

class SliceReadError extends Error {}

async function inChunks<T>(
  ids: string[],
  read: (
    chunk: string[],
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw new SliceReadError(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export async function getSlice(
  businessId: string,
  bounds: RangeBounds,
  dimension: SliceDimension,
  model: AttributionModel,
): Promise<SliceResult> {
  const availability = SLICE_AVAILABILITY[dimension];
  if (!availability.available)
    return { status: "unavailable", message: availability.note };

  try {
    const supabase = (await createClient()) as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, assigned_user_id, first_contacted_at, first_replied_at, qualified_at, booked_at, won_at",
      )
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", bounds.from.toISOString())
      .lt("created_at", bounds.to.toISOString())
      .order("created_at", { ascending: false })
      .limit(COHORT_LIMIT);
    if (error) throw new SliceReadError(error.message);
    const cohort = (data ?? []) as Cohort[];
    const ids = cohort.map((lead) => lead.id);
    const truncated = cohort.length >= COHORT_LIMIT;

    const entries: {
      key: string;
      label: string;
      credit: number;
      outcome: SliceOutcomeFlags;
    }[] = [];
    const single = (lead: Cohort, key: string, label: string) =>
      entries.push({ key, label, credit: 1, outcome: outcome(lead) });

    switch (dimension) {
      case "source":
      case "campaign": {
        type Touch = {
          lead_id: string;
          source_type: string;
          provider: string;
          form_name: string | null;
          page_name: string | null;
          campaign_name: string | null;
          utm_campaign: string | null;
          utm_source: string | null;
          credit?: number | string;
        };
        const touches = await inChunks<Touch>(ids, (chunk) =>
          supabase
            .from(ATTRIBUTION_VIEW[model])
            .select(
              `lead_id, source_type, provider, form_name, page_name, campaign_name, utm_campaign, utm_source${
                model === "linear" ? ", credit" : ""
              }`,
            )
            .eq("business_id", businessId)
            .in("lead_id", chunk),
        );
        const byLead = new Map<string, Touch[]>();
        for (const touch of touches) {
          const list = byLead.get(touch.lead_id) ?? [];
          list.push(touch);
          byLead.set(touch.lead_id, list);
        }
        for (const lead of cohort) {
          const list = byLead.get(lead.id);
          if (!list?.length) {
            single(lead, "__none", "No touch recorded");
            continue;
          }
          for (const touch of list) {
            const credit = model === "linear" ? Number(touch.credit) || 0 : 1;
            if (dimension === "source") {
              const detail =
                touch.form_name ??
                touch.page_name ??
                touch.utm_source ??
                touch.source_type;
              entries.push({
                key: `${touch.provider}|${detail}`,
                label: `${touch.provider} · ${detail}`,
                credit,
                outcome: outcome(lead),
              });
            } else {
              const name = touch.campaign_name ?? touch.utm_campaign;
              entries.push({
                key: name ?? "__none",
                label: name ?? "No campaign",
                credit,
                outcome: outcome(lead),
              });
            }
          }
        }
        break;
      }

      case "archetype":
      case "score_band": {
        const scores = await inChunks<{
          lead_id: string;
          grade: string;
          archetype_key: string | null;
        }>(ids, (chunk) =>
          supabase
            .from("lead_scores")
            .select("lead_id, grade, archetype_key")
            .eq("business_id", businessId)
            .eq("is_current", true)
            .in("lead_id", chunk),
        );
        const byLead = new Map(scores.map((score) => [score.lead_id, score]));
        for (const lead of cohort) {
          const score = byLead.get(lead.id);
          if (dimension === "score_band") {
            const band = scoreBand(score?.grade);
            single(
              lead,
              band,
              band === "UNSCORED" ? "Unscored" : `Grade ${band}`,
            );
          } else {
            const key = score?.archetype_key ?? null;
            single(
              lead,
              key ?? "__none",
              key ? (archetypeFor(key)?.name ?? key) : "Not classified",
            );
          }
        }
        break;
      }

      case "channel": {
        const messages = await inChunks<{
          lead_id: string;
          channel: string;
          created_at: string;
        }>(ids, (chunk) =>
          supabase
            .from("messages")
            .select("lead_id, channel, created_at")
            .eq("business_id", businessId)
            .eq("direction", "outbound")
            .in("lead_id", chunk)
            .order("created_at", { ascending: true }),
        );
        const first = new Map<string, string>();
        for (const message of messages)
          if (!first.has(message.lead_id))
            first.set(message.lead_id, message.channel);
        for (const lead of cohort) {
          const channel = first.get(lead.id);
          single(
            lead,
            channel ?? "__none",
            channel ? channel.toUpperCase() : "Not messaged",
          );
        }
        break;
      }

      case "rep": {
        const members = await getWorkspaceMembers(businessId);
        const names = new Map(
          members.map((member) => [member.userId, member.name]),
        );
        for (const lead of cohort) {
          const id = lead.assigned_user_id;
          single(
            lead,
            id ?? "__none",
            id ? (names.get(id) ?? "Former member") : "Unassigned",
          );
        }
        break;
      }

      case "method": {
        const runs = await inChunks<{
          lead_id: string;
          decision_json: { strategy?: { method?: unknown } } | null;
        }>(ids, (chunk) =>
          supabase
            .from("conversation_agent_runs")
            .select("lead_id, decision_json")
            .eq("business_id", businessId)
            .in("lead_id", chunk)
            .order("started_at", { ascending: false }),
        );
        const latest = new Map<string, string>();
        for (const run of runs) {
          const method = run.decision_json?.strategy?.method;
          if (typeof method === "string" && !latest.has(run.lead_id))
            latest.set(run.lead_id, method);
        }
        for (const lead of cohort) {
          const method = latest.get(lead.id);
          single(
            lead,
            method ?? "__none",
            method
              ? method.replace(/_/g, " ").toLowerCase()
              : "No agent strategy",
          );
        }
        break;
      }

      case "model": {
        // ai_runs is service-only; read with the service role, hard-scoped to
        // this workspace and to lead ids already read under the person's RLS.
        const admin = createAdminClient() as unknown as SupabaseClient;
        const runs = await inChunks<{
          lead_id: string;
          deployment: string;
          created_at: string;
        }>(ids, (chunk) =>
          admin
            .from("ai_runs")
            .select("lead_id, deployment, created_at")
            .eq("business_id", businessId)
            .in("lead_id", chunk)
            .order("created_at", { ascending: false }),
        );
        const latest = new Map<string, string>();
        for (const run of runs)
          if (!latest.has(run.lead_id)) latest.set(run.lead_id, run.deployment);
        for (const lead of cohort) {
          const deployment = latest.get(lead.id);
          single(
            lead,
            deployment ?? "__none",
            deployment ? `Model: ${deployment}` : "No AI used",
          );
        }
        break;
      }

      default:
        return { status: "unavailable", message: availability.note };
    }

    return {
      status: "ok",
      rows: aggregateSlices(entries),
      cohort: cohort.length,
      note: availability.note,
      truncated,
    };
  } catch (error) {
    console.error("[analytics] slice read failed", { dimension, model, error });
    return {
      status: "unavailable",
      message:
        "This breakdown could not be loaded. The data behind it may not be set up for this workspace yet.",
    };
  }
}
