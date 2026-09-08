/**
 * How long is left to answer a commenter, and whether the one reply is spent.
 *
 * Pure — no `server-only`, no React, no Supabase — because this is the rule the
 * server, the client and the tests all have to agree on, and a rule that lives
 * inside a component can only be verified by rendering one.
 *
 * The seven-day private-reply window is the only deadline in the product that
 * expires **silently**. Nothing goes wrong when it lapses: no error, no bounce,
 * no failed job — the person simply becomes permanently unreachable, and a
 * customer looking at a healthy-seeming prospect has no way to tell. So it is
 * computed wherever a commenter is shown, and it counts down rather than merely
 * being present.
 *
 * The clock runs from the comment, not from when we found it. A comment
 * discovered on day six has one day left, not seven, and displaying it
 * otherwise would have somebody schedule a reply that Meta refuses.
 */

/** Mirrors `META_PRIVATE_REPLY_WINDOW_DAYS`; asserted equal in the tests. */
export const PRIVATE_REPLY_WINDOW_DAYS = 7;

export type PrivateReplyState =
  | { state: "NONE" }
  | { state: "OPEN"; hoursLeft: number }
  | { state: "EXPIRED" }
  | { state: "SPENT"; sentAt: string };

/**
 * `now` is a parameter so a server render and its hydration agree. A countdown
 * that reads six hours on the server and five in the browser is a hydration
 * mismatch, and reading the clock during render is what causes it.
 */
export function privateReplyState(input: {
  commentId: string | null;
  commentedAt: string | null;
  sentAt: string | null;
  now?: Date;
}): PrivateReplyState {
  // Spent outranks open. A prospect with six days left and a reply already sent
  // is not actionable, and showing a countdown would suggest it was.
  if (input.sentAt) return { state: "SPENT", sentAt: input.sentAt };
  if (!input.commentId || !input.commentedAt) return { state: "NONE" };

  const posted = new Date(input.commentedAt).getTime();
  // An unparseable timestamp is treated as expired: attempting a send Meta will
  // refuse is worse than skipping one it might have allowed.
  if (!Number.isFinite(posted)) return { state: "EXPIRED" };

  const now = (input.now ?? new Date()).getTime();
  const msLeft = posted + PRIVATE_REPLY_WINDOW_DAYS * 86_400_000 - now;

  if (msLeft <= 0) return { state: "EXPIRED" };
  return { state: "OPEN", hoursLeft: Math.ceil(msLeft / 3600_000) };
}

/** "3 days left" / "5 hours left". Hours only inside the last day. */
export function remainingLabel(hoursLeft: number): string {
  if (hoursLeft < 24) return `${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"} left`;
  const days = Math.floor(hoursLeft / 24);
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
