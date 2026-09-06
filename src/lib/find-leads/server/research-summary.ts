import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAiBehaviour } from "@/lib/ai-settings/queries";
import { runTask } from "@/lib/ai/model-router";
import type { ResearchSummaryResult } from "@/lib/ai/schemas";

/**
 * The AI research summary (V4 §13.3, and the AI boundary in CLAUDE.md).
 *
 * What the model is allowed to do here is narrow and structural, not a matter
 * of asking it nicely:
 *
 *   * it sees only evidence this workspace has already gathered and stored,
 *     rendered as a numbered list — it has no tools and no browsing;
 *   * it must cite the evidence ids behind every claim;
 *   * **every returned claim is re-checked against the ids that were supplied,
 *     and any claim citing something else is dropped before it is stored.**
 *
 * That last step is the one that matters. A prompt asking a model not to invent
 * things is a request; discarding uncitable claims is a guarantee. It is why
 * the schema has no free-text summary field — prose could not be checked.
 *
 * The summary never affects the score. Scoring is deterministic and lives in
 * `lib/prospects/scoring.ts`; this is a reading aid for the person deciding
 * whether to approve outreach.
 */

export type ResearchClaim = {
  text: string;
  /** Evidence rows behind the claim, resolved back to real records. */
  evidence: { id: string; label: string; source: string }[];
};

export type ResearchSummary = {
  claims: ResearchClaim[];
  generatedAt: string;
  /** True when the model was asked and said the evidence was too thin. */
  insufficientEvidence: boolean;
};

export type SummaryOutcome =
  | { ok: true; summary: ResearchSummary }
  | { ok: false; error: string };

type EvidenceItem = {
  /** Short, stable handle given to the model: E1, E2, … */
  ref: string;
  id: string;
  label: string;
  source: string;
  detail: string;
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).value ?? "");
  }
  return JSON.stringify(value);
}

function humanField(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Gathers what is already known, as a numbered evidence list.
 *
 * Only stored rows. Nothing is fetched from a provider here — a summary is a
 * reading of the file, not a reason to spend money.
 */
async function collectEvidence(
  businessId: string,
  prospectId: string,
): Promise<EvidenceItem[]> {
  const admin = createAdminClient();

  const [{ data: sources }, { data: intent }] = await Promise.all([
    admin
      .from("prospect_data_sources")
      .select("id, field_name, value_json, provider, source_type, obtained_at")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .order("obtained_at", { ascending: false })
      .limit(24),
    admin
      .from("intent_events")
      .select("id, signal_type, source, evidence_summary, observed_at, expires_at")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .order("observed_at", { ascending: false })
      .limit(10),
  ]);

  const items: EvidenceItem[] = [];

  for (const row of sources ?? []) {
    const value = formatValue(row.value_json);
    if (!value.trim()) continue;
    items.push({
      ref: "",
      id: row.id,
      label: humanField(row.field_name),
      source: row.provider,
      detail: `${humanField(row.field_name)}: ${value}`,
    });
  }

  const now = Date.now();
  for (const row of intent ?? []) {
    const expired = new Date(row.expires_at).getTime() <= now;
    items.push({
      ref: "",
      id: row.id,
      label: "Intent signal",
      source: row.source,
      // Expiry is stated so the model cannot present a stale signal as current.
      detail: `${expired ? "Expired" : "Current"} signal from ${row.source}: ${
        row.evidence_summary ?? row.signal_type
      } (observed ${new Date(row.observed_at).toLocaleDateString("en-GB")})`,
    });
  }

  return items.slice(0, 30).map((item, index) => ({ ...item, ref: `E${index + 1}` }));
}

export async function generateResearchSummary(
  businessId: string,
  prospectId: string,
): Promise<SummaryOutcome> {
  // The workspace AI toggle. Off by default, per the resolved conflict in
  // CLAUDE.md — the deterministic surfaces work without this, so a workspace
  // that has not opted in simply does not get the card.
  const behaviour = await getAiBehaviour(businessId);
  if (!behaviour.enabled) {
    return {
      ok: false,
      error: "AI assistance is switched off for this workspace. Turn it on in Settings.",
    };
  }

  const evidence = await collectEvidence(businessId, prospectId);
  if (evidence.length === 0) {
    return {
      ok: false,
      error: "There is no stored research evidence to summarise yet.",
    };
  }

  const byRef = new Map(evidence.map((item) => [item.ref, item]));

  const context = [
    "EVIDENCE (the only facts you may use):",
    ...evidence.map((item) => `${item.ref}. [${item.source}] ${item.detail}`),
  ].join("\n");

  const result = await runTask<ResearchSummaryResult>({
    taskType: "research_summary",
    businessId,
    context,
    maxOutputTokens: 700,
    // A workspace with no AI tokens degrades to "no summary", exactly as one
    // with the toggle off does. It is a billing state, not an error.
    onUnavailable: () => ({ claims: [], insufficient_evidence: true }),
  });

  if (result.skippedReason === "NO_TOKENS") {
    return {
      ok: false,
      error: "Your workspace has no AI tokens left this period.",
    };
  }
  if (!result.data) {
    return { ok: false, error: "The summary could not be generated. Nothing was changed." };
  }

  // The structural guard. A claim citing an id that was not supplied is
  // discarded rather than repaired — a hallucinated citation is exactly the
  // case this exists to catch, and a "best effort" fix would launder it.
  const claims: ResearchClaim[] = [];
  for (const claim of result.data.claims) {
    const cited = claim.evidence_ids
      .map((ref) => byRef.get(ref.trim().toUpperCase()))
      .filter((item): item is EvidenceItem => Boolean(item));

    if (cited.length === 0) continue;

    claims.push({
      text: claim.text,
      evidence: cited.map((item) => ({
        id: item.id,
        label: item.label,
        source: item.source,
      })),
    });
  }

  const summary: ResearchSummary = {
    claims,
    generatedAt: new Date().toISOString(),
    insufficientEvidence: claims.length === 0,
  };

  const admin = createAdminClient();
  await admin.from("prospect_enrichments").insert({
    business_id: businessId,
    prospect_id: prospectId,
    enrichment_type: "RESEARCH_SUMMARY",
    provider: "AZURE_OPENAI",
    status: claims.length > 0 ? "SUCCESS" : "NOT_FOUND",
    // Cost is metered in AI tokens by the model router, not as provider spend.
    cost_minor: 0,
    result_json: {
      claims: claims.map((claim) => ({
        text: claim.text,
        evidenceIds: claim.evidence.map((item) => item.id),
        sources: [...new Set(claim.evidence.map((item) => item.source))],
      })),
      generatedAt: summary.generatedAt,
      // Recorded so a stored summary can be read against the evidence that was
      // actually available when it was written.
      evidenceCount: evidence.length,
    } as never,
    completed_at: new Date().toISOString(),
  });

  return { ok: true, summary };
}

/**
 * The most recent stored summary, if any.
 *
 * Read rather than regenerated on drawer open: §21.7 keeps provider and model
 * work out of a page render, and a summary that changed every time someone
 * looked at it would not be something a team could discuss.
 */
export async function readStoredResearchSummary(
  businessId: string,
  prospectId: string,
): Promise<ResearchSummary | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("prospect_enrichments")
    .select("result_json, completed_at")
    .eq("business_id", businessId)
    .eq("prospect_id", prospectId)
    .eq("enrichment_type", "RESEARCH_SUMMARY")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const blob = (data.result_json ?? {}) as {
    claims?: { text?: unknown; evidenceIds?: unknown; sources?: unknown }[];
    generatedAt?: unknown;
  };

  const rawClaims = Array.isArray(blob.claims) ? blob.claims : [];

  const claims: ResearchClaim[] = rawClaims
    .map((claim) => {
      const text = typeof claim.text === "string" ? claim.text : "";
      const ids = Array.isArray(claim.evidenceIds)
        ? claim.evidenceIds.filter((v): v is string => typeof v === "string")
        : [];
      const sources = Array.isArray(claim.sources)
        ? claim.sources.filter((v): v is string => typeof v === "string")
        : [];
      return {
        text,
        evidence: ids.map((id, index) => ({
          id,
          label: "Evidence",
          source: sources[index] ?? sources[0] ?? "Stored evidence",
        })),
      };
    })
    .filter((claim) => claim.text.trim() !== "" && claim.evidence.length > 0);

  return {
    claims,
    generatedAt:
      typeof blob.generatedAt === "string"
        ? blob.generatedAt
        : (data.completed_at ?? new Date().toISOString()),
    insufficientEvidence: claims.length === 0,
  };
}
