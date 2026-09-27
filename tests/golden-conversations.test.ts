import { lintStyle } from "../src/lib/agent/validate.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { renderTable, restatedAsk, runConversation, type GoldenConversation, type TurnRow } from "./golden-conversations/harness.ts";
import {
  CTA_ACTIONS,
  MAX_ASKS_PER_INTENT,
  NBA_ACTION_NEEDS_MODEL,
  nextBestActionSchema,
} from "../src/lib/qualification-intelligence/types.ts";
import { countQuestions } from "../src/lib/agent/validate.ts";
import { forbiddenDimensions } from "../src/lib/qualification-intelligence/qa.ts";
import { planFor } from "../src/lib/agent/qi-turn.ts";
import { parsePreferredTime, preferredTimeQuestion } from "../src/lib/agent/availability/preferred-time.ts";
import { LIVE_MODE } from "./evals/live-hook.ts";

/**
 * Golden conversations (design 08 §23, §C.4): at least three multi-turn
 * conversations for each of the seven archetype profiles, each a per-turn
 * table (Turn / Known / Intent / Required unknown / Candidate questions /
 * Selected action / Expected), driven through the real pure engine.
 *
 * Every turn of every conversation is held to nine behaviours:
 *   B1 never asks what is already known (CONFIRMED, or INFERRED and not material);
 *   B2 one question per turn at most (the NBA and the canned reply);
 *   B3 adapts: a dimension answered this turn is not the next question;
 *   B4 no repetition: an intent is planned at most MAX_ASKS_PER_INTENT times;
 *   B5 stops at the threshold: no qualifying question once it is met;
 *   B6 booking- or purchase-ready moves to the close (at most one gating question);
 *   B7 negative, not-now and opted-out leads are not pursued;
 *   B8 respects the business: forbidden and never-ask dimensions are never
 *      planned, and the same opening is qualified differently per archetype;
 *   B9 never asks what the lead's own messages state, read by the extractors
 *      (manual inspection §110, MI-2), unless it is a CLARIFY or a stale VERIFY.
 * Plus the per-turn expectations in each JSON, and the QA verdict on a canned
 * candidate reply.
 */

const DIR = path.join(process.cwd(), "tests", "golden-conversations");
const conversations: GoldenConversation[] = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(path.join(DIR, file), "utf8")) as GoldenConversation);

const ASKING = new Set(["ASK", "ANSWER_AND_ASK"]);
const results = new Map<string, TurnRow[]>();
for (const c of conversations) results.set(c.id, runConversation(c));

describe("golden corpus", () => {
  test("at least three conversations for each of the seven archetype profiles (21+)", () => {
    const byArchetype = new Map<string, number>();
    for (const c of conversations) byArchetype.set(c.archetype, (byArchetype.get(c.archetype) ?? 0) + 1);
    for (const archetype of ["ROOFER", "MSP", "B2B_SAAS", "ACCOUNTING", "ECOMMERCE", "ENTERPRISE_SAAS", "CREATIVE_WEB_STUDIO"]) {
      assert.ok((byArchetype.get(archetype) ?? 0) >= 3, `${archetype}: ${byArchetype.get(archetype) ?? 0}`);
    }
    assert.ok(conversations.length >= 21);
    assert.equal(new Set(conversations.map((c) => c.id)).size, conversations.length);
  });
});

for (const conversation of conversations) {
  describe(`${conversation.id} (${conversation.archetype}, ${conversation.motion}, ${conversation.channel})`, () => {
    const rows = results.get(conversation.id)!;
    const table = renderTable(conversation, rows);
    const neverAsk = new Set<string>(rows[0]?.resolved.neverAsk ?? []);
    const forbidden = forbiddenDimensions(rows[0]?.resolved.forbiddenIntents ?? []);

    for (const row of rows) {
      const turn = conversation.turns[row.turn - 1];
      const expect = turn.expect;
      const q = row.nba.question_intent;
      const asks = ASKING.has(row.action) || (row.action === "CTA_BOOK" && q !== null);

      test(`turn ${row.turn}: expected ${expect.actionIn.join("/")}`, turn.knownGap ? { todo: turn.knownGap } : {}, () => {
        const why = `\n${table}\nreason: ${row.nba.reason}`;
        assert.ok(nextBestActionSchema.safeParse(row.nba).success, "the NBA is contract-valid");
        assert.ok(expect.actionIn.includes(row.action), `action ${row.action}${why}`);
        if (expect.questionDimension !== undefined) {
          assert.equal(asks ? (q?.dimension ?? null) : null, expect.questionDimension, `question${why}`);
        }
        if (expect.questionDimensionIn) {
          assert.ok(q && expect.questionDimensionIn.includes(q.dimension), `question ${q?.dimension}${why}`);
        }
        for (const dim of expect.known ?? []) assert.ok(row.known.includes(dim), `${dim} not known${why}`);
        if (expect.intentStateIn) assert.ok(expect.intentStateIn.includes(row.intent), `intent ${row.intent}${why}`);
        for (const dim of expect.notAsked ?? []) assert.ok(!(asks && q?.dimension === dim), `asked ${dim}${why}`);
      });

      test(`turn ${row.turn}: the eight behaviours`, () => {
        const why = `\n${table}`;
        // B1 never asks what is known (a VERIFY / CLARIFY is not "asking the known").
        if (asks && q && q.purpose === "DISCOVER") {
          const entry = row.dimensions.find((d) => d.dimension === q.dimension);
          const known = entry && (entry.status === "CONFIRMED" || (entry.status === "INFERRED" && !entry.material));
          assert.ok(!known, `B1: asked known ${q.dimension}${why}`);
        }
        // B2 one question at most.
        if (turn.candidate?.qaOk) assert.ok(countQuestions(turn.candidate.text) <= 1, "B2: canned reply asks one question");
        // B3 adapts: what this reply answered is not the question.
        const answered = row.interpretation.facts.filter((f) => f.state === "CONFIRMED").map((f) => f.dimension);
        if (asks && q && q.purpose === "DISCOVER") assert.ok(!answered.includes(q.dimension), `B3: re-asked ${q.dimension}${why}`);
        // B4 no repetition past the sticky re-ask.
        if (asks && q) assert.ok((row.asksSoFar[q.key] ?? 0) < MAX_ASKS_PER_INTENT, `B4: ${q.key} asked ${row.asksSoFar[q.key]}x${why}`);
        // B5 stops at the threshold.
        if (row.thresholdMet) assert.ok(!ASKING.has(row.action) || q?.purpose !== "DISCOVER", `B5: asked past the threshold${why}`);
        // B6 ready leads move to the close. Owner decision 2026-09-27: where
        // the assistant may not close (no direct close), the close is a
        // colleague sending the details while the AI keeps the conversation
        // (INFORM + SEND_ORDER_DETAILS), which replaces the old ESCALATE; a
        // lead under qualification review is helped, not closed.
        if (row.intent === "BOOKING_READY" || row.intent === "PURCHASE_READY") {
          const assistedClose = row.action === "INFORM" && (row.nba.assist_reason === "SEND_ORDER_DETAILS" || row.nba.assist_reason === "QUALIFICATION_REVIEW");
          assert.ok(assistedClose || !["ASK", "INFORM", "NURTURE"].includes(row.action), `B6: ${row.action} when ${row.intent}${why}`);
        }
        // B7 negative / not-now are not pursued.
        if (row.intent === "NEGATIVE" || row.intent === "NOT_NOW") {
          assert.ok(!ASKING.has(row.action) && !(CTA_ACTIONS as readonly string[]).includes(row.action), `B7: ${row.action} on ${row.intent}${why}`);
        }
        // B8 the business's never-ask and forbidden dimensions.
        if (asks && q) {
          assert.ok(!forbidden.has(q.dimension as never), `B8: forbidden ${q.dimension}${why}`);
          assert.ok(!neverAsk.has(q.dimension), `B8: never-ask ${q.dimension}${why}`);
        }
      });

      // B9 never asks what the lead's own messages state (manual inspection
      // §110, MI-2): read every lead message so far with the extractors; a
      // question on a stated dimension is a re-ask, whatever the fact status
      // says. Only a CLARIFY or a VERIFY of a stale fact is exempt.
      test(`turn ${row.turn}: B9 never asks what the lead already said`, () => {
        if (!asks || !q) return;
        const said = conversation.turns.slice(0, row.turn).map((t) => t.lead);
        const stale = row.dimensions.find((d) => d.dimension === q.dimension)?.stale ?? false;
        const violation = restatedAsk(said, { ...q, stale }, conversation.archetype, conversation.serviceNames ?? []);
        assert.equal(violation, null, `B9: asked ${q.key} "${q.rendering}" after the lead said "${violation?.value}"\n${table}`);
      });

      if (conversation.manualBooking && (expect.preferredTimeAsked !== undefined || expect.preferredTime)) {
        test(`turn ${row.turn}: manual booking (story H3)`, () => {
          if (expect.preferredTimeAsked !== undefined) {
            const plan = planFor(row.nba, { manual: true });
            assert.equal(plan.kind === "ASK_PREFERRED_TIME", expect.preferredTimeAsked, `plan ${plan.kind}
${table}`);
            assert.equal((preferredTimeQuestion(null, 1).match(/\?/g) ?? []).length, 1, "one question");
          }
          if (expect.preferredTime) {
            const parsed = parsePreferredTime(turn.lead, { now: new Date(row.at), timezone: "Europe/London", durationMinutes: 60 });
            assert.equal(parsed.kind === "slot" ? "slot" : "ambiguous", expect.preferredTime, JSON.stringify(parsed));
          }
        });
      }

      if (turn.candidate) {
        const candidate = turn.candidate;
        test(`turn ${row.turn}: QA ${candidate.qaOk ? "accepts" : "rejects"} the canned reply`, () => {
          assert.ok(row.qa);
          assert.equal(row.qa.ok, candidate.qaOk, `${JSON.stringify(row.qa.findings)}\n${table}`);
          const codes = row.qa.findings.filter((f) => f.severity === "REJECT").map((f) => f.code);
          for (const code of candidate.codes ?? []) assert.ok(codes.includes(code as never), `${code} not in ${codes.join(", ")}`);
        });
        if (candidate.styleOk !== undefined) {
          test(`turn ${row.turn}: the human-style lint ${candidate.styleOk ? "accepts" : "rejects"} the canned reply`, () => {
            const style = lintStyle(candidate.text, { channel: conversation.channel }).map((f) => f.code);
            assert.equal(style.length === 0, candidate.styleOk, style.join(", "));
            for (const code of candidate.styleCodes ?? []) assert.ok(style.includes(code as never), `${code} not in ${style.join(", ")}`);
          });
        }
      }
    }
  });
}

describe("B8 across archetypes: the same opening is qualified differently", () => {
  test("seven archetypes give at least three different first questions", () => {
    const opening = "Hi, we're looking for some help and would like to know more.";
    const firsts = new Set<string>();
    const archetypes: [string, GoldenConversation["motion"]][] = [
      ["ROOFER", "LOCAL_SERVICE"],
      ["MSP", "BOOK_MEETING_B2B"],
      ["B2B_SAAS", "SAAS_SELF_SERVE"],
      ["ACCOUNTING", "BOOK_MEETING_B2B"],
      ["ECOMMERCE", "ECOMMERCE_DIRECT"],
      ["ENTERPRISE_SAAS", "ENTERPRISE"],
      ["CREATIVE_WEB_STUDIO", "DIRECT_B2B"],
    ];
    for (const [archetype, motion] of archetypes) {
      const [row] = runConversation({ id: archetype, archetype, motion, channel: "email", story: "", turns: [{ lead: opening, expect: { actionIn: [] } }] });
      firsts.add(row.nba.question_intent?.dimension ?? row.action);
    }
    assert.ok(firsts.size >= 3, [...firsts].join(", "));
  });
});

describe("report", () => {
  test("golden summary and model calls avoided by NBA non-message actions", () => {
    let turns = 0;
    let avoided = 0;
    const actions = new Map<string, number>();
    for (const c of conversations) {
      for (const row of results.get(c.id) ?? []) {
        turns += 1;
        actions.set(row.action, (actions.get(row.action) ?? 0) + 1);
        // LIVE plan: silent, escalate or the fixed preferred-time question need no model.
        const plan = planFor(row.nba, { manual: Boolean(c.manualBooking) });
        if (plan.kind !== "COMPOSE" || !NBA_ACTION_NEEDS_MODEL[row.action]) avoided += 1;
      }
    }
    const gaps = conversations.flatMap((c) => c.turns.filter((t) => t.knownGap)).length;
    console.log(
      `[golden] conversations=${conversations.length} turns=${turns} knownGaps=${gaps} actions=${JSON.stringify(Object.fromEntries(actions))} ` +
        `modelCallsAvoided=${avoided}/${turns}${LIVE_MODE ? " (live)" : ""}`,
    );
    for (const c of conversations.slice(0, 3)) console.log(renderTable(c, results.get(c.id)!));
    assert.ok(turns >= 40);
  });
});
