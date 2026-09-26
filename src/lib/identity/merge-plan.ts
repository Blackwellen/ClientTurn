/**
 * The plan for a person-approved merge of two leads (Phase 5, the admin and
 * workspace duplicate queue over `merge_candidates`).
 *
 * Pure: the caller loads both leads and their conversations, this decides what
 * moves where, and `merge.ts` carries it out and records it. Kept apart from
 * `resolve.ts` (ingest-time identity decisions, owned by the intake path) but
 * reusing its fill-blanks rule, so a manual merge and an automatic one can
 * never disagree about which fields a merge may touch.
 *
 * Rules:
 *   * The keeper is the older lead unless the person chose otherwise: it holds
 *     the provenance (source, created_at) attribution is built on.
 *   * Fill blanks only. A value on the keeper is never replaced.
 *   * Touches and messages move to the keeper. A conversation moves too, unless
 *     the keeper already has one on that channel (one thread per lead and
 *     channel, 0029) -- then its messages fold into the keeper's thread and the
 *     emptied conversation stays with the archived lead.
 *   * Everything the plan changes is snapshotted first, so it can be reversed.
 */

import {
  MERGEABLE_LEAD_FIELDS,
  mergePatch,
  type MergeableLeadField,
} from "./resolve.ts";

export type MergeLead = Partial<Record<MergeableLeadField, unknown>> & {
  id: string;
  created_at: string;
};

export type MergeConversation = { id: string; channel: string };

export type MergePlan = {
  keeperId: string;
  loserId: string;
  /** Fields to write on the keeper (blanks only). */
  patch: Partial<Record<MergeableLeadField, unknown>>;
  /** The keeper's values for exactly those fields, before. */
  before: Partial<Record<MergeableLeadField, unknown>>;
  /** Loser conversations re-pointed at the keeper whole. */
  reassignConversations: string[];
  /** Loser conversations whose messages fold into a keeper conversation. */
  foldConversations: { from: string; into: string }[];
};

export class MergePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergePlanError";
  }
}

/** The older lead keeps the record unless a person picked one. */
export function chooseKeeper(
  a: MergeLead,
  b: MergeLead,
  preferredKeeperId?: string | null,
): { keeper: MergeLead; loser: MergeLead } {
  if (preferredKeeperId) {
    if (preferredKeeperId === a.id) return { keeper: a, loser: b };
    if (preferredKeeperId === b.id) return { keeper: b, loser: a };
    throw new MergePlanError(
      "The chosen record is not one of the two being merged.",
    );
  }
  const aTime = Date.parse(a.created_at);
  const bTime = Date.parse(b.created_at);
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && bTime < aTime) {
    return { keeper: b, loser: a };
  }
  return { keeper: a, loser: b };
}

export function planMerge(input: {
  keeper: MergeLead;
  loser: MergeLead;
  keeperConversations: MergeConversation[];
  loserConversations: MergeConversation[];
}): MergePlan {
  const { keeper, loser } = input;
  if (keeper.id === loser.id)
    throw new MergePlanError("A lead cannot be merged into itself.");

  const { patch, before } = mergePatch(keeper, loser);

  // `multi` threads are prospect threads, exempt from the per-channel index.
  const keeperByChannel = new Map<string, string>();
  for (const conversation of input.keeperConversations) {
    if (
      conversation.channel !== "multi" &&
      !keeperByChannel.has(conversation.channel)
    ) {
      keeperByChannel.set(conversation.channel, conversation.id);
    }
  }

  const reassignConversations: string[] = [];
  const foldConversations: { from: string; into: string }[] = [];
  for (const conversation of input.loserConversations) {
    const existing =
      conversation.channel === "multi"
        ? undefined
        : keeperByChannel.get(conversation.channel);
    if (existing) {
      foldConversations.push({ from: conversation.id, into: existing });
    } else {
      reassignConversations.push(conversation.id);
      // A second loser thread on the same channel must fold into this one.
      if (conversation.channel !== "multi")
        keeperByChannel.set(conversation.channel, conversation.id);
    }
  }

  return {
    keeperId: keeper.id,
    loserId: loser.id,
    patch,
    before,
    reassignConversations,
    foldConversations,
  };
}

/**
 * Undoing the field fill: a field is put back only while it still holds the
 * value the merge wrote. Anything a person edited since is theirs and stays.
 */
export function revertFieldPatch(
  current: Partial<Record<string, unknown>>,
  patch: Partial<Record<string, unknown>>,
  before: Partial<Record<string, unknown>>,
): { restore: Record<string, unknown>; kept: string[] } {
  const restore: Record<string, unknown> = {};
  const kept: string[] = [];
  for (const field of Object.keys(patch)) {
    if (!(MERGEABLE_LEAD_FIELDS as readonly string[]).includes(field)) continue;
    if (current[field] === patch[field]) restore[field] = before[field] ?? null;
    else kept.push(field);
  }
  return { restore, kept };
}
