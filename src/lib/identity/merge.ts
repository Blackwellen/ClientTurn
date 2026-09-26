import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { emitDomainEvent } from "@/lib/events/outbox";
import { MERGEABLE_LEAD_FIELDS } from "./resolve";
import {
  chooseKeeper,
  MergePlanError,
  planMerge,
  revertFieldPatch,
  type MergeLead,
} from "./merge-plan";

/**
 * Resolving a `merge_candidates` row: MERGE or DISMISS, and undoing a merge.
 *
 * The one server path for a person's merge decision. The admin duplicate queue
 * (platform admin, guarded + step-up) and the `merge_candidate.resolve` service
 * operation (workspace owner/admin, confirmed) both call it, so there is one
 * implementation of "what a merge does".
 *
 * Reversible by construction: the `merge_events` row -- with the before
 * snapshot and every id the merge is about to move -- is written *first*. If a
 * later step fails, the event already names everything that may have moved and
 * `revertMerge` puts it back; a re-run of revert is a no-op for rows already
 * back in place.
 *
 * Order matters for the identity unique indexes (0123): the losing lead is
 * parked (`identity_duplicate_of`, archived) before its email or phone is
 * copied onto the keeper, and on revert the keeper's copied fields are cleared
 * before the loser is un-parked.
 */

// 0123 tables post-date database.types.ts: one cast, at this seam.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type MergeActor = {
  userId: string | null;
  /** Who acted, for merge_events.actor_type. */
  type: "USER" | "MCP_CLIENT" | "API_KEY";
};

export type MergeResolution =
  | { decision: "DISMISSED"; candidateId: string }
  | {
      decision: "MERGED";
      candidateId: string;
      mergeEventId: string;
      keeperId: string;
      loserId: string | null;
      filledFields: string[];
      moved: { touches: number; messages: number; conversations: number };
    };

export class MergeError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT" | "UNAVAILABLE";
  constructor(code: MergeError["code"], message: string) {
    super(message);
    this.name = "MergeError";
    this.code = code;
  }
}

type CandidateRow = {
  id: string;
  business_id: string;
  lead_a_id: string;
  lead_b_id: string | null;
  prospect_id: string | null;
  reason: string;
  status: string;
};

const LEAD_COLUMNS = [
  "id",
  "created_at",
  "archived_at",
  "archived_by",
  "automation_active",
  "identity_duplicate_of",
  ...MERGEABLE_LEAD_FIELDS,
].join(", ");

type LeadRecord = MergeLead & {
  archived_at: string | null;
  archived_by: string | null;
  automation_active: boolean;
  identity_duplicate_of: string | null;
};

async function loadCandidate(
  businessId: string,
  candidateId: string,
): Promise<CandidateRow> {
  const { data, error } = await db()
    .from("merge_candidates")
    .select(
      "id, business_id, lead_a_id, lead_b_id, prospect_id, reason, status",
    )
    .eq("id", candidateId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error)
    throw new MergeError(
      "UNAVAILABLE",
      "The duplicate queue could not be read.",
    );
  if (!data)
    throw new MergeError(
      "NOT_FOUND",
      "That duplicate pair could not be found.",
    );
  return data as CandidateRow;
}

async function loadLead(
  businessId: string,
  leadId: string,
): Promise<LeadRecord> {
  const { data, error } = await db()
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", leadId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new MergeError("UNAVAILABLE", "The lead could not be read.");
  if (!data)
    throw new MergeError("NOT_FOUND", "One of the two leads no longer exists.");
  return data as unknown as LeadRecord;
}

async function conversationsOf(businessId: string, leadId: string) {
  const { data, error } = await db()
    .from("conversations")
    .select("id, channel")
    .eq("business_id", businessId)
    .eq("lead_id", leadId);
  if (error)
    throw new MergeError("UNAVAILABLE", "Conversations could not be read.");
  return (data ?? []) as { id: string; channel: string }[];
}

async function idsOf(
  table: string,
  businessId: string,
  leadId: string,
): Promise<string[]> {
  const { data, error } = await db()
    .from(table)
    .select("id")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .limit(10000);
  if (error) throw new MergeError("UNAVAILABLE", `${table} could not be read.`);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

async function markCandidate(
  candidate: CandidateRow,
  status: "MERGED" | "DISMISSED" | "OPEN",
  actorUserId: string | null,
  expected: string,
): Promise<void> {
  const { data, error } = await db()
    .from("merge_candidates")
    .update({
      status,
      decided_by: status === "OPEN" ? null : actorUserId,
      decided_at: status === "OPEN" ? null : new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .eq("business_id", candidate.business_id)
    .eq("status", expected)
    .select("id");
  if (error)
    throw new MergeError(
      "UNAVAILABLE",
      "The duplicate pair could not be updated.",
    );
  if (!data || (data as unknown[]).length === 0) {
    throw new MergeError(
      "CONFLICT",
      "Someone else has already decided this pair.",
    );
  }
}

/* ------------------------------------------------------------------ resolve */

export async function resolveMergeCandidate(input: {
  businessId: string;
  candidateId: string;
  decision: "MERGE" | "DISMISS";
  /** Which lead keeps the record. Defaults to the older one. */
  keeperId?: string | null;
  actor: MergeActor;
}): Promise<MergeResolution> {
  const candidate = await loadCandidate(input.businessId, input.candidateId);
  if (candidate.status !== "OPEN") {
    throw new MergeError(
      "CONFLICT",
      `That pair was already ${candidate.status.toLowerCase()}.`,
    );
  }

  if (input.decision === "DISMISS") {
    await markCandidate(candidate, "DISMISSED", input.actor.userId, "OPEN");
    return { decision: "DISMISSED", candidateId: candidate.id };
  }

  if (!candidate.lead_b_id) return mergeProspect(candidate, input.actor);
  return mergeLeads(candidate, input.keeperId ?? null, input.actor);
}

/** A PROSPECT_MATCH: link the prospect to the lead rather than keep two records. */
async function mergeProspect(
  candidate: CandidateRow,
  actor: MergeActor,
): Promise<MergeResolution> {
  if (!candidate.prospect_id)
    throw new MergeError("INVALID_INPUT", "That pair has no second record.");
  const client = db();
  const { data: prospect, error } = await client
    .from("prospects")
    .select("id, promoted_to_lead_id, promoted_at")
    .eq("id", candidate.prospect_id)
    .eq("business_id", candidate.business_id)
    .maybeSingle();
  if (error)
    throw new MergeError("UNAVAILABLE", "The prospect could not be read.");
  if (!prospect)
    throw new MergeError("NOT_FOUND", "The prospect no longer exists.");
  const row = prospect as {
    id: string;
    promoted_to_lead_id: string | null;
    promoted_at: string | null;
  };
  if (
    row.promoted_to_lead_id &&
    row.promoted_to_lead_id !== candidate.lead_a_id
  ) {
    throw new MergeError(
      "CONFLICT",
      "That prospect is already linked to a different lead.",
    );
  }

  const { data: event, error: eventError } = await client
    .from("merge_events")
    .insert({
      business_id: candidate.business_id,
      lead_id: candidate.lead_a_id,
      rule: "PROSPECT_PROMOTION",
      confidence: 1,
      before: {
        kind: "PROSPECT_LINK",
        prospect_id: row.id,
        promoted_to_lead_id: row.promoted_to_lead_id,
        promoted_at: row.promoted_at,
      },
      after: {
        kind: "PROSPECT_LINK",
        prospect_id: row.id,
        promoted_to_lead_id: candidate.lead_a_id,
        candidate_id: candidate.id,
      },
      actor_type: actor.type,
      actor_id: actor.userId,
    })
    .select("id")
    .single();
  if (eventError || !event)
    throw new MergeError("UNAVAILABLE", "The merge could not be recorded.");

  if (!row.promoted_to_lead_id) {
    assertWrite(
      await client
        .from("prospects")
        .update({
          promoted_to_lead_id: candidate.lead_a_id,
          promoted_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("business_id", candidate.business_id)
        .is("promoted_to_lead_id", null),
      "merge: link prospect",
      { businessId: candidate.business_id, prospectId: row.id },
    );
  }
  await markCandidate(candidate, "MERGED", actor.userId, "OPEN");

  return {
    decision: "MERGED",
    candidateId: candidate.id,
    mergeEventId: (event as { id: string }).id,
    keeperId: candidate.lead_a_id,
    loserId: null,
    filledFields: [],
    moved: { touches: 0, messages: 0, conversations: 0 },
  };
}

async function mergeLeads(
  candidate: CandidateRow,
  preferredKeeperId: string | null,
  actor: MergeActor,
): Promise<MergeResolution> {
  const businessId = candidate.business_id;
  const [a, b] = await Promise.all([
    loadLead(businessId, candidate.lead_a_id),
    loadLead(businessId, candidate.lead_b_id as string),
  ]);

  let chosen;
  try {
    chosen = chooseKeeper(a, b, preferredKeeperId);
  } catch (error) {
    if (error instanceof MergePlanError)
      throw new MergeError("INVALID_INPUT", error.message);
    throw error;
  }
  const keeper = chosen.keeper as LeadRecord;
  const loser = chosen.loser as LeadRecord;
  if (keeper.archived_at) {
    throw new MergeError(
      "CONFLICT",
      "The record being kept is archived. Restore it first.",
    );
  }

  const [keeperConversations, loserConversations, touchIds, messageRows] =
    await Promise.all([
      conversationsOf(businessId, keeper.id),
      conversationsOf(businessId, loser.id),
      idsOf("lead_touches", businessId, loser.id),
      (async () => {
        const { data, error } = await db()
          .from("messages")
          .select("id, conversation_id")
          .eq("business_id", businessId)
          .eq("lead_id", loser.id)
          .limit(10000);
        if (error)
          throw new MergeError("UNAVAILABLE", "Messages could not be read.");
        return (data ?? []) as { id: string; conversation_id: string | null }[];
      })(),
    ]);

  const plan = planMerge({
    keeper,
    loser,
    keeperConversations,
    loserConversations,
  });
  const client = db();

  /* 1. record first, so every later step is reversible ------------------ */
  const { data: event, error: eventError } = await client
    .from("merge_events")
    .insert({
      business_id: businessId,
      lead_id: keeper.id,
      rule: "MANUAL",
      confidence: 1,
      before: {
        kind: "LEAD_MERGE",
        fields: plan.before,
        loser: {
          id: loser.id,
          archived_at: loser.archived_at,
          archived_by: loser.archived_by,
          automation_active: loser.automation_active,
          identity_duplicate_of: loser.identity_duplicate_of,
        },
        messages: messageRows,
      },
      after: {
        kind: "LEAD_MERGE",
        candidate_id: candidate.id,
        loser_id: loser.id,
        fields: plan.patch,
        touches: touchIds,
        conversations: plan.reassignConversations,
        folds: plan.foldConversations,
      },
      actor_type: actor.type,
      actor_id: actor.userId,
    })
    .select("id")
    .single();
  if (eventError || !event)
    throw new MergeError("UNAVAILABLE", "The merge could not be recorded.");
  const mergeEventId = (event as { id: string }).id;
  const ctx = {
    businessId,
    keeperId: keeper.id,
    loserId: loser.id,
    mergeEventId,
  };

  /* 2. park the loser before its identifiers are copied ------------------ */
  assertWrite(
    await client
      .from("leads")
      .update({
        identity_duplicate_of: keeper.id,
        archived_at: loser.archived_at ?? new Date().toISOString(),
        archived_by: loser.archived_at ? loser.archived_by : actor.userId,
        automation_active: false,
      })
      .eq("id", loser.id)
      .eq("business_id", businessId),
    "merge: park loser",
    ctx,
  );

  /* 3. move touches, conversations, messages ----------------------------- */
  if (touchIds.length) {
    assertWrite(
      await client
        .from("lead_touches")
        .update({ lead_id: keeper.id })
        .eq("business_id", businessId)
        .in("id", touchIds),
      "merge: move touches",
      ctx,
    );
  }
  if (plan.reassignConversations.length) {
    assertWrite(
      await client
        .from("conversations")
        .update({ lead_id: keeper.id })
        .eq("business_id", businessId)
        .in("id", plan.reassignConversations),
      "merge: move conversations",
      ctx,
    );
  }
  for (const fold of plan.foldConversations) {
    assertWrite(
      await client
        .from("messages")
        .update({ lead_id: keeper.id, conversation_id: fold.into })
        .eq("business_id", businessId)
        .eq("conversation_id", fold.from),
      "merge: fold messages",
      ctx,
    );
  }
  if (messageRows.length) {
    assertWrite(
      await client
        .from("messages")
        .update({ lead_id: keeper.id })
        .eq("business_id", businessId)
        .eq("lead_id", loser.id)
        .in(
          "id",
          messageRows.map((m) => m.id),
        ),
      "merge: move messages",
      ctx,
    );
  }

  /* 4. fill the keeper's blanks ------------------------------------------ */
  if (Object.keys(plan.patch).length) {
    assertWrite(
      await client
        .from("leads")
        .update(plan.patch)
        .eq("id", keeper.id)
        .eq("business_id", businessId),
      "merge: fill keeper",
      ctx,
    );
  }

  /* 5. close the candidate, re-score the keeper -------------------------- */
  await markCandidate(candidate, "MERGED", actor.userId, "OPEN");
  await emitDomainEvent({
    businessId,
    type: "lead.touched",
    subject: { type: "lead", id: keeper.id },
    payload: {
      lead_id: keeper.id,
      reason: "merge",
      merge_event_id: mergeEventId,
    },
    dedupeKey: `merge:${mergeEventId}`,
  });

  return {
    decision: "MERGED",
    candidateId: candidate.id,
    mergeEventId,
    keeperId: keeper.id,
    loserId: loser.id,
    filledFields: Object.keys(plan.patch),
    moved: {
      touches: touchIds.length,
      messages: messageRows.length,
      conversations: plan.reassignConversations.length,
    },
  };
}

/* ------------------------------------------------------------------- revert */

type StoredMerge = {
  id: string;
  business_id: string;
  lead_id: string;
  rule: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reverted_at: string | null;
};

/**
 * Undoes a manual merge (or a prospect link) recorded by this module. Fields
 * the keeper still holds from the merge are cleared; anything edited since is
 * left alone and reported. Safe to re-run.
 */
export async function revertMerge(input: {
  businessId: string;
  mergeEventId: string;
  actorUserId: string | null;
}): Promise<{ keptFields: string[]; candidateReopened: boolean }> {
  const client = db();
  const { data, error } = await client
    .from("merge_events")
    .select("id, business_id, lead_id, rule, before, after, reverted_at")
    .eq("id", input.mergeEventId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (error)
    throw new MergeError("UNAVAILABLE", "The merge record could not be read.");
  if (!data)
    throw new MergeError("NOT_FOUND", "That merge could not be found.");
  const event = data as StoredMerge;
  if (event.reverted_at)
    throw new MergeError("CONFLICT", "That merge has already been undone.");

  const kind = event.after?.kind;
  const businessId = event.business_id;
  const ctx = { businessId, mergeEventId: event.id };
  let keptFields: string[] = [];

  if (kind === "PROSPECT_LINK") {
    const prospectId = String(event.after.prospect_id ?? "");
    if (!event.before.promoted_to_lead_id && prospectId) {
      assertWrite(
        await client
          .from("prospects")
          .update({
            promoted_to_lead_id: null,
            promoted_at: event.before.promoted_at ?? null,
          })
          .eq("id", prospectId)
          .eq("business_id", businessId)
          .eq("promoted_to_lead_id", event.lead_id),
        "merge revert: unlink prospect",
        ctx,
      );
    }
  } else if (kind === "LEAD_MERGE") {
    const loser = (event.before.loser ?? {}) as Record<string, unknown>;
    const loserId = String(event.after.loser_id ?? loser.id ?? "");
    if (!loserId)
      throw new MergeError("INVALID_INPUT", "That merge record is incomplete.");

    // Fields first, so the loser's email/phone is free again before it is un-parked.
    const patch = (event.after.fields ?? {}) as Record<string, unknown>;
    if (Object.keys(patch).length) {
      const current = await loadLead(businessId, event.lead_id);
      const { restore, kept } = revertFieldPatch(
        current as unknown as Record<string, unknown>,
        patch,
        (event.before.fields ?? {}) as Record<string, unknown>,
      );
      keptFields = kept;
      if (Object.keys(restore).length) {
        assertWrite(
          await client
            .from("leads")
            .update(restore)
            .eq("id", event.lead_id)
            .eq("business_id", businessId),
          "merge revert: restore keeper",
          ctx,
        );
      }
    }

    const messages = (event.before.messages ?? []) as {
      id: string;
      conversation_id: string | null;
    }[];
    const byConversation = new Map<string | null, string[]>();
    for (const message of messages) {
      const list = byConversation.get(message.conversation_id) ?? [];
      list.push(message.id);
      byConversation.set(message.conversation_id, list);
    }
    for (const [conversationId, ids] of byConversation) {
      assertWrite(
        await client
          .from("messages")
          .update({ lead_id: loserId, conversation_id: conversationId })
          .eq("business_id", businessId)
          .in("id", ids),
        "merge revert: return messages",
        ctx,
      );
    }
    const conversations = (event.after.conversations ?? []) as string[];
    if (conversations.length) {
      assertWrite(
        await client
          .from("conversations")
          .update({ lead_id: loserId })
          .eq("business_id", businessId)
          .in("id", conversations),
        "merge revert: return conversations",
        ctx,
      );
    }
    const touches = (event.after.touches ?? []) as string[];
    if (touches.length) {
      assertWrite(
        await client
          .from("lead_touches")
          .update({ lead_id: loserId })
          .eq("business_id", businessId)
          .in("id", touches),
        "merge revert: return touches",
        ctx,
      );
    }
    assertWrite(
      await client
        .from("leads")
        .update({
          identity_duplicate_of:
            (loser.identity_duplicate_of as string | null) ?? null,
          archived_at: (loser.archived_at as string | null) ?? null,
          archived_by: (loser.archived_by as string | null) ?? null,
          automation_active: Boolean(loser.automation_active),
        })
        .eq("id", loserId)
        .eq("business_id", businessId),
      "merge revert: restore loser",
      ctx,
    );
  } else {
    // Ingest-time fill-ins (rule EMAIL/PHONE/...) carry no move list; their
    // reversal belongs to the intake path, not this queue.
    throw new MergeError(
      "INVALID_INPUT",
      "Only merges made from the duplicate queue can be undone here.",
    );
  }

  assertWrite(
    await client
      .from("merge_events")
      .update({
        reverted_at: new Date().toISOString(),
        reverted_by: input.actorUserId,
      })
      .eq("id", event.id)
      .eq("business_id", businessId)
      .is("reverted_at", null),
    "merge revert: mark reverted",
    ctx,
  );

  let candidateReopened = false;
  const candidateId =
    typeof event.after.candidate_id === "string"
      ? event.after.candidate_id
      : null;
  if (candidateId) {
    const result = await client
      .from("merge_candidates")
      .update({ status: "OPEN", decided_by: null, decided_at: null })
      .eq("id", candidateId)
      .eq("business_id", businessId)
      .eq("status", "MERGED");
    candidateReopened = logWriteError(
      result,
      "merge revert: reopen candidate",
      ctx,
    );
  }

  await emitDomainEvent({
    businessId,
    type: "lead.touched",
    subject: { type: "lead", id: event.lead_id },
    payload: {
      lead_id: event.lead_id,
      reason: "merge_reverted",
      merge_event_id: event.id,
    },
    dedupeKey: `merge_revert:${event.id}`,
  });

  return { keptFields, candidateReopened };
}
