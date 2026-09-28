import "server-only";

/**
 * Reads for the commercial rules (0174): the catalogue as the rules see it,
 * an agent's offer target, the workspace's competitors, and the best fit for
 * one lead. Service role, always scoped to a business id the caller got from a
 * trusted source (a session, the job envelope).
 *
 * Every read tolerates migration 0174 not being applied yet (the columns and
 * the table are absent): an agent then sells the whole catalogue, which is the
 * behaviour before 0174, and there are no competitors. The loaders the
 * conversation runtime uses never throw; the settings loaders throw so a card
 * shows its error state rather than an empty editor.
 *
 * The pure rules live in ../agents/offer-target.ts, ./best-fit.ts and
 * ../sales-library/competitors.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  candidateInTarget,
  describeTarget,
  offerTargetFromRow,
  offTargetNames,
  resolveTarget,
  serviceInTarget,
  WHOLE_CATALOGUE,
  type OfferTarget,
} from "@/lib/agents/offer-target";
import { buildFitCandidates, liveFitFacts, recommendBestFit, type BestFit } from "./best-fit";
import { detectCompetitorMentions, parseCompetitorRows, type Competitor } from "@/lib/sales-library/competitors";
import { readLiveFacts } from "@/lib/qualification-intelligence/store-reads";

function db(): SupabaseClient {
  // 0174's columns and table post-date the generated types.
  return createAdminClient() as unknown as SupabaseClient;
}

/* --------------------------------------------------------------- catalogue */

export type RulesService = { id: string; name: string; description: string | null; offerProfile: unknown };
export type RulesItem = {
  id: string;
  serviceId: string | null;
  name: string;
  /** INTERNAL: compared by the scorer, never rendered. */
  unitPriceMinor: number | null;
  currency: string | null;
  addOnOnly: boolean;
};
export type RulesCatalogue = { services: RulesService[]; items: RulesItem[] };

/** Active offers and their active, unarchived items. Throws on a failed read. */
export async function loadRulesCatalogue(businessId: string): Promise<RulesCatalogue> {
  const client = createAdminClient();
  const [services, items] = await Promise.all([
    client
      .from("services")
      .select("id, name, description, offer_profile")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("position", { ascending: true }),
    client
      .from("catalogue_items")
      .select("id, service_id, name, unit_price_minor, currency, add_on_only")
      .eq("business_id", businessId)
      .eq("active", true)
      .is("archived_at", null)
      .order("name", { ascending: true })
      .limit(500),
  ]);
  if (services.error) throw new Error("The services could not be read.");
  const liveServices = (services.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    offerProfile: (row as { offer_profile?: unknown }).offer_profile ?? {},
  }));
  const serviceIds = new Set(liveServices.map((s) => s.id));
  // catalogue_items (0152) may be absent on a database without it: no items.
  const liveItems = (items.error ? [] : items.data ?? [])
    .filter((row) => !row.service_id || serviceIds.has(row.service_id))
    .map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      name: row.name,
      unitPriceMinor: row.unit_price_minor === null ? null : Number(row.unit_price_minor),
      currency: row.currency,
      addOnOnly: Boolean(row.add_on_only),
    }));
  return { services: liveServices, items: liveItems };
}

/* ------------------------------------------------------------- agent target */

/**
 * One agent's target. Throws only when the agent itself cannot be read; a
 * database without 0174 reads the legacy service_id instead.
 */
export async function loadAgentOfferTarget(businessId: string, agentId: string): Promise<OfferTarget | null> {
  const full = await db()
    .from("agents")
    .select("id, service_id, offer_scope, target_service_ids, target_catalogue_item_ids")
    .eq("business_id", businessId)
    .eq("id", agentId)
    .maybeSingle();
  if (!full.error) return full.data ? offerTargetFromRow(full.data) : null;
  const legacy = await db()
    .from("agents")
    .select("id, service_id")
    .eq("business_id", businessId)
    .eq("id", agentId)
    .maybeSingle();
  if (legacy.error) throw new Error("The agent could not be read.");
  return legacy.data ? offerTargetFromRow(legacy.data) : null;
}

/** Never throws: an unreadable target is the whole catalogue (pre-0174 behaviour). */
export async function loadAgentOfferTargetOrWhole(businessId: string, agentId: string | null): Promise<OfferTarget> {
  if (!agentId) return WHOLE_CATALOGUE;
  try {
    return (await loadAgentOfferTarget(businessId, agentId)) ?? WHOLE_CATALOGUE;
  } catch (error) {
    console.error("[commercial-rules] agent target read failed; whole catalogue", { businessId, agentId, error });
    return WHOLE_CATALOGUE;
  }
}

/* -------------------------------------------------------------- competitors */

type CompetitorRow = {
  slug: string;
  name: string;
  aliases: string[] | null;
  approved_points: string[] | null;
  never_say: string[] | null;
  enabled: boolean;
};

export function competitorFromRow(row: CompetitorRow): unknown {
  return {
    id: row.slug,
    name: row.name,
    aliases: row.aliases ?? [],
    approvedPoints: row.approved_points ?? [],
    neverSay: row.never_say ?? [],
    enabled: row.enabled,
  };
}

export type CompetitorSet = { competitors: Competitor[]; invalid: number; schemaReady: boolean };

/** Settings and the operations. Throws on a failed read; a missing table is schemaReady false. */
export async function loadCompetitors(businessId: string): Promise<CompetitorSet> {
  const { data, error } = await db()
    .from("workspace_competitors")
    .select("slug, name, aliases, approved_points, never_say, enabled")
    .eq("business_id", businessId)
    .order("name", { ascending: true });
  if (error) {
    // 42P01: the table does not exist yet (0174 not applied).
    if ((error as { code?: string }).code === "42P01") return { competitors: [], invalid: 0, schemaReady: false };
    throw new Error("The competitors could not be read.");
  }
  const parsed = parseCompetitorRows(((data ?? []) as CompetitorRow[]).map(competitorFromRow));
  return { ...parsed, schemaReady: true };
}

/** The conversation runtime. Never throws: no competitors is the safe default. */
export async function loadCompetitorsOrEmpty(businessId: string): Promise<Competitor[]> {
  try {
    return (await loadCompetitors(businessId)).competitors;
  } catch (error) {
    console.error("[commercial-rules] competitor read failed; none used", { businessId, error });
    return [];
  }
}

/* ----------------------------------------------------------------- best fit */

export type LeadBestFit = {
  fit: BestFit;
  target: OfferTarget;
  /** The lead's agent, whose target applied. Null = the whole catalogue. */
  agentId: string | null;
};

/**
 * The best fit for one lead, from facts already stored. Throws when the lead
 * cannot be read (the lead page shows its error state). The agent target is
 * the lead's own agent's (leads.agent_id), the same one the conversation
 * agent applies, so the lead page and the assistant never disagree.
 */
export async function loadLeadBestFit(
  businessId: string,
  leadId: string,
  preloaded?: { catalogue?: RulesCatalogue; target?: OfferTarget },
): Promise<LeadBestFit | null> {
  const client = createAdminClient();
  const { data: lead, error } = await client
    .from("leads")
    .select("id, service_id, postcode, agent_id")
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error("The lead could not be read.");
  if (!lead) return null;

  const [catalogue, target, opportunities, facts, tags, score] = await Promise.all([
    preloaded?.catalogue ?? loadRulesCatalogue(businessId),
    preloaded?.target ?? loadAgentOfferTargetOrWhole(businessId, lead.agent_id ?? null),
    db()
      .from("opportunities")
      .select("service_id")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("outcome", "OPEN"),
    readLiveFacts(businessId, leadId).catch(() => []),
    client
      .from("lead_tags")
      .select("tag")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .is("cleared_at", null)
      .limit(50),
    client
      .from("lead_scores")
      .select("grade")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("is_current", true)
      .maybeSingle(),
  ]);

  const resolved = resolveTarget(target, catalogue.items);
  const candidates = buildFitCandidates(catalogue.services, catalogue.items);
  const fit = recommendBestFit({
    candidates,
    lead: {
      serviceId: lead.service_id ?? null,
      openInterestServiceIds: ((opportunities.data ?? []) as { service_id: string | null }[])
        .map((o) => o.service_id)
        .filter((id): id is string => Boolean(id)),
      postcode: lead.postcode ?? null,
      facts: liveFitFacts(facts, new Date()),
      tags: (tags.data ?? []).map((t) => t.tag),
      icpGrade: (score.data?.grade as "A" | "B" | "C" | "D" | undefined) ?? null,
    },
    inTarget: (candidate) => candidateInTarget(resolved, candidate),
  });
  return { fit, target, agentId: lead.agent_id ?? null };
}

/* ------------------------------------------------------- conversation turn */

/** What one conversation turn needs from the commercial rules. */
export type ConversationRules = {
  target: OfferTarget;
  /** Offers the card may list. Null = every active offer (whole catalogue). */
  inTargetServiceIds: string[] | null;
  /** The SCOPE line for the card; null for the whole catalogue. */
  targetNote: string | null;
  /** Out-of-target offer and item names the validator refuses. */
  offTargetNames: string[];
  /** The deterministic best fit; null when it could not be worked out. */
  bestFit: BestFit | null;
  /** Every enabled competitor (the validator checks all of them). */
  competitors: Competitor[];
  /** The competitors this lead named (the card carries only these). */
  mentioned: Competitor[];
};

export const NO_CONVERSATION_RULES: ConversationRules = {
  target: WHOLE_CATALOGUE,
  inTargetServiceIds: null,
  targetNote: null,
  offTargetNames: [],
  bestFit: null,
  competitors: [],
  mentioned: [],
};

/**
 * The rules for one turn. Never throws: whatever cannot be read falls back to
 * the behaviour before 0174 (whole catalogue, no recommendation, no
 * competitors), and the validator's other checks still bind.
 */
export async function loadConversationRules(
  businessId: string,
  leadId: string,
  leadTexts: readonly string[],
): Promise<ConversationRules> {
  try {
    const catalogue = await loadRulesCatalogue(businessId);
    const { data: lead } = await createAdminClient()
      .from("leads")
      .select("agent_id")
      .eq("business_id", businessId)
      .eq("id", leadId)
      .maybeSingle();
    const [target, competitors] = await Promise.all([
      loadAgentOfferTargetOrWhole(businessId, lead?.agent_id ?? null),
      loadCompetitorsOrEmpty(businessId),
    ]);
    const resolved = resolveTarget(target, catalogue.items);
    const bestFit = await loadLeadBestFit(businessId, leadId, { catalogue, target })
      .then((result) => result?.fit ?? null)
      .catch((error) => {
        console.error("[commercial-rules] best fit failed; none shown", { businessId, leadId, error });
        return null;
      });
    const inTarget =
      target.scope === "CATALOGUE"
        ? null
        : catalogue.services.filter((s) => serviceInTarget(resolved, s.id)).map((s) => s.id);
    return {
      target,
      inTargetServiceIds: inTarget,
      targetNote:
        target.scope === "CATALOGUE"
          ? null
          : `This conversation sells only: ${describeTarget(target, catalogue.services, catalogue.items)}. Never offer anything else; if they ask about something else, a colleague will pick it up.`,
      offTargetNames: offTargetNames(resolved, catalogue.services, catalogue.items),
      bestFit,
      competitors,
      mentioned: detectCompetitorMentions(leadTexts, competitors),
    };
  } catch (error) {
    console.error("[commercial-rules] turn rules failed; pre-0174 behaviour", { businessId, leadId, error });
    return NO_CONVERSATION_RULES;
  }
}

/** The target picker's options (names only). Throws on a failed read. */
export async function loadCatalogueOptions(businessId: string): Promise<import("@/lib/agents/offer-target").CatalogueOptions> {
  const catalogue = await loadRulesCatalogue(businessId);
  return {
    services: catalogue.services.map((s) => ({ id: s.id, name: s.name })),
    items: catalogue.items.filter((i) => !i.addOnOnly).map((i) => ({ id: i.id, name: i.name, serviceId: i.serviceId })),
  };
}
