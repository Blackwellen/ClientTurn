/**
 * Whether a suggested reply may still be approved.
 *
 * Pure, so the rule is unit-testable and has one copy. A draft answers the
 * conversation as it stood when it was written; if the lead has written again
 * since, the draft may answer a question they have withdrawn, or ignore one
 * they have just asked. Sending it would put words in the business's mouth
 * that nobody checked against what the lead actually said last.
 */

export const STALE_DRAFT_ERROR =
  "The lead has replied since this draft was written — review the conversation before sending.";

export type DraftApprovalVerdict =
  | { ok: true }
  | { ok: false; reason: "LEAD_REPLIED_SINCE"; error: string };

export function draftApprovalVerdict(input: {
  draftCreatedAt: string;
  /** The newest inbound message on the draft's conversation, if any. */
  latestInboundAt: string | null;
}): DraftApprovalVerdict {
  if (!input.latestInboundAt) return { ok: true };

  const drafted = Date.parse(input.draftCreatedAt);
  const inbound = Date.parse(input.latestInboundAt);

  // An unreadable timestamp is not evidence the draft is current.
  if (Number.isNaN(drafted) || Number.isNaN(inbound) || inbound > drafted) {
    return { ok: false, reason: "LEAD_REPLIED_SINCE", error: STALE_DRAFT_ERROR };
  }

  return { ok: true };
}
