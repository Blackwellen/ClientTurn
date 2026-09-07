import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RESEARCH_COOLDOWN_HOURS,
  RESEARCH_DAILY_WORKSPACE_LIMIT,
  keepCitedClaims,
} from "../src/lib/find-leads/research-policy.ts";

/**
 * The research refresh and the AI summary.
 *
 * Both spend something — provider budget in one case, AI tokens in the other —
 * and both make claims a customer will act on. These tests pin the two
 * properties that matter: spending is bounded, and the model cannot assert
 * anything the stored evidence does not support.
 */

/* --------------------------------------------------------------- the bounds */

test("a refresh is bounded per prospect and per workspace", () => {
  // A refresh button with no cooldown is a way to spend a month of budget in an
  // afternoon; a cooldown with no workspace cap just moves that across records.
  assert.ok(RESEARCH_COOLDOWN_HOURS >= 1, "there must be a per-prospect cooldown");
  assert.ok(
    RESEARCH_DAILY_WORKSPACE_LIMIT > 0 && RESEARCH_DAILY_WORKSPACE_LIMIT <= 500,
    "there must be a workspace daily cap, and it must be a real limit",
  );
});

/* ------------------------------------------------------ the citation guard */

test("a claim citing evidence that was never supplied is discarded", () => {
  const kept = keepCitedClaims(
    [
      { text: "Grounded.", evidence_ids: ["E1"] },
      { text: "Invented.", evidence_ids: ["E9"] },
      { text: "Partly grounded.", evidence_ids: ["E9", "E2"] },
    ],
    ["E1", "E2", "E3"],
  );

  assert.deepEqual(
    kept.map((entry) => entry.claim.text),
    ["Grounded.", "Partly grounded."],
  );

  // The invented reference is stripped from the surviving claim rather than
  // carried along beside the real one.
  assert.deepEqual(kept[1].citedRefs, ["E2"]);
});

test("a fabricated citation is dropped rather than repaired", () => {
  // Silently re-pointing a bad citation at some other evidence would launder
  // the fabrication into something that looks sourced.
  const kept = keepCitedClaims(
    [{ text: "They have a £2m roofing budget.", evidence_ids: ["E42"] }],
    ["E1", "E2"],
  );
  assert.deepEqual(kept, []);
});

test("citation matching is case and whitespace tolerant, not value tolerant", () => {
  const kept = keepCitedClaims([{ text: "Fine.", evidence_ids: [" e1 "] }], ["E1"]);
  assert.equal(kept.length, 1, "formatting differences must not lose a real citation");

  const dropped = keepCitedClaims([{ text: "Not fine.", evidence_ids: ["E10"] }], ["E1"]);
  assert.equal(dropped.length, 0, "E10 is not E1");
});

test("a claim with no text is dropped even when its citation is real", () => {
  // An empty sentence attributed to real evidence is not a finding.
  assert.deepEqual(
    keepCitedClaims([{ text: "   ", evidence_ids: ["E1"] }], ["E1"]),
    [],
  );
});

test("duplicate citations collapse, so a claim cannot look better sourced than it is", () => {
  const [entry] = keepCitedClaims(
    [{ text: "Cited twice.", evidence_ids: ["E1", "e1", " E1 "] }],
    ["E1"],
  );
  assert.deepEqual(entry.citedRefs, ["E1"]);
});
