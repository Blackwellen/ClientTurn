import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildNbaStrategyBlock, buildStrategyBlock } from "../src/lib/agent/strategy.ts";
import { strategyQuestion, strategySaysStop } from "./stories/strategy-read.ts";
import { TURN_FIXTURES, question } from "./fixtures/qi-turn-fixtures.ts";

/**
 * The live stories' scripted model reads the question from the strategy
 * block (tests/stories/strategy-read.ts). A layout change once made it read
 * the craft instruction as part of the question, so the scripted reply
 * leaked "Build on their last answer..." to the lead and every later turn
 * handed over (A6, A7, H3). These pin the reading to the real builders.
 */
describe("story harness: reading the planned question from the strategy block", () => {
  test("legacy block: exactly the question, never the options or the craft line", () => {
    const withOptions = { ...question("q1", "What are you looking to achieve with an agency?"), options: [{ label: "Leads", value: "leads" }] };
    for (const q of [question("q1", "What are you looking to achieve with an agency?"), withOptions]) {
      const block = buildStrategyBlock({ ...TURN_FIXTURES[0].legacy, mode: "QUALIFICATION", selection: { question: q as never, stopReason: null, known: [] } });
      assert.match(block.text, /\nHow to ask it: /, "the craft is its own line");
      assert.equal(strategyQuestion(block.text), "What are you looking to achieve with an agency?");
    }
  });

  test("engine block: the planned rendering, verbatim, for every fixture that asks", () => {
    let asked = 0;
    for (const fixture of TURN_FIXTURES) {
      const block = buildNbaStrategyBlock(fixture.legacy, fixture.nba, { booking: "SLOTS" });
      const expected = fixture.nba.question_intent?.rendering ?? null;
      assert.equal(strategyQuestion(block.text), expected, fixture.id);
      if (expected) {
        asked += 1;
        assert.doesNotMatch(strategyQuestion(block.text)!, /How to ask it|tie it to their last answer/);
      }
    }
    assert.ok(asked >= 2, "fixtures cover asking turns");
  });

  test("no question: null; the stop line is still read", () => {
    const stop = buildStrategyBlock({ ...TURN_FIXTURES[0].legacy, mode: "QUALIFICATION", selection: { question: null, stopReason: "THRESHOLD_MET", known: [] } });
    assert.equal(strategyQuestion(stop.text), null);
    assert.equal(strategySaysStop(stop.text), true);
  });
});
