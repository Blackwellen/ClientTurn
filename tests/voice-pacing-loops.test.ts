import { test } from "node:test";
import assert from "node:assert/strict";
import { agentTargets, checkAgentTurn, countWords, measurePace, type Utterance } from "../src/lib/voice/pacing.ts";
import { initialLoopState, jaccard, normaliseWords, observeTurn, type Availability, type LoopTurn } from "../src/lib/voice/anti-loop.ts";

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

test("measurePace: words per minute, latency, pauses, interruptions", () => {
  const u: Utterance[] = [
    { speaker: "AGENT", text: "Hello there", startMs: 0, endMs: 2000 },
    { speaker: "LEAD", text: words(30), startMs: 2600, endMs: 17600 }, // 30 words / 15 s = 120 wpm
    { speaker: "LEAD", text: words(10), startMs: 19600, endMs: 24600 }, // 2 s pause inside the lead's turn
    { speaker: "AGENT", text: "Right", startMs: 25000, endMs: 26000 },
    { speaker: "LEAD", text: "sorry", startMs: 25500, endMs: 26500 }, // talk-over
  ];
  const p = measurePace(u);
  assert.equal(p.leadWords, 41);
  assert.equal(p.leadWordsPerMinute, Math.round((41 / 21000) * 60000));
  assert.equal(p.band, "SLOW"); // 117 wpm
  assert.equal(p.medianResponseLatencyMs, 600);
  assert.equal(p.longestLeadPauseMs, 2000);
  assert.equal(p.interruptions, 1);
});

test("pace bands and the minimum sample", () => {
  const slow = measurePace([{ speaker: "LEAD", text: words(25), startMs: 0, endMs: 15000 }]); // 100 wpm
  assert.equal(slow.band, "SLOW");
  const fast = measurePace([{ speaker: "LEAD", text: words(50), startMs: 0, endMs: 15000 }]); // 200 wpm
  assert.equal(fast.band, "FAST");
  const tiny = measurePace([{ speaker: "LEAD", text: "yes please", startMs: 0, endMs: 500 }]);
  assert.equal(tiny.band, "UNKNOWN");
  assert.equal(measurePace([]).leadWordsPerMinute, null);
});

test("agent targets follow the lead within bounds", () => {
  const slow = agentTargets(measurePace([{ speaker: "LEAD", text: words(25), startMs: 0, endMs: 15000 }]));
  assert.deepEqual(slow, { speakingRateWpm: 130, maxWordsPerTurn: 25, maxQuestionsPerTurn: 1, maxWordsPerSentence: 25, responseDelayMs: 500 });
  const fast = agentTargets(measurePace([{ speaker: "LEAD", text: words(50), startMs: 0, endMs: 15000 }]));
  assert.equal(fast.speakingRateWpm, 165);
  assert.equal(fast.maxWordsPerTurn, 35);
  const interrupting = agentTargets({ band: "MEDIUM", leadWordsPerMinute: 150, leadWords: 100, medianResponseLatencyMs: 2400, longestLeadPauseMs: null, interruptions: 3 });
  assert.equal(interrupting.maxWordsPerTurn, 20);
  assert.equal(interrupting.responseDelayMs, 900);
  assert.equal(interrupting.speakingRateWpm, 150);
});

test("natural-voice rules are measurable per turn", () => {
  const t = agentTargets(measurePace([]));
  assert.deepEqual(checkAgentTurn("That makes sense. What would a good outcome look like for you?", t), []);
  assert.ok(checkAgentTurn("Is it for the new site? And when do you need it?", t).includes("MULTIPLE_QUESTIONS"));
  assert.ok(checkAgentTurn(words(36), t).includes("TOO_MANY_WORDS"));
  assert.ok(checkAgentTurn(`${words(26)}.`, t).includes("LONG_SENTENCE"));
  assert.ok(checkAgentTurn("Have a look at https://example.com today.", t).includes("CONTAINS_URL"));
  assert.ok(checkAgentTurn("Visit acme.co.uk for more.", t).includes("CONTAINS_URL"));
  assert.ok(checkAgentTurn("**Great** news.", t).includes("CONTAINS_MARKDOWN"));
  assert.deepEqual(checkAgentTurn("   ", t), ["EMPTY"]);
  assert.equal(countWords("  one, two -- three  "), 3);
});

const BOTH: Availability = { textFollowUpLawful: true, humanAvailable: true };

function run(turns: LoopTurn[], avail: Availability = BOTH) {
  let s = initialLoopState();
  const escalations: string[] = [];
  for (const t of turns) {
    const r = observeTurn(s, t, avail);
    s = r.state;
    if (r.escalation !== "NONE") escalations.push(`${r.detected}:${r.escalation}`);
  }
  return { state: s, escalations };
}

test("repeated question by key or by wording", () => {
  const byKey = run([
    { speaker: "AGENT", text: "What is your budget?", questionKey: "budget" },
    { speaker: "AGENT", text: "Roughly how much were you hoping to spend?", questionKey: "budget" },
  ]);
  assert.deepEqual(byKey.escalations, ["REPEATED_QUESTION:REPHRASE"]);
  const byWords = run([
    { speaker: "AGENT", text: "When would you like the new website to launch?" },
    { speaker: "AGENT", text: "When would you like your new website to launch?" },
  ]);
  assert.deepEqual(byWords.escalations, ["REPEATED_QUESTION:REPHRASE"]);
  const different = run([
    { speaker: "AGENT", text: "When would you like the new website to launch?" },
    { speaker: "AGENT", text: "Who else is involved in the decision?" },
  ]);
  assert.deepEqual(different.escalations, []);
  assert.ok(jaccard(normaliseWords("a b c"), normaliseWords("a b c")) === 1);
});

test("repeated misunderstanding needs two in a row", () => {
  const r = run([
    { speaker: "LEAD", text: "sorry what", misunderstanding: true },
    { speaker: "LEAD", text: "ok", misunderstanding: false },
    { speaker: "LEAD", text: "pardon", misunderstanding: true },
    { speaker: "LEAD", text: "I did not catch that", misunderstanding: true },
  ]);
  assert.deepEqual(r.escalations, ["REPEATED_MISUNDERSTANDING:REPHRASE"]);
});

test("circular objection escalates up the full ladder", () => {
  const r = run([
    { speaker: "LEAD", text: "too pricey", objectionKey: "PRICE" },
    { speaker: "LEAD", text: "still too pricey", objectionKey: "PRICE" },
    { speaker: "LEAD", text: "it is just too much", objectionKey: "PRICE" },
    { speaker: "LEAD", text: "no, the price", objectionKey: "PRICE" },
    { speaker: "LEAD", text: "price again", objectionKey: "PRICE" },
    { speaker: "LEAD", text: "price once more", objectionKey: "PRICE" },
  ]);
  assert.deepEqual(r.escalations, [
    "CIRCULAR_OBJECTION:REPHRASE",
    "CIRCULAR_OBJECTION:OFFER_TEXT_FOLLOW_UP",
    "CIRCULAR_OBJECTION:OFFER_HUMAN",
    "CIRCULAR_OBJECTION:END_POLITELY",
    "CIRCULAR_OBJECTION:END_POLITELY",
  ]);
});

test("unavailable rungs are skipped: no lawful text, no person", () => {
  const turns: LoopTurn[] = [
    { speaker: "LEAD", text: "x", objectionKey: "TIMING" },
    { speaker: "LEAD", text: "x", objectionKey: "TIMING" },
    { speaker: "LEAD", text: "x", objectionKey: "TIMING" },
  ];
  assert.deepEqual(run(turns, { textFollowUpLawful: false, humanAvailable: true }).escalations, [
    "CIRCULAR_OBJECTION:REPHRASE",
    "CIRCULAR_OBJECTION:OFFER_HUMAN",
  ]);
  assert.deepEqual(run(turns, { textFollowUpLawful: false, humanAvailable: false }).escalations, [
    "CIRCULAR_OBJECTION:REPHRASE",
    "CIRCULAR_OBJECTION:END_POLITELY",
  ]);
});

test("observeTurn is pure: the input state is not mutated", () => {
  const s = initialLoopState();
  observeTurn(s, { speaker: "AGENT", text: "Budget?", questionKey: "b" }, BOTH);
  assert.deepEqual(s, initialLoopState());
});
