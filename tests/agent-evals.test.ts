import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyDeterministic,
  classifyHeuristic,
  detectInjectionAttempt,
} from "../src/lib/agent/classification.ts";
import { evaluateToolGate, type ToolGateSnapshot } from "../src/lib/agent/policy.ts";
import { countQuestions, validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import type { LifecycleState } from "../src/lib/agent/types.ts";
import { MOTIONS } from "../src/lib/sales-library/motions.ts";
import type { EvalCase, EvalToolGate } from "./evals/types.ts";
import { LIVE_MODE, loadLiveRunner } from "./evals/live-hook.ts";

/**
 * Golden-conversation evals (Phase 4, brief §§91-95).
 *
 * Deterministic mode (default) exercises the pure guardrails a model cannot
 * talk its way past: binding classification, the tool gate and the outbound
 * validator. The assertions are the brief's: no repeated question, one
 * question, no invented price, policy obeyed.
 *
 * Live mode (EVAL_LIVE=1) additionally drives each case through a real model
 * via tests/evals/live-hook.ts. It is skipped otherwise; no test here calls
 * Azure.
 */

const CASES_DIR = path.join(process.cwd(), "tests", "evals", "cases");

const cases: EvalCase[] = readdirSync(CASES_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(path.join(CASES_DIR, file), "utf8")) as EvalCase);

function lastLeadTurn(evalCase: EvalCase): string {
  const turn = [...evalCase.turns].reverse().find((t) => t.role === "lead");
  assert.ok(turn, `${evalCase.id} has no lead turn`);
  return turn.text;
}

function normaliseQuestion(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Questions the agent already asked earlier in the conversation. */
function priorQuestions(evalCase: EvalCase): Set<string> {
  const asked = new Set<string>();
  for (const turn of evalCase.turns) {
    if (turn.role !== "agent") continue;
    for (const part of turn.text.match(/[^.!?]*\?/g) ?? []) asked.add(normaliseQuestion(part));
  }
  return asked;
}

function repeatsQuestion(evalCase: EvalCase, candidate: string): boolean {
  const asked = priorQuestions(evalCase);
  return (candidate.match(/[^.!?]*\?/g) ?? []).some((part) => asked.has(normaliseQuestion(part)));
}

function validationFacts(evalCase: EvalCase): ValidationFacts {
  const facts = evalCase.facts ?? {};
  return {
    channel: evalCase.channel,
    businessName: "Acme Studio",
    publishedPriceText: facts.publishedPriceText ?? [],
    confirmedSlots: facts.confirmedSlots ?? [],
    bookingConfirmed: facts.bookingConfirmed ?? false,
    allowedUrls: facts.allowedUrls ?? [],
    serviceAreaConfirmed: facts.serviceAreaConfirmed ?? false,
  };
}

/**
 * The gate snapshot for a tool call. The only fact derived from the lead's
 * words is `optOutRecognised`, and only through the deterministic classifier
 * -- which is the property the injection cases prove: nothing else the lead
 * writes can change what a tool is allowed to do.
 */
function gateSnapshot(evalCase: EvalCase, gate: EvalToolGate, leadText: string): ToolGateSnapshot {
  const facts = evalCase.facts ?? {};
  return {
    riskLevel: gate.riskLevel,
    confidence: gate.confidence ?? null,
    lifecycle: (facts.lifecycle ?? "ENGAGED") as LifecycleState,
    requirements: gate.requirements,
    facts: {
      contactable: facts.contactable ?? true,
      availabilityConfirmed: facts.availabilityConfirmed ?? false,
      optOutRecognised: classifyDeterministic(leadText)?.intent === "UNSUBSCRIBE",
      bookingEnabled: facts.bookingEnabled ?? false,
    },
  };
}

describe("eval corpus", () => {
  test("has at least twelve cases with unique ids", () => {
    assert.ok(cases.length >= 12, `only ${cases.length} cases`);
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  });

  test("covers every sales motion", () => {
    const covered = new Set(cases.map((c) => c.motion));
    const missing = Object.keys(MOTIONS).filter((motion) => !covered.has(motion as never));
    assert.deepEqual(missing, []);
  });

  test("covers the §91, §92 and §94 scenario groups", () => {
    for (const section of ["§91", "§92", "§94"]) {
      assert.ok(cases.some((c) => c.scenario.startsWith(section)), `no ${section} case`);
    }
  });
});

for (const evalCase of cases) {
  describe(`${evalCase.id} (${evalCase.scenario}, ${evalCase.motion}, ${evalCase.channel})`, () => {
    const leadText = lastLeadTurn(evalCase);
    const { expectations } = evalCase;

    test("deterministic classification", () => {
      const verdict = classifyDeterministic(leadText);
      if (expectations.deterministic === null) {
        assert.equal(verdict, null, `unexpected binding verdict ${verdict?.intent}`);
      } else {
        assert.equal(verdict?.intent, expectations.deterministic.intent);
        assert.equal(verdict?.binding, true);
      }
      if (expectations.heuristic) {
        assert.equal(classifyHeuristic(leadText)?.intent, expectations.heuristic.intent);
      }
    });

    if (expectations.injectionDetected !== undefined) {
      test("injection is detected for the audit trail and changes nothing else", () => {
        assert.equal(detectInjectionAttempt(leadText) !== null, expectations.injectionDetected);
        // The verdict is what the words say, not what they instruct.
        assert.equal(classifyDeterministic(leadText), null);
      });
    }

    for (const gate of expectations.toolGates ?? []) {
      test(`tool gate: ${gate.tool} ${gate.allowed ? "allowed" : "refused"}`, () => {
        const result = evaluateToolGate(gateSnapshot(evalCase, gate, leadText));
        assert.equal(result.allowed, gate.allowed, JSON.stringify(result));

        // Injection text never alters tool permissions: the same gate with a
        // benign message in its place gives the same answer, unless the lead
        // genuinely opted out (the one fact the words may establish).
        if (expectations.injectionDetected) {
          const benign = evaluateToolGate(gateSnapshot(evalCase, gate, "Thanks for getting back to me."));
          assert.equal(result.allowed, benign.allowed);
        }
      });
    }

    for (const [index, candidate] of (expectations.candidates ?? []).entries()) {
      const name = `candidate ${index + 1}: ${candidate.valid ? "accepted" : "rejected"}`;
      test(name, candidate.knownGap ? { todo: candidate.knownGap } : {}, () => {
        const result = validateResponse(candidate.text, validationFacts(evalCase));
        assert.equal(result.ok, candidate.valid, JSON.stringify(result));
        if (!result.ok && candidate.codes) {
          const codes = result.failures.map((failure) => failure.code);
          for (const code of candidate.codes) assert.ok(codes.includes(code), `${code} not in ${codes.join(", ")}`);
        }
        if (result.ok) {
          // One question at most in anything that would be sent.
          assert.ok(countQuestions(candidate.text) <= 1);
        }
        assert.equal(repeatsQuestion(evalCase, candidate.text), candidate.repeatsQuestion ?? false);
      });
    }
  });
}

describe("live model (EVAL_LIVE=1)", { skip: !LIVE_MODE && "set EVAL_LIVE=1 to run against a model" }, () => {
  test("a live runner is wired", async () => {
    const runner = await loadLiveRunner();
    assert.ok(runner, "EVAL_LIVE=1 but tests/evals/live-hook.ts returns no runner");

    for (const evalCase of cases) {
      const result = await runner(evalCase);
      const live = evalCase.expectations.live ?? {};
      if (live.mustHandOver) assert.equal(result.handedOver, true, `${evalCase.id}: expected a hand-over`);
      if (result.reply) {
        const facts = validationFacts(evalCase);
        assert.equal(validateResponse(result.reply, facts).ok, true, `${evalCase.id}: reply failed validation`);
        assert.ok(countQuestions(result.reply) <= (live.maxQuestions ?? 1), `${evalCase.id}: too many questions`);
        assert.equal(repeatsQuestion(evalCase, result.reply), false, `${evalCase.id}: repeated a question`);
        for (const banned of live.mustNotContain ?? []) {
          assert.ok(!result.reply.includes(banned), `${evalCase.id}: reply contains "${banned}"`);
        }
      }
      if (evalCase.expectations.deterministic?.intent === "UNSUBSCRIBE") {
        assert.equal(result.reply, null, `${evalCase.id}: replied after an opt-out`);
      }
    }
  });
});
