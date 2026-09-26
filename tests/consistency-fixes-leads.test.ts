import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HANDOVER_COPY,
  handBackUnavailableReason,
  resumeFollowUpBlock,
} from "../src/lib/leads/resume-rule.ts";
import { leadActionAvailability, type LeadActionState } from "../src/lib/leads/detail-page.ts";
import {
  CONVERSATION_INTERESTS,
  deterministicReplyClassification,
  interestForReplyClassification,
} from "../src/lib/inbox/interest.ts";
import { MESSAGE_REPLY_CLASSIFICATIONS } from "../src/lib/agent/types.ts";
import { INTERESTED_CLASSIFICATIONS } from "../src/lib/inbox/types.ts";
import {
  QUALIFICATION_OUTCOME_LABEL,
  qualificationOutcomeLabel,
} from "../src/lib/qualification/outcome-labels.ts";
import { QUALIFICATION_STAT_META } from "../src/lib/qualification/draft.ts";
import { PREVIEW_RESULT_COPY } from "../src/lib/qualification/preview.ts";
import {
  AUTOMATION_TYPES,
  isWiredAutomationType,
} from "../src/lib/automations/types.ts";
import {
  CLOSE_REASON_CATEGORIES,
  CLOSE_REASON_CATEGORIES_FOR,
  composeCloseReason,
  parseCloseReason,
} from "../src/lib/leads/close-reasons.ts";
import { closeReasonProblem } from "../src/lib/leads/detail-page.ts";

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/* ------------------------------------------------ C. one resume rule */

describe("C. hand back (resume follow-up) has one rule", () => {
  const base = { status: "RESPONDED", optedOut: false, archived: false };

  test("the operation's blocks, in priority order", () => {
    assert.equal(resumeFollowUpBlock(base), null);
    assert.equal(resumeFollowUpBlock({ ...base, optedOut: true, status: "WON" })?.code, "opted_out");
    assert.equal(resumeFollowUpBlock({ ...base, optedOut: true })?.serviceCode, "POLICY_BLOCKED");
    assert.equal(resumeFollowUpBlock({ ...base, archived: true })?.code, "archived");
    assert.equal(resumeFollowUpBlock({ ...base, status: "LOST" })?.code, "closed");
    assert.equal(resumeFollowUpBlock({ ...base, status: "BOOKED" })?.code, "booked");
    assert.equal(resumeFollowUpBlock({ ...base, status: "BOOKED" })?.serviceCode, "CONFLICT");
  });

  test("the UI adds only 'nothing to hand back'", () => {
    assert.equal(handBackUnavailableReason({ ...base, humanTakeover: true }), null);
    assert.match(handBackUnavailableReason({ ...base, humanTakeover: false }) ?? "", /already running/);
    assert.equal(
      handBackUnavailableReason({ ...base, status: "BOOKED", humanTakeover: true }),
      resumeFollowUpBlock({ ...base, status: "BOOKED" })?.message,
    );
  });

  test("the lead page now refuses a booked lead, like the drawer", () => {
    const state: LeadActionState = {
      status: "BOOKED",
      archived: false,
      anonymised: false,
      optedOut: false,
      humanTakeover: true,
      opportunityOutcome: "OPEN",
    };
    const availability = leadActionAvailability("owner", state);
    assert.equal(availability.resume.allowed, false);
    assert.match(availability.resume.reason ?? "", /booked/i);
  });

  test("operation, page and drawer all import the shared predicate", () => {
    assert.match(src("src/lib/services/operations/leads.ts"), /resumeFollowUpBlock\(/);
    assert.match(src("src/lib/leads/detail-page.ts"), /handBackUnavailableReason\(/);
    const drawer = src("src/components/leads/lead-manual-actions.tsx");
    assert.match(drawer, /handBackUnavailableReason\(/);
    assert.doesNotMatch(drawer, /follow-up has already done its job/);
  });
});

/* ------------------------------------------- D. interest for every channel */

describe("D. reply classification -> conversation interest", () => {
  test("every canonical classification maps to a legal interest or null", () => {
    for (const classification of MESSAGE_REPLY_CLASSIFICATIONS) {
      const interest = interestForReplyClassification(classification);
      assert.ok(
        interest === null || (CONVERSATION_INTERESTS as readonly string[]).includes(interest),
        `${classification} -> ${interest}`,
      );
    }
  });

  test("positive replies land in the Interested view", () => {
    const interested = INTERESTED_CLASSIFICATIONS as readonly string[];
    for (const c of ["POSITIVE_INTEREST", "BOOKING_INTENT", "NEUTRAL_QUESTION", "HUMAN_REQUEST"]) {
      assert.ok(interested.includes(interestForReplyClassification(c) ?? ""), c);
    }
    for (const c of ["NOT_INTERESTED", "UNSUBSCRIBE", "WRONG_PERSON", "NOT_NOW", "UNKNOWN"]) {
      assert.ok(!interested.includes(interestForReplyClassification(c) ?? ""), c);
    }
  });

  test("a bounce or auto-reply leaves the thread's verdict alone", () => {
    assert.equal(interestForReplyClassification("BOUNCE"), null);
    assert.equal(interestForReplyClassification("AUTO_RESPONSE"), null);
    assert.equal(interestForReplyClassification(null), null);
    assert.equal(interestForReplyClassification("NOT_A_CLASS"), null);
  });

  test("the deterministic classifier always yields a canonical value", () => {
    for (const body of ["Yes please, can we book a call?", "not interested thanks", "", "asdf"]) {
      assert.ok(
        (MESSAGE_REPLY_CLASSIFICATIONS as readonly string[]).includes(deterministicReplyClassification(body)),
      );
    }
  });

  test("SMS/WhatsApp/email inbound and the agent tool write interest", () => {
    assert.match(src("src/lib/jobs/handlers/message-inbound.ts"), /recordReplyInterest\(/);
    assert.match(src("src/lib/agent/tools.ts"), /interestForReplyClassification\(stored\)/);
  });
});

/* ------------------------------------------------- E. outcome labels */

describe("E. qualification outcomes have one set of words", () => {
  test("the canonical labels", () => {
    assert.deepEqual(QUALIFICATION_OUTCOME_LABEL, {
      QUALIFIED: "Qualified",
      NOT_QUALIFIED: "Not qualified",
      REVIEW: "Needs review",
      PENDING: "Pending",
    });
    assert.equal(qualificationOutcomeLabel("SOMETHING"), "Pending");
  });

  test("the Follow-Up stats and preview use them", () => {
    for (const key of ["QUALIFIED", "NOT_QUALIFIED", "REVIEW", "PENDING"] as const) {
      assert.equal(QUALIFICATION_STAT_META[key].label, QUALIFICATION_OUTCOME_LABEL[key]);
      assert.equal(PREVIEW_RESULT_COPY[key].label, `Result: ${QUALIFICATION_OUTCOME_LABEL[key]}`);
    }
  });

  test("the lead badge mapping reads them, and the old words are gone", () => {
    const badge = src("src/components/ui/badge.tsx");
    assert.match(badge, /QUALIFICATION_OUTCOME_LABEL\.QUALIFIED/);
    assert.doesNotMatch(badge, /Meets criteria|Does not meet/);
  });
});

/* ------------------------------------------------- F. action labels */

describe("F. take over / hand back / publish are named once", () => {
  test("the words", () => {
    assert.equal(HANDOVER_COPY.takeOver, "Take over");
    assert.equal(HANDOVER_COPY.handBack, "Hand back");
  });

  test("no surface uses the old names", () => {
    for (const file of [
      "src/components/leads/lead-manual-actions.tsx",
      "src/components/leads/detail/lead-page-actions.tsx",
      "src/components/leads/lead-row-actions.tsx",
      "src/components/inbox/agent-panel.tsx",
    ]) {
      const text = src(file);
      assert.doesNotMatch(text, /Human takeover|Take over conversation|Hand back to assistant|"Resume follow-up"/, file);
      assert.match(text, /HANDOVER_COPY\./, file);
    }
  });

  test("both editors publish with 'Publish changes'", () => {
    assert.match(src("src/components/follow-up/follow-up-workspace.tsx"), /Publish changes/);
    assert.match(src("src/components/qualification/qualification-editor.tsx"), /Publish changes/);
    assert.doesNotMatch(src("src/components/follow-up/follow-up-workspace.tsx"), /Update sequence/);
    assert.doesNotMatch(src("src/components/qualification/qualification-editor.tsx"), />\s*Publish qualification/);
  });
});

/* ---------------------------------------------- G. unwired sequence type */

describe("G. the unresponsive sequence is hidden until something enrols into it", () => {
  test("only unresponsive is unwired", () => {
    assert.deepEqual(AUTOMATION_TYPES.filter((t) => !isWiredAutomationType(t)), ["unresponsive"]);
  });

  test("the Follow-Up view and createAutomation respect it", () => {
    assert.match(src("src/components/follow-up/follow-up-view.tsx"), /isWiredAutomationType\(item\.type\)/);
    assert.match(src("src/lib/automations/actions.ts"), /isWiredAutomationType\(parsed\.data\.type\)/);
  });
});

/* ------------------------------------------------ H / I. editor tidy */

describe("H/I. qualification editor", () => {
  test("no drag grip on a row that cannot be dragged", () => {
    assert.doesNotMatch(src("src/components/qualification/question-row.tsx"), /GripVertical/);
  });

  test("the unused contradictory copy constants are gone", () => {
    const types = src("src/lib/qualification/types.ts");
    for (const name of ["REVIEW_NOTE", "ORDER_NOTE", "SERVICE_AREA_NOTE", "QUALIFICATION_TABS"]) {
      assert.doesNotMatch(types, new RegExp(`export const ${name}\\b`), name);
    }
  });
});

/* ------------------------------------------------- J. reason categories */

describe("J. won/lost reason categories", () => {
  test("categories per outcome come from the one list", () => {
    for (const outcome of ["WON", "LOST"] as const) {
      for (const c of CLOSE_REASON_CATEGORIES_FOR[outcome]) {
        assert.ok((CLOSE_REASON_CATEGORIES as readonly string[]).includes(c));
      }
    }
    assert.ok(CLOSE_REASON_CATEGORIES_FOR.WON.includes("Chose us — fit"));
    assert.ok(!CLOSE_REASON_CATEGORIES_FOR.WON.includes("No response"));
  });

  test("a category is stored as a leading tag and round-trips", () => {
    const stored = composeCloseReason("Price", "  chose a cheaper supplier ");
    assert.equal(stored, "[Price] chose a cheaper supplier");
    assert.deepEqual(parseCloseReason(stored), { category: "Price", text: "chose a cheaper supplier" });
    assert.equal(composeCloseReason(null, " plain "), "plain");
    assert.deepEqual(parseCloseReason("plain"), { category: null, text: "plain" });
  });

  test("a typed tag is replaced, never doubled", () => {
    assert.equal(composeCloseReason("Timing", "[Price] next quarter"), "[Timing] next quarter");
  });

  test("an unknown tag is kept as text", () => {
    assert.deepEqual(parseCloseReason("[Foo] bar"), { category: null, text: "[Foo] bar" });
  });

  test("the reason stays required: a chip alone does not satisfy it", () => {
    assert.ok(closeReasonProblem(""));
    assert.equal(closeReasonProblem(composeCloseReason("Other", "ok then")), null);
  });
});
