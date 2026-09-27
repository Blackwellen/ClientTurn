import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  CONTEXT_SIGNAL_TYPES,
  SIGNAL_TYPE_CATEGORY,
  SIGNAL_TYPES,
  signalPolarity,
} from "../src/lib/qualification-intelligence/types.ts";
import { CONTEXT_BY_INTENT_TYPE, contextSignalTypeFor } from "../src/lib/qualification-intelligence/signals.ts";
import { DECAY_RULES } from "../src/lib/qualification-intelligence/decay.ts";
import { isIntentTypeId } from "../src/lib/find-leads/intent-catalogue.ts";

/**
 * The find-leads intent types that carry into lead context (2026-09-27):
 * each is a CONTEXT signal type, and each catalogue type that evidences one
 * maps to it before the event's wording is read.
 */
const NEW_TYPES = [
  "EXPANSION",
  "LEADERSHIP_HIRE",
  "KEY_DEPARTURE",
  "ACQUISITION",
  "REBRAND",
  "WEBSITE_RELAUNCH",
  "PRODUCT_LAUNCH",
  "AWARD",
  "PARTNERSHIP",
  "FILING_DEADLINE",
  "ACCOUNTS_GROWTH",
  "CONTRACT_RENEWAL",
] as const;

describe("find-leads intent types in lead context", () => {
  test("every new type is a positive CONTEXT signal type with a CONTEXT decay rule", () => {
    for (const type of NEW_TYPES) {
      assert.ok((CONTEXT_SIGNAL_TYPES as readonly string[]).includes(type), type);
      assert.ok((SIGNAL_TYPES as readonly string[]).includes(type), type);
      assert.equal(SIGNAL_TYPE_CATEGORY[type], "CONTEXT", type);
      assert.equal(signalPolarity(type), "POSITIVE", type);
      assert.deepEqual(DECAY_RULES[type], DECAY_RULES.FUNDING, type);
    }
  });

  test("the map uses real catalogue types and reaches every new context type", () => {
    for (const [intentType, signal] of Object.entries(CONTEXT_BY_INTENT_TYPE)) {
      assert.ok(isIntentTypeId(intentType), `${intentType} is not in find-leads/intent-catalogue.ts`);
      assert.ok((CONTEXT_SIGNAL_TYPES as readonly string[]).includes(signal), `${intentType} -> ${signal}`);
    }
    const reached = new Set(Object.values(CONTEXT_BY_INTENT_TYPE));
    for (const type of NEW_TYPES) assert.ok(reached.has(type), `${type} is never mapped`);
  });

  test("the catalogue type wins over the wording; permitted sources only", () => {
    const event = { sourceKey: "COMPANY_WEBSITE", categoryName: "Growth", evidenceSummary: "We are hiring and have opened a new office" };
    assert.equal(contextSignalTypeFor({ ...event, intentType: "NEW_OFFICE" }), "EXPANSION");
    assert.equal(contextSignalTypeFor({ ...event, intentType: "REGULATORY_DEADLINE" }), "FILING_DEADLINE");
    assert.equal(contextSignalTypeFor({ ...event, intentType: "CONTRACT_RENEWAL_WINDOW" }), "CONTRACT_RENEWAL");
    assert.equal(contextSignalTypeFor({ ...event, intentType: null }), "HIRING", "no type: the wording decides, as before");
    assert.equal(contextSignalTypeFor({ ...event, sourceKey: "BOUGHT_LIST", intentType: "NEW_OFFICE" }), null);
  });
});
