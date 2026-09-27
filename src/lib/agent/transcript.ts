import { UNTRUSTED_CONTENT_NOTICE, wrapUntrustedContent } from "../ai/safety.ts";

/**
 * The RECENT CONVERSATION block of an agent turn, with nothing duplicated.
 *
 * Pure: no I/O, no `server-only`, relative `.ts` imports only, so it is measured
 * under `node --test` (tests/token-budget.test.ts records it in the snapshot).
 *
 * Why it is bounded. The turn loads the last VERBATIM_MESSAGE_WINDOW (8)
 * messages, and before this every one went to the model whole. On SMS that is
 * a few hundred tokens; on email a single message with a signature and the
 * quoted thread underneath runs to thousands, and eight of them were the
 * largest variable cost of a turn. The model does not need them: what to do
 * this turn is decided by the engine and arrives in the strategy block, the
 * facts are in QUALIFICATION STATE and opportunity memory, and the older
 * history is in the rolling summary. The transcript is there for continuity
 * and wording, which the head of each recent message carries.
 *
 * OWNER RULE (2026-09-27): cost cutting must not reduce the agent's ability
 * to complete a sale, and "no token trimming that removes facts the agent
 * needs". So the DEFAULT is lossless: rules 1 and 5 only, which remove pure
 * duplication (the current message sent twice; the same notice repeated).
 * Every loaded message goes to the model whole, exactly as before. Rules 2-4
 * are kept as `BOUNDED_TRANSCRIPT_LIMITS`, measured in the token snapshot but
 * NOT used by a live turn; switching to them is a quality decision for the
 * owner, to be taken only with the golden-conversation and grader suites.
 *
 * The rules, all deterministic:
 *
 *  1. The current inbound message is rendered once, under CURRENT MESSAGE.
 *     It is already stored when the turn runs, so it is also the last row of
 *     the loaded window; that duplicate is dropped from the transcript.
 *  2. Each earlier message is cut to TRANSCRIPT_MESSAGE_MAX_CHARS at a word
 *     boundary, marked as trimmed. The head is kept: in an email reply the
 *     new text is on top and the quoted thread below.
 *  3. The transcript as a whole is held to TRANSCRIPT_MAX_CHARS by dropping
 *     the oldest messages first, never the newest TRANSCRIPT_MIN_MESSAGES.
 *  4. The current message is cut only past CURRENT_MESSAGE_MAX_CHARS, which a
 *     genuine reply rarely reaches.
 *  5. The untrusted-content notice (~78 tokens) is stated once at the head of
 *     the transcript, covering every Lead message in it, each still fenced
 *     between --- lines -- rather than repeated in front of every one. The
 *     current message keeps its own full wrap (`wrapUntrustedContent`).
 *
 * Only the rendering is bounded. `context.conversation.recentMessages` itself
 * is untouched, so the validator's repeated-question check still sees every
 * loaded message in full, and deterministic classification and injection
 * detection still read the full inbound text.
 */

export const TRANSCRIPT_MESSAGE_MAX_CHARS = 500;
export const TRANSCRIPT_MAX_CHARS = 2_800;
export const TRANSCRIPT_MIN_MESSAGES = 2;
export const CURRENT_MESSAGE_MAX_CHARS = 2_400;

export const TRIMMED_MARKER = " [...]";

export type TranscriptTurn = { role: "lead" | "business"; body: string };

export type TranscriptLimits = {
  messageMaxChars: number;
  totalMaxChars: number;
  minMessages: number;
  currentMaxChars: number;
  /** Drop the window's last message when it is the current inbound message. */
  dedupeCurrent: boolean;
};

/** Clips each message and the total. Measured only; not used by a live turn. */
export const BOUNDED_TRANSCRIPT_LIMITS: TranscriptLimits = {
  messageMaxChars: TRANSCRIPT_MESSAGE_MAX_CHARS,
  totalMaxChars: TRANSCRIPT_MAX_CHARS,
  minMessages: TRANSCRIPT_MIN_MESSAGES,
  currentMaxChars: CURRENT_MESSAGE_MAX_CHARS,
  dedupeCurrent: true,
};

/**
 * What a live turn uses: lossless. Every loaded message whole; only the
 * duplicate of the current message is dropped (it is rendered once, under
 * CURRENT MESSAGE), and the untrusted notice is stated once.
 */
export const DEFAULT_TRANSCRIPT_LIMITS: TranscriptLimits = {
  messageMaxChars: Number.POSITIVE_INFINITY,
  totalMaxChars: Number.POSITIVE_INFINITY,
  minMessages: 0,
  currentMaxChars: Number.POSITIVE_INFINITY,
  dedupeCurrent: true,
};

/** The pre-bounding behaviour, kept for the token snapshot's before/after. */
export const UNBOUNDED_TRANSCRIPT_LIMITS: TranscriptLimits = {
  messageMaxChars: Number.POSITIVE_INFINITY,
  totalMaxChars: Number.POSITIVE_INFINITY,
  minMessages: 0,
  currentMaxChars: Number.POSITIVE_INFINITY,
  dedupeCurrent: false,
};

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cuts `text` to at most `max` characters (marker included), at a word boundary where one is near. */
export function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  if (!Number.isFinite(max) || trimmed.length <= max) return trimmed;
  const room = Math.max(max - TRIMMED_MARKER.length, 0);
  const head = trimmed.slice(0, room);
  const space = head.lastIndexOf(" ");
  // Only back up to a space when it costs under a fifth of the room.
  const cut = space > room * 0.8 ? head.slice(0, space) : head;
  return `${cut.trimEnd()}${TRIMMED_MARKER}`;
}

/**
 * The messages that go into RECENT CONVERSATION, oldest first, each already
 * clipped. `latestMessage` is the current inbound text (null on a turn with
 * none, e.g. LEAD_CREATED).
 */
export function selectTranscript(
  recent: readonly TranscriptTurn[],
  latestMessage: string | null,
  limits: TranscriptLimits = DEFAULT_TRANSCRIPT_LIMITS,
): TranscriptTurn[] {
  let window = recent.slice();
  const last = window[window.length - 1];
  if (
    limits.dedupeCurrent &&
    latestMessage &&
    last?.role === "lead" &&
    normalise(last.body) === normalise(latestMessage)
  ) {
    window = window.slice(0, -1);
  }

  const clipped = window.map((turn) => ({ role: turn.role, body: clipText(turn.body, limits.messageMaxChars) }));

  // Newest first until the budget is spent; the newest `minMessages` always stay.
  const kept: TranscriptTurn[] = [];
  let used = 0;
  for (let i = clipped.length - 1; i >= 0; i -= 1) {
    const size = clipped[i].body.length;
    if (kept.length >= limits.minMessages && used + size > limits.totalMaxChars) break;
    kept.unshift(clipped[i]);
    used += size;
  }
  return kept;
}

/** The current inbound message as the model sees it. */
export function clipCurrentMessage(
  latestMessage: string,
  limits: TranscriptLimits = DEFAULT_TRANSCRIPT_LIMITS,
): string {
  return clipText(latestMessage, limits.currentMaxChars);
}

/** Stated once above the transcript's lead messages. */
export const TRANSCRIPT_UNTRUSTED_NOTICE =
  `${UNTRUSTED_CONTENT_NOTICE} This applies to every Lead message below, each between --- lines.`;

/**
 * Renders RECENT CONVERSATION (and CURRENT MESSAGE FROM THE LEAD when there is
 * one) as the blocks context.ts appends to the volatile context.
 * `perMessageNotice` restores the old shape (the notice before every lead
 * message); it exists for the token snapshot's before/after only.
 */
export function renderTranscriptBlocks(
  recent: readonly TranscriptTurn[],
  latestMessage: string | null,
  limits: TranscriptLimits = DEFAULT_TRANSCRIPT_LIMITS,
  perMessageNotice = false,
): string[] {
  const turns = selectTranscript(recent, latestMessage, limits);
  const hasLead = turns.some((turn) => turn.role === "lead");
  const lines = turns.map((turn) =>
    turn.role === "business"
      ? `Business: ${turn.body}`
      : perMessageNotice
        ? `Lead: ${wrapUntrustedContent(turn.body)}`
        : `Lead:\n---\n${turn.body}\n---`,
  );
  const transcript = turns.length
    ? [hasLead && !perMessageNotice ? TRANSCRIPT_UNTRUSTED_NOTICE : null, ...lines]
        .filter((line): line is string => line !== null)
        .join("\n")
    : "No prior messages.";
  const blocks = [`RECENT CONVERSATION\n${transcript}`];
  if (latestMessage) {
    blocks.push(`CURRENT MESSAGE FROM THE LEAD\n${wrapUntrustedContent(clipCurrentMessage(latestMessage, limits))}`);
  }
  return blocks;
}
