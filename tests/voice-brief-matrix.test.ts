/**
 * Voice brief matrix (voice AI QA, 2026-09-29). Pure: no model, no Retell, no
 * database, no spend.
 *
 * The lesson of 2026-09-28: suites scored 100 while real calls failed,
 * because the real inputs were never read as the model reads them. The live
 * dry run (`node scripts/voice-brief-dry-run.mjs <lead> --matrix`) now builds
 * every route and permission combination from the LIVE workspace and lints
 * each brief (voice/brief-lint.ts). This suite pins the same checks on inputs
 * shaped like that live data (the roofing test workspace, its configured
 * questions, the lead's stale INFORM next-best-action and its "Purchase"
 * goal) and on two ICP workspaces (a web studio with a calendar, a SaaS with
 * a checkout link), for every route x booking x calendar x AI x recording x
 * transfer.
 *
 * Before the fixes, all 12 live briefs (2 leads x 6 routes) failed the lint
 * with 80 findings; after, 0 of 576 live combinations.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildVoiceCallBrief, CALL_BRIEF_MAX_TOKENS, type BriefRoute, type CallBriefInput } from "../src/lib/voice/call-brief.ts";
import { lintCallBrief, type BriefLintFacts } from "../src/lib/voice/brief-lint.ts";
import { renderClosingLine } from "../src/lib/voice/opener.ts";
import { buildQuestionPlan } from "../src/lib/voice/question-plan.ts";
import type { CloseRoute } from "../src/lib/agent/closing.ts";
import type { NextBestAction } from "../src/lib/qualification-intelligence/types.ts";
import {
  callPermissionsFromContext,
  runVoiceTool,
  type PortOutcome,
  type PriorToolResult,
  type ToolCallRow,
  type ToolPermissions,
  type VoiceToolPorts,
  type VoiceToolResponse,
} from "../src/lib/voice/tools/core.ts";
import { DISABLED_AUTHORITY } from "../src/lib/commercial/authority.ts";

const ROUTES: BriefRoute[] = ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION", "RETURN_CALL"];
const NOW = new Date("2026-09-29T10:15:00.000Z");

/** The lead's assessed NBA on the live workspace (lead_assessments, read 2026-09-29): INFORM, R8. */
const LIVE_NBA = {
  next_action: "INFORM",
  current_goal: "C_DIRECT_SALE",
  reason: "The lead is ready to buy but direct close is not permitted: a colleague sends the details and the conversation stays with the assistant.",
  question_intent: null,
  handover_reason: null,
  assist_reason: "SEND_ORDER_DETAILS",
} as unknown as NextBestAction;

type Workspace = {
  name: string;
  base: Omit<CallBriefInput, "route" | "direction" | "permissions" | "booking" | "transfer" | "recordingEnabled">;
};

/** Shaped like the live roofing workspace (7c7f61e4...) and its lead "Michael". */
const ROOFING: Workspace = {
  name: "roofing (live-shaped)",
  base: {
    callingAsName: "Blackwellen",
    personaName: null,
    leadFirstName: "Michael",
    identityAnswer: "I am calling on behalf of Blackwellen Limited. You can reach them at 61 Bridge Street, Kington, Herefordshire, HR5 3DJ.",
    openerSuffix: null,
    motion: "LOCAL_SERVICE",
    goal: "C_DIRECT_SALE",
    nba: LIVE_NBA,
    known: ["Location: BR1 4HZ"],
    offerLines: [
      "10-year workmanship guarantee on full roof replacements",
      "Fully insured (public liability)",
      "Flat roof / GRP: GRP fibreglass and EPDM rubber flat roofs for extensions, garages and dormers.",
      "A free survey and a written, itemised quote, with the same team from survey to sign-off.",
    ],
    neverSay: ["cheapest", "best in London", "guaranteed lowest price"],
    workspaceObjections: null,
    textFollowUpLawful: true,
    conversationSummary: null,
    closingLine: renderClosingLine({ callingAsName: "Blackwellen", whiteLabel: false }).text,
    serviceName: "Flat roof / GRP",
    questionPlan: buildQuestionPlan({
      configured: [
        { id: "d637cb07-ab86-43c8-848b-19485c92faac", questionText: "Are you the homeowner?", required: true, serviceId: null, position: 1 },
        { id: "11abd201-7d75-4159-bbaa-b0622b4c4a6d", questionText: "How soon do you need the work done?", required: true, serviceId: null, position: 2 },
        { id: "7ced18b7-0d0e-4690-bed4-6f5354ea69c5", questionText: "Roughly what budget do you have in mind?", required: false, serviceId: null, position: 3 },
      ],
      leadServiceId: "193cc544-8173-42ae-a83d-9870f8a99d2e",
      serviceName: "Flat roof / GRP",
      knownQuestionIds: [],
      knownDimensions: ["LOCATION"],
      usesServiceAreas: false,
      nbaQuestion: null,
    }),
    usesServiceAreas: false,
    enquirySummary:
      "Flat roof over the kitchen extension (about 18 m2) is old felt that has blistered and now lets water in when it rains heavily. Wants it replaced with GRP or rubber.",
    now: NOW,
    timezone: "Europe/London",
  },
};

const STUDIO: Workspace = {
  name: "web studio",
  base: {
    ...ROOFING.base,
    callingAsName: "Northlight Studio",
    personaName: "Sam",
    leadFirstName: "Priya",
    identityAnswer: "This is Northlight Studio Ltd. You can reach us at 1 High Street, Leeds, LS1 1AA.",
    motion: "BOOK_MEETING_B2B",
    goal: "B_BOOK_MEETING",
    nba: null,
    known: ["Company size: 12 staff"],
    offerLines: ["Webflow and Next.js sites for B2B firms", "Every site ships with a performance budget and a CMS your team can edit"],
    neverSay: [],
    serviceName: "Website rebuild",
    questionPlan: null,
    enquirySummary: "Our site is slow and does not bring in leads. We want a rebuild before the new year.",
    closingLine: renderClosingLine({ callingAsName: "Northlight Studio", whiteLabel: false }).text,
  },
};

const SAAS: Workspace = {
  name: "saas",
  base: {
    ...STUDIO.base,
    callingAsName: "Ledgerly",
    personaName: null,
    motion: "SAAS_SELF_SERVE",
    goal: "D_SIGNUP_TRIAL",
    offerLines: [],
    serviceName: "Ledgerly Team plan",
    enquirySummary: null,
    closingLine: renderClosingLine({ callingAsName: "Ledgerly", whiteLabel: false }).text,
  },
};

type Combo = { book: boolean; calendar: "NONE" | "SLOTS" | "LINK"; ai: boolean; recording: boolean; transfer: boolean };

function combos(): Combo[] {
  const out: Combo[] = [];
  for (const book of [false, true])
    for (const calendar of ["NONE", "SLOTS", "LINK"] as const)
      for (const ai of [true, false])
        for (const recording of [true, false])
          for (const transfer of [false, true]) out.push({ book, calendar, ai, recording, transfer });
  return out;
}

function inputFor(ws: Workspace, route: BriefRoute, c: Combo, extra: { checkout?: boolean; quote?: boolean } = {}): { input: CallBriefInput; facts: BriefLintFacts } {
  // The AI assistant off takes every commercial permission with it (tools/core.ts deriveToolPermissions).
  const booking: CloseRoute = c.calendar === "SLOTS" ? "SLOTS" : c.calendar === "LINK" ? "LINK" : "TEAM_FOLLOW_UP";
  const permissions = {
    book: c.ai && c.book,
    quote: c.ai && Boolean(extra.quote),
    sendQuote: c.ai && Boolean(extra.quote),
    checkout: c.ai && Boolean(extra.checkout),
    bookingLink: c.calendar === "LINK",
  };
  const direction = route === "RETURN_CALL" ? "INBOUND" : "OUTBOUND";
  const input: CallBriefInput = {
    ...ws.base,
    route,
    direction,
    permissions,
    booking,
    transfer: { mode: "ON_REQUEST", available: c.ai && c.transfer },
    recordingEnabled: c.recording,
  };
  const facts: BriefLintFacts = {
    route,
    direction,
    permissions,
    booking,
    recordingEnabled: c.recording,
    transferAvailable: c.ai && c.transfer,
    hasOffer: ws.base.offerLines.length > 0,
    hasEnquiry: Boolean(ws.base.enquirySummary),
  };
  return { input, facts };
}

describe("every route x permission combination reads cleanly (brief lint)", () => {
  for (const [ws, extra] of [
    [ROOFING, {}],
    [STUDIO, { quote: true }],
    [SAAS, { checkout: true }],
  ] as const) {
    test(`${ws.name}: ${ROUTES.length * combos().length} briefs, no finding, inside the budget`, () => {
      const failures: string[] = [];
      for (const route of ROUTES) {
        for (const c of combos()) {
          const { input, facts } = inputFor(ws, route, c, extra);
          const brief = buildVoiceCallBrief(input);
          const findings = lintCallBrief(brief, facts);
          if (findings.length) failures.push(`${route} ${JSON.stringify(c)}: ${findings.map((f) => `${f.code} (${f.detail})`).join("; ")}`);
          assert.ok(brief.tokens - Math.ceil(brief.timePlan.length / 4) <= CALL_BRIEF_MAX_TOKENS, `${route} over budget`);
        }
      }
      assert.deepEqual(failures.slice(0, 5), [], `${failures.length} briefs with findings`);
    });
  }
});

describe("the live dry-run defects, one by one", () => {
  const all: Combo = { book: true, calendar: "NONE", ai: true, recording: false, transfer: false };

  test("a call placed for a close, a check-in or a win-back keeps its purpose over a stale INFORM", () => {
    for (const route of ["BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION", "RETURN_CALL"] as const) {
      const b = buildVoiceCallBrief(inputFor(ROOFING, route, all).input);
      assert.doesNotMatch(b.move, /Share one useful point/, route);
    }
    assert.match(buildVoiceCallBrief(inputFor(ROOFING, "BOOKING_CLOSE", all).input).move, /Close on a meeting/);
    assert.match(buildVoiceCallBrief(inputFor(ROOFING, "NURTURE", all).input).move, /^Check in/);
    assert.match(buildVoiceCallBrief(inputFor(ROOFING, "RETURN_CALL", all).input).move, /^They rang back/);
    // The engine's own stop decisions still bind every route.
    const escalate = { ...LIVE_NBA, next_action: "ESCALATE", handover_reason: "HUMAN_REQUESTED" } as unknown as NextBestAction;
    assert.match(buildVoiceCallBrief({ ...inputFor(ROOFING, "NURTURE", all).input, nba: escalate }).move, /A person should take this lead/);
  });

  test("a booking call names ONE next step (the move), not a second one under CLOSE", () => {
    const b = buildVoiceCallBrief(inputFor(ROOFING, "BOOKING_CLOSE", all).input);
    assert.match(b.text, /^CLOSE\. Take it as YOUR ONE MOVE says\./m);
  });

  test("the plan's close follows the goal the brief names (Direct sale -> a colleague sends the details)", () => {
    const b = buildVoiceCallBrief(inputFor(ROOFING, "QUALIFICATION", all).input);
    assert.match(b.text, /Goal: Direct sale\./);
    assert.match(b.text, /CLOSE\. Only after the QUESTION PLAN: They may be ready to buy: say a colleague will send the details/);
  });

  test("booking allowed with no calendar: 'arrange a meeting time for a colleague to confirm', never 'book meetings'", () => {
    const b = buildVoiceCallBrief(inputFor(ROOFING, "QUALIFICATION", all).input);
    assert.match(b.text, /WHAT YOU MAY DO: arrange a meeting time for a colleague to confirm\./);
    assert.match(b.text, /NO CALENDAR ON THIS CALL/);
  });

  test("the plan count cannot be read as 'one or two questions'", () => {
    const b = buildVoiceCallBrief(inputFor(ROOFING, "QUALIFICATION", all).input);
    assert.match(b.text, /Ask questions 1 to 2 before any close/);
    assert.doesNotMatch(b.text, /Ask 1 to/);
  });

  test("no send time is promised, and a person's call-back is marked by PERSON", () => {
    const b = buildVoiceCallBrief(inputFor(ROOFING, "QUALIFICATION", all).input);
    assert.doesNotMatch(b.text, /details today/);
    assert.match(b.text, /A PERSON\. Live transfer is off\. [^\n]*schedule_callback by PERSON/);
  });

  test("no persona: 'YOU ARE an AI assistant', a persona keeps its name", () => {
    assert.match(buildVoiceCallBrief(inputFor(ROOFING, "QUALIFICATION", all).input).text, /^YOU ARE an AI assistant calling for Blackwellen\./);
    assert.match(buildVoiceCallBrief(inputFor(STUDIO, "QUALIFICATION", all).input).text, /^YOU ARE Sam, an AI assistant calling for Northlight Studio\./);
  });

  test("a return call is inbound: never 'you asked if now is a good time'", () => {
    const b = buildVoiceCallBrief(inputFor(ROOFING, "RETURN_CALL", all).input);
    assert.match(b.text, /FIRST\. They rang you\./);
    assert.doesNotMatch(b.text, /You asked if now is a good time/);
  });

  test("the enquiry on file is confirmed, never asked for, on a meeting goal without a plan", () => {
    const b = buildVoiceCallBrief({ ...inputFor(STUDIO, "QUALIFICATION", all).input, route: "QUALIFICATION", questionPlan: [] });
    assert.doesNotMatch(b.move, /^Ask what prompted/);
  });

  test("nurture and reactivation never close hard", () => {
    for (const route of ["NURTURE", "REACTIVATION"] as const) {
      const b = buildVoiceCallBrief(inputFor(ROOFING, route, all).input);
      assert.match(b.text, /^CLOSE\. No hard close\./m, route);
      assert.doesNotMatch(b.text, /one light trial close|ready to buy/, route);
    }
  });
});

describe("the grader is tested to fail (the lint catches each defect it names)", () => {
  // Lines from the live brief of 2026-09-29 before the fixes (lead 37021976, BOOKING_CLOSE).
  const BEFORE = [
    "YOU ARE the assistant, an AI assistant calling for Blackwellen. This is a booking call. Goal: Direct sale. They enquired about: Flat roof / GRP. Never claim to be human.",
    "FIRST. You asked if now is a good time. If they say no or sound rushed, ask when suits, call schedule_callback, thank them and end: no pitch.",
    "YOUR ONE MOVE NOW: Share one useful point from the approved offer lines and ask if it would help to talk further. No pressure.",
    "QUESTION PLAN. 1. Are you the homeowner? [Q.x] Ask 1 to 2 before any close, next step or closing line.",
    "NO CALENDAR ON THIS CALL. Never offer, suggest or check times or days, never call check_availability or book_meeting.",
    "CLOSE. Close on a meeting: ask which day and time suits them.",
    'SEND ME SOMETHING. If they say "just email me", say yes, say a colleague will send the details today (schedule_callback by a person, noting what to send).',
    "MONEY, TIMES AND AREAS. Say only what a tool returned. WHAT YOU MAY DO: book meetings. You may not price a quote: a colleague does that.",
    "HOW YOU SPEAK. One or two short sentences.",
    'RECORDING. If asked whether the call is recorded, say exactly: "Yes, this call is recorded so we have an accurate note of what we discuss."',
    "A PERSON. Live transfer is off. If they want a person, say a colleague will call them back and call schedule_callback with a time that suits them.",
    'ENDING. Say exactly: "Thanks for your time."',
    "STOP. If they ask not to be called again, call opt_out at once.",
  ].join("\n");

  test("each known defect is named", () => {
    const codes = lintCallBrief(
      { text: BEFORE },
      {
        route: "RETURN_CALL",
        direction: "INBOUND",
        permissions: { book: true, quote: false, sendQuote: false, checkout: false, bookingLink: false },
        booking: "ASK_PREFERRED_TIME",
        recordingEnabled: false,
        transferAvailable: false,
        hasOffer: true,
        hasEnquiry: true,
      },
    ).map((f) => f.code);
    for (const code of [
      "PERSONA_AWKWARD",
      "MAY_BOOK_CONTRADICTION",
      "GOAL_CLOSE_MISMATCH",
      "ROUTE_MOVE_LOST",
      "INBOUND_PERMISSION_LINE",
      "PLAN_COUNT_AMBIGUOUS",
      "UNBACKED_TIMING_PROMISE",
      "RECORDING_WRONG",
      "PERSON_CALLBACK_UNCLEAR",
    ]) {
      assert.ok(codes.includes(code), `${code} not in ${codes.join(", ")}`);
    }
  });

  test("tools the owner did not allow, and times with no calendar, are caught as instructions", () => {
    const text = "YOUR ONE MOVE NOW: call check_availability and offer two times, or send_checkout_link.\nCLOSE. send_booking_link.\nNever claim to be human.\nSTOP.\nMONEY, TIMES AND AREAS.\nENDING.\nHOW YOU SPEAK.";
    const codes = lintCallBrief(
      { text },
      { route: "QUALIFICATION", direction: "OUTBOUND", permissions: { book: false, quote: false, sendQuote: false, checkout: false, bookingLink: false }, booking: "TEAM_FOLLOW_UP", recordingEnabled: true, transferAvailable: false, hasOffer: false, hasEnquiry: false },
    ).map((f) => f.code);
    for (const code of ["TIMES_WITHOUT_CALENDAR", "NO_TIMES_RULE", "CHECKOUT_NOT_PERMITTED", "BOOKING_LINK_NOT_PERMITTED", "NO_PLAN", "NO_CLAIMS_RULE_MISSING"]) {
      assert.ok(codes.includes(code), `${code} not in ${codes.join(", ")}`);
    }
  });
});

/* ---------------------------------------------------------- the tool endpoint */

function toolCall(overrides: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    business_id: "11111111-1111-4111-8111-111111111111",
    lead_id: "22222222-2222-4222-8222-222222222222",
    route: "QUALIFICATION",
    state: "IN_CONVERSATION",
    direction: "OUTBOUND",
    consent_basis: "PHONE_NUMBER_PROVIDED",
    answered_at: new Date(NOW.getTime() - 60_000).toISOString(),
    started_at: new Date(NOW.getTime() - 70_000).toISOString(),
    created_at: new Date(NOW.getTime() - 90_000).toISOString(),
    ...overrides,
  };
}

class Ports implements VoiceToolPorts {
  permissionReads = 0;
  executed: { name: string; args: unknown }[] = [];
  rows = new Map<string, { status: string; response: VoiceToolResponse | null }>();
  p: ToolPermissions;
  constructor(p: ToolPermissions) {
    this.p = p;
  }
  now() {
    return NOW;
  }
  async loadCall() {
    return toolCall();
  }
  async claim({ toolCallId }: { toolCallId: string }) {
    if (this.rows.has(toolCallId)) return { kind: "MISMATCH" as const };
    this.rows.set(toolCallId, { status: "IN_PROGRESS", response: null });
    return { kind: "NEW" as const };
  }
  async complete({ toolCallId, status, response }: { toolCallId: string; status: string; response: VoiceToolResponse }) {
    this.rows.set(toolCallId, { status, response });
  }
  async priorResults(): Promise<PriorToolResult[]> {
    return [];
  }
  async permissions() {
    this.permissionReads += 1;
    return this.p;
  }
  async execute(name: string, _c: ToolCallRow, args: unknown): Promise<PortOutcome> {
    this.executed.push({ name, args });
    return { ok: true, say: name === "schedule_callback" ? "A colleague will call you back at 6pm today." : null, data: {}, operation: `voice.${name}` };
  }
}

const PERMS: ToolPermissions = {
  aiEnabled: true,
  book: false,
  quote: false,
  sendQuote: false,
  checkout: false,
  transferMode: "ON_REQUEST",
  transferNumberSet: false,
  transferHuman: false,
  aiCall: false,
  hasEmail: false,
  smsLawful: true,
};

describe("the tool endpoint (live calls 2026-09-28: 2.4 to 18.8 s refusals; a call-back promised and not recorded)", () => {
  test("silent notes and an opt-out never wait on the permission read", async () => {
    const ports = new Ports(PERMS);
    for (const [name, args] of [
      ["record_fact", { dimension: "TIMING", value: "as soon as possible" }],
      ["log_objection", { key: "PRICE" }],
      ["opt_out", { scope: "CALLS" }],
    ] as const) {
      const r = await runVoiceTool(ports, { name, toolCallId: `tc-${name}`, callId: null, providerCallId: "p", args });
      assert.equal((r.body as VoiceToolResponse).ok, true, name);
    }
    assert.equal(ports.permissionReads, 0);
    // A commercial tool still reads them, and is still refused without the permission.
    const r = await runVoiceTool(ports, { name: "check_availability", toolCallId: "tc-ca", callId: null, providerCallId: "p", args: {} });
    assert.equal((r.body as VoiceToolResponse).ok, false);
    assert.equal(ports.permissionReads, 1);
  });

  test("an AI call-back the lead has not consented to becomes a colleague's call-back, recorded (never a bare promise)", async () => {
    const ports = new Ports(PERMS);
    const r = await runVoiceTool(ports, {
      name: "schedule_callback",
      toolCallId: "tc-cb",
      callId: null,
      providerCallId: "p",
      args: { by: "AI", at_iso: "2026-09-29T17:00:00.000Z", note: "call back at 6pm" },
    });
    const body = r.body as VoiceToolResponse;
    assert.equal(body.ok, true);
    assert.equal(ports.executed.length, 1);
    assert.equal((ports.executed[0].args as { by: string }).by, "PERSON");
  });

  test("a call-back in the past is still refused with a reprompt, whoever makes it", async () => {
    const ports = new Ports(PERMS);
    const r = await runVoiceTool(ports, { name: "schedule_callback", toolCallId: "tc-past", callId: null, providerCallId: "p", args: { by: "AI", at_iso: "2026-09-29T09:00:00.000Z" } });
    assert.equal((r.body as VoiceToolResponse).code, "PAST_TIME");
    assert.equal(ports.executed.length, 0);
  });
});

describe("one permission derivation for the brief and the endpoint", () => {
  const base = {
    aiAssistEnabled: true,
    agentMode: "AUTONOMOUS",
    quoteAiCapability: false,
    authority: DISABLED_AUTHORITY,
    motion: "LOCAL_SERVICE",
    transfer: { mode: "ON_REQUEST" as const, numberSet: false },
    lead: { phone: "+447700900123", email: null, optedOut: false },
    contactable: true,
    bookingUrl: null as string | null,
  };

  test("a booking link reaches the brief (it was dropped by the loader)", () => {
    assert.equal(callPermissionsFromContext({ ...base, bookingUrl: "https://cal.example/book" }).bookingLink, true);
    assert.equal(callPermissionsFromContext(base).bookingLink, false);
  });

  test("an uncontactable lead is not texted, an opted-out lead is neither texted nor emailed", () => {
    assert.equal(callPermissionsFromContext(base).smsLawful, true);
    assert.equal(callPermissionsFromContext({ ...base, contactable: false }).smsLawful, false);
    const out = callPermissionsFromContext({ ...base, lead: { phone: "+447700900123", email: "a@b.co", optedOut: true } });
    assert.equal(out.smsLawful, false);
    assert.equal(out.hasEmail, false);
  });

  test("the AI assistant off (or agent mode OFF) turns the commercial tools off", () => {
    assert.equal(callPermissionsFromContext({ ...base, aiAssistEnabled: false }).aiEnabled, false);
    assert.equal(callPermissionsFromContext({ ...base, agentMode: "OFF" }).aiEnabled, false);
  });
});
