/**
 * Pacing: measure how the lead speaks and derive how the agent should speak.
 * Pure. Input is the provider's timed transcript (utterances with start/end
 * milliseconds); output is a pace profile plus measurable targets the turn
 * adapter enforces on every agent turn.
 *
 * Natural-voice rules (measurable, checked by `checkAgentTurn`):
 *   - at most `maxWordsPerTurn` words (default 35, fewer for a slow or
 *     interrupting speaker);
 *   - at most ONE question per turn;
 *   - no sentence over 25 words;
 *   - nothing that cannot be spoken: no URLs, no markdown, no lists.
 */

export type Speaker = "LEAD" | "AGENT";
export type Utterance = { speaker: Speaker; text: string; startMs: number; endMs: number };

export type PaceBand = "SLOW" | "MEDIUM" | "FAST" | "UNKNOWN";

export type PaceProfile = {
  band: PaceBand;
  leadWordsPerMinute: number | null;
  leadWords: number;
  /** Median gap between the agent finishing and the lead starting, ms. */
  medianResponseLatencyMs: number | null;
  /** Longest silence inside the lead's own turns, ms. */
  longestLeadPauseMs: number | null;
  /** Lead utterances that began before the agent finished. */
  interruptions: number;
};

export type AgentTargets = {
  speakingRateWpm: number;
  maxWordsPerTurn: number;
  maxQuestionsPerTurn: 1;
  maxWordsPerSentence: number;
  /** Pause to leave before replying, ms. */
  responseDelayMs: number;
};

export const MIN_WORDS_FOR_PROFILE = 20;
export const SLOW_BELOW_WPM = 120;
export const FAST_ABOVE_WPM = 170;
export const AGENT_WPM_FLOOR = 130;
export const AGENT_WPM_CEILING = 165;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function measurePace(utterances: readonly Utterance[]): PaceProfile {
  const sorted = [...utterances].sort((a, b) => a.startMs - b.startMs);
  let leadWords = 0;
  let leadMs = 0;
  const latencies: number[] = [];
  let interruptions = 0;
  let longestLeadPauseMs: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i];
    if (u.speaker !== "LEAD") continue;
    leadWords += countWords(u.text);
    leadMs += Math.max(0, u.endMs - u.startMs);
    const prev = sorted[i - 1];
    if (prev && prev.speaker === "AGENT") {
      if (u.startMs < prev.endMs) interruptions++;
      else latencies.push(u.startMs - prev.endMs);
    }
    if (prev && prev.speaker === "LEAD") {
      const gap = u.startMs - prev.endMs;
      if (gap > 0) longestLeadPauseMs = Math.max(longestLeadPauseMs ?? 0, gap);
    }
  }

  const wpm = leadMs > 0 ? Math.round((leadWords / leadMs) * 60000) : null;
  let band: PaceBand = "UNKNOWN";
  if (wpm != null && leadWords >= MIN_WORDS_FOR_PROFILE) {
    band = wpm < SLOW_BELOW_WPM ? "SLOW" : wpm > FAST_ABOVE_WPM ? "FAST" : "MEDIUM";
  }
  return {
    band,
    leadWordsPerMinute: wpm,
    leadWords,
    medianResponseLatencyMs: median(latencies),
    longestLeadPauseMs,
    interruptions,
  };
}

export function agentTargets(profile: PaceProfile): AgentTargets {
  const rate =
    profile.band === "UNKNOWN" || profile.leadWordsPerMinute == null
      ? 150
      : Math.min(AGENT_WPM_CEILING, Math.max(AGENT_WPM_FLOOR, profile.leadWordsPerMinute));
  let maxWords = 35;
  if (profile.band === "SLOW") maxWords = 25;
  if (profile.interruptions >= 2) maxWords = Math.min(maxWords, 20);
  // A slow responder is given more room before the agent speaks again; the
  // delay stays inside a natural 300 to 900 ms band.
  const latency = profile.medianResponseLatencyMs;
  const responseDelayMs = latency == null ? 500 : Math.min(900, Math.max(300, Math.round(latency / 2)));
  return {
    speakingRateWpm: rate,
    maxWordsPerTurn: maxWords,
    maxQuestionsPerTurn: 1,
    maxWordsPerSentence: 25,
    responseDelayMs,
  };
}

export type TurnViolation = "TOO_MANY_WORDS" | "MULTIPLE_QUESTIONS" | "LONG_SENTENCE" | "CONTAINS_URL" | "CONTAINS_MARKDOWN" | "EMPTY";

export function checkAgentTurn(text: string, targets: AgentTargets): TurnViolation[] {
  const out: TurnViolation[] = [];
  const t = text.trim();
  if (!t) return ["EMPTY"];
  if (countWords(t) > targets.maxWordsPerTurn) out.push("TOO_MANY_WORDS");
  if ((t.match(/\?/g) ?? []).length > targets.maxQuestionsPerTurn) out.push("MULTIPLE_QUESTIONS");
  const sentences = t.split(/(?<=[.!?])\s+/);
  if (sentences.some((s) => countWords(s) > targets.maxWordsPerSentence)) out.push("LONG_SENTENCE");
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|co\.uk|io|net|org)\b/i.test(t)) out.push("CONTAINS_URL");
  if (/[*_#`]|^\s*[-•]\s|^\s*\d+\.\s/m.test(t)) out.push("CONTAINS_MARKDOWN");
  return out;
}
