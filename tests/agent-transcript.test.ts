import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  clipText,
  CURRENT_MESSAGE_MAX_CHARS,
  renderTranscriptBlocks,
  selectTranscript,
  TRANSCRIPT_MAX_CHARS,
  TRANSCRIPT_MESSAGE_MAX_CHARS,
  TRANSCRIPT_MIN_MESSAGES,
  TRANSCRIPT_UNTRUSTED_NOTICE,
  TRIMMED_MARKER,
  UNBOUNDED_TRANSCRIPT_LIMITS,
  BOUNDED_TRANSCRIPT_LIMITS,
  DEFAULT_TRANSCRIPT_LIMITS,
  type TranscriptTurn,
} from "../src/lib/agent/transcript.ts";
import { UNTRUSTED_CONTENT_NOTICE } from "../src/lib/ai/safety.ts";
import { TRANSCRIPT_FIXTURES } from "./fixtures/transcript-fixtures.ts";

/**
 * The agent turn's conversation blocks (src/lib/agent/transcript.ts): bounded
 * in characters, the current message once, the untrusted notice once. Pure.
 */

const lead = (body: string): TranscriptTurn => ({ role: "lead", body });
const business = (body: string): TranscriptTurn => ({ role: "business", body });

describe("clipText", () => {
  test("leaves short text alone", () => {
    assert.equal(clipText("  hello there  ", 50), "hello there");
  });

  test("cuts at a word boundary, marks the cut, never exceeds the limit", () => {
    const text = "word ".repeat(200);
    const clipped = clipText(text, 100);
    assert.ok(clipped.length <= 100, String(clipped.length));
    assert.ok(clipped.endsWith(TRIMMED_MARKER));
    assert.ok(!clipped.includes("wor [...]"), clipped);
  });

  test("an unbroken string is cut hard rather than to nothing", () => {
    const clipped = clipText("x".repeat(1_000), 100);
    assert.equal(clipped.length, 100);
  });
});

describe("selectTranscript", () => {
  test("drops the current message from the window: it is rendered once, under CURRENT MESSAGE", () => {
    const recent = [business("Hi, when would you like it live?"), lead("By January  please")];
    const turns = selectTranscript(recent, "By January please");
    assert.deepEqual(turns, [business("Hi, when would you like it live?")]);
  });

  test("keeps a last lead message that is not the current one", () => {
    const recent = [business("Question?"), lead("An earlier answer")];
    assert.equal(selectTranscript(recent, "Something new").length, 2);
    assert.equal(selectTranscript(recent, null).length, 2);
  });

  test("never drops a business message as the duplicate", () => {
    const recent = [lead("hi"), business("Same text")];
    assert.equal(selectTranscript(recent, "Same text").length, 2);
  });

  test("the live default is lossless: every loaded message goes whole (owner rule)", () => {
    const recent = Array.from({ length: 8 }, (_, i) => lead(`message ${i} ` + "long text ".repeat(100)));
    const turns = selectTranscript(recent, null, DEFAULT_TRANSCRIPT_LIMITS);
    assert.deepEqual(turns, recent.map((turn) => ({ ...turn, body: turn.body.trim() })));
    assert.equal(DEFAULT_TRANSCRIPT_LIMITS.messageMaxChars, Number.POSITIVE_INFINITY);
    assert.equal(DEFAULT_TRANSCRIPT_LIMITS.totalMaxChars, Number.POSITIVE_INFINITY);
    assert.equal(DEFAULT_TRANSCRIPT_LIMITS.currentMaxChars, Number.POSITIVE_INFINITY);
  });

  test("bounded mode (measured only) caps each message and the total, dropping the oldest first", () => {
    const recent = Array.from({ length: 8 }, (_, i) => lead(`message ${i} ` + "long text ".repeat(100)));
    const turns = selectTranscript(recent, null, BOUNDED_TRANSCRIPT_LIMITS);
    for (const turn of turns) assert.ok(turn.body.length <= TRANSCRIPT_MESSAGE_MAX_CHARS);
    const total = turns.reduce((sum, turn) => sum + turn.body.length, 0);
    assert.ok(total <= TRANSCRIPT_MAX_CHARS, String(total));
    assert.ok(turns.length < 8);
    // The newest is kept, in order.
    assert.ok(turns[turns.length - 1].body.startsWith("message 7 "));
    assert.ok(turns[0].body.startsWith(`message ${8 - turns.length} `));
  });

  test("always keeps the newest messages even past the total", () => {
    const recent = [lead("a".repeat(5_000)), lead("b".repeat(5_000)), lead("c".repeat(5_000))];
    const turns = selectTranscript(recent, null, {
      messageMaxChars: 5_000,
      totalMaxChars: 100,
      minMessages: TRANSCRIPT_MIN_MESSAGES,
      currentMaxChars: CURRENT_MESSAGE_MAX_CHARS,
      dedupeCurrent: true,
    });
    assert.equal(turns.length, TRANSCRIPT_MIN_MESSAGES);
    assert.ok(turns[1].body.startsWith("c"));
  });

  test("a short SMS thread is unchanged apart from the duplicate", () => {
    const sms = TRANSCRIPT_FIXTURES[0];
    const turns = selectTranscript(sms.recent, sms.latestMessage);
    assert.deepEqual(turns, sms.recent.slice(0, -1));
  });
});

describe("renderTranscriptBlocks", () => {
  test("states the untrusted notice once, fences every lead message, and wraps the current message in full", () => {
    const recent = [lead("first"), business("reply"), lead("second"), lead("now")];
    const blocks = renderTranscriptBlocks(recent, "now");
    assert.equal(blocks.length, 2);
    const [transcript, current] = blocks;
    assert.ok(transcript.startsWith(`RECENT CONVERSATION\n${TRANSCRIPT_UNTRUSTED_NOTICE}`));
    assert.equal(transcript.split(UNTRUSTED_CONTENT_NOTICE).length - 1, 1);
    assert.ok(transcript.includes("Lead:\n---\nfirst\n---"));
    assert.ok(transcript.includes("Lead:\n---\nsecond\n---"));
    assert.ok(transcript.includes("Business: reply"));
    assert.ok(!transcript.includes("now"));
    assert.ok(current.startsWith(`CURRENT MESSAGE FROM THE LEAD\n${UNTRUSTED_CONTENT_NOTICE}`));
    assert.ok(current.includes("\n---\nnow\n---"));
  });

  test("no lead text in the transcript means no notice there", () => {
    const [transcript] = renderTranscriptBlocks([business("Hello Sam")], null);
    assert.equal(transcript, "RECENT CONVERSATION\nBusiness: Hello Sam");
  });

  test("an empty window says so", () => {
    const blocks = renderTranscriptBlocks([lead("hi")], "hi");
    assert.equal(blocks[0], "RECENT CONVERSATION\nNo prior messages.");
  });

  test("the live default never cuts the current message", () => {
    const long = "Please call me back. " + "detail ".repeat(1_000);
    const [, current] = renderTranscriptBlocks([], long);
    assert.ok(current.includes(long.trim()));
  });

  test("bounded mode (measured only) cuts an oversized current message, the head kept", () => {
    const long = "Please call me back. " + "detail ".repeat(1_000);
    const [, current] = renderTranscriptBlocks([], long, BOUNDED_TRANSCRIPT_LIMITS);
    assert.ok(current.includes("Please call me back."));
    assert.ok(current.length < CURRENT_MESSAGE_MAX_CHARS + UNTRUSTED_CONTENT_NOTICE.length + 100);
  });

  test("the unbounded mode reproduces the old shape (notice before every lead message)", () => {
    const recent = [lead("first"), lead("now")];
    const [transcript] = renderTranscriptBlocks(recent, "now", UNBOUNDED_TRANSCRIPT_LIMITS, true);
    assert.equal(transcript.split(UNTRUSTED_CONTENT_NOTICE).length - 1, 2);
  });

  test("the fixtures shrink", () => {
    for (const f of TRANSCRIPT_FIXTURES) {
      const before = renderTranscriptBlocks(f.recent, f.latestMessage, UNBOUNDED_TRANSCRIPT_LIMITS, true).join("\n\n");
      const after = renderTranscriptBlocks(f.recent, f.latestMessage).join("\n\n");
      assert.ok(after.length < before.length, `${f.id}: ${before.length} -> ${after.length}`);
    }
  });
});
