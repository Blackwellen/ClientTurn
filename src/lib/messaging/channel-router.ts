/**
 * The channel router (brief §47, Phase 3.5). Pure.
 *
 * `rankChannels` orders channels for one contact attempt. Its input is the
 * list of decisions the policy engine already made, and it only ever ranks
 * the ones marked allowed: a prohibited channel is filtered out before any
 * scoring, so no combination of preference, cost or urgency can make it win.
 * The router chooses between lawful options; it never widens them.
 *
 * Signals, strongest first:
 *   1. the lead's stated preference;
 *   2. the channel they last replied on;
 *   3. the channel they came in on (source channel);
 *   4. channel health (a degraded sender is demoted, a failing one dropped);
 *   5. unit cost -- only as a tie-breaker, and ignored when urgent;
 *   6. urgency -- favours the channels read fastest (SMS, WhatsApp).
 * Ties keep the caller's order, so the same input always gives the same answer.
 */

export type RoutableChannel = "email" | "sms" | "whatsapp" | "messenger" | "instagram" | "linkedin" | "tiktok";

export type ChannelDecision = {
  channel: RoutableChannel;
  /** The policy engine's verdict for this contact, on this channel, now. */
  allowed: boolean;
  /** Why not, for the audit trail. */
  reason?: string;
};

export type ChannelHealth = "HEALTHY" | "DEGRADED" | "FAILING";

export type RoutingSignals = {
  statedPreference?: RoutableChannel | null;
  lastReplyChannel?: RoutableChannel | null;
  sourceChannel?: RoutableChannel | null;
  health?: Partial<Record<RoutableChannel, ChannelHealth>>;
  /** Cost of one message, minor units. */
  unitCostMinor?: Partial<Record<RoutableChannel, number>>;
  urgent?: boolean;
};

export type RankedChannel = { channel: RoutableChannel; score: number; why: string[] };

const FAST_CHANNELS = new Set<RoutableChannel>(["sms", "whatsapp"]);

export function rankChannels(decisions: ChannelDecision[], signals: RoutingSignals = {}): RankedChannel[] {
  const seen = new Set<RoutableChannel>();
  const allowed = decisions.filter((decision) => {
    if (!decision.allowed || seen.has(decision.channel)) return false;
    seen.add(decision.channel);
    return true;
  });

  const costs = allowed
    .map((d) => signals.unitCostMinor?.[d.channel])
    .filter((cost): cost is number => typeof cost === "number");
  const cheapest = costs.length ? Math.min(...costs) : null;

  const scored = allowed
    .map((decision, index) => {
      const channel = decision.channel;
      const why: string[] = [];
      let score = 0;
      const health = signals.health?.[channel] ?? "HEALTHY";
      if (health === "FAILING") return null;
      if (health === "DEGRADED") {
        score -= 15;
        why.push("sender degraded");
      }
      if (signals.statedPreference === channel) {
        score += 100;
        why.push("stated preference");
      }
      if (signals.lastReplyChannel === channel) {
        score += 50;
        why.push("last replied here");
      }
      if (signals.sourceChannel === channel) {
        score += 20;
        why.push("came in on this channel");
      }
      if (signals.urgent && FAST_CHANNELS.has(channel)) {
        score += 10;
        why.push("urgent: read fastest");
      }
      const cost = signals.unitCostMinor?.[channel];
      if (!signals.urgent && cheapest !== null && typeof cost === "number" && cost === cheapest) {
        score += 1;
        why.push("lowest cost");
      }
      return { channel, score, why, index };
    })
    .filter((entry): entry is RankedChannel & { index: number } => entry !== null);

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ channel, score, why }) => ({ channel, score, why }));
}

/** The winner, or null when nothing is allowed (the caller raises attention). */
export function bestChannel(decisions: ChannelDecision[], signals: RoutingSignals = {}): RoutableChannel | null {
  return rankChannels(decisions, signals)[0]?.channel ?? null;
}
