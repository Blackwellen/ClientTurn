import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addContactSchema,
  addDays,
  canSnooze,
  channelMoves,
  CONNECTION_NOTE_MAX_CHARS,
  DEFAULT_LINKEDIN_ASSIST_SETTINGS,
  INMAIL_CREDIT_CEILING,
  LINKEDIN_ASSIST_LIMITS,
  linkedInAssistSettingsSchema,
  linkedInThreadKey,
  localDate,
  logReplySchema,
  normaliseLinkedInProfileUrl,
  onMarkSent,
  onSkip,
  paceToday,
  settingsFromRow,
  stopReasonFor,
  usageFrom,
  type LinkedInAssistSettings,
  type PaceableTask,
} from "../src/lib/linkedin-assist/types.ts";
import {
  composeDraft,
  copyKindFor,
  draftFacts,
  templateDraft,
  type DraftBusiness,
  type DraftSubject,
  type Generate,
} from "../src/lib/linkedin-assist/compose.ts";
import { serviceOperation, ALL_OPERATIONS } from "../src/lib/services/registry.ts";
import { declarationProblems } from "../src/lib/services/types.ts";
import { evaluateSendGate } from "../src/lib/agent/policy.ts";
import { optOutDestination } from "../src/lib/messaging/types.ts";
import {
  grantedPermissions,
  metaChannelCapability,
  metaSendPermitted,
} from "../src/lib/social/meta-capability.ts";

/**
 * LinkedIn Assist (owner decision 2026-09-28: the AI drafts, a person sends)
 * and the Messenger / Instagram fixes found in the same audit. Fakes only: the
 * model is an injected function, no provider or AI call is ever made.
 */

const SETTINGS: LinkedInAssistSettings = { ...DEFAULT_LINKEDIN_ASSIST_SETTINGS };
const NO_USAGE = { connectionsToday: 0, connectionsThisWeek: 0, messagesToday: 0, notesThisMonth: 0, inmailsThisMonth: 0 };

function tasks(kind: PaceableTask["kind"], n: number, prefix = kind): PaceableTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    kind,
    dueOn: "2026-09-28",
    createdAt: `2026-09-28T09:${String(i).padStart(2, "0")}:00Z`,
  }));
}

/* ================================================================ URLs */

describe("profile URLs", () => {
  test("normalises the common spellings to one form", () => {
    const expected = "https://www.linkedin.com/in/jane-doe-123/";
    for (const input of [
      "https://www.linkedin.com/in/jane-doe-123",
      "linkedin.com/in/jane-doe-123/",
      "http://uk.linkedin.com/in/Jane-Doe-123?trk=abc",
      "  https://linkedin.com/in/jane-doe-123/#about ",
    ]) {
      assert.equal(normaliseLinkedInProfileUrl(input), expected, input);
    }
  });

  test("refuses anything that is not a person's profile", () => {
    for (const input of [
      "",
      "https://www.linkedin.com/company/acme/",
      "https://www.linkedin.com/sales/lead/ACwAA",
      "https://evil.example/in/jane",
      "https://linkedin.com.evil.example/in/jane",
      "javascript:alert(1)",
      "https://www.linkedin.com/in/",
    ]) {
      assert.equal(normaliseLinkedInProfileUrl(input), null, input);
    }
  });

  test("the stored form satisfies the migration's CHECK", () => {
    const url = normaliseLinkedInProfileUrl("linkedin.com/in/o'brien-ü")!;
    assert.match(url, /^https:\/\/www\.linkedin\.com\/in\/[^/?#\s]{1,100}\/$/);
    assert.equal(linkedInThreadKey(url).startsWith("profile:"), true);
  });

  test("the add form needs one subject and a real profile link", () => {
    const lead = "11111111-1111-4111-8111-111111111111";
    assert.equal(addContactSchema.safeParse({ leadId: lead, profileUrl: "linkedin.com/in/x" }).success, true);
    assert.equal(addContactSchema.safeParse({ profileUrl: "linkedin.com/in/x" }).success, false);
    assert.equal(
      addContactSchema.safeParse({ leadId: lead, prospectId: lead, profileUrl: "linkedin.com/in/x" }).success,
      false,
    );
    assert.equal(addContactSchema.safeParse({ leadId: lead, profileUrl: "example.com" }).success, false);
    assert.equal(logReplySchema.safeParse({ taskId: lead, body: "   " }).success, false);
  });
});

/* ================================================================ pacing */

describe("account-safe pacing", () => {
  test("defaults are well under LinkedIn's limits and are also the ceilings", () => {
    assert.equal(LINKEDIN_ASSIST_LIMITS.dailyConnectionNotes, 15);
    assert.equal(LINKEDIN_ASSIST_LIMITS.dailyMessages, 30);
    assert.ok(LINKEDIN_ASSIST_LIMITS.weeklyConnectionRequests < 100);
    const higher = linkedInAssistSettingsSchema.safeParse({ ...SETTINGS, dailyConnectionNotes: 16 });
    assert.equal(higher.success, false);
    const lower = linkedInAssistSettingsSchema.safeParse({ ...SETTINGS, dailyConnectionNotes: 5, dailyMessages: 10 });
    assert.equal(lower.success, true);
    assert.equal(linkedInAssistSettingsSchema.safeParse({ ...SETTINGS, dailyMessages: 31 }).success, false);
  });

  test("InMail credits are capped by the plan, and a free account has none", () => {
    assert.equal(linkedInAssistSettingsSchema.safeParse({ ...SETTINGS, monthlyInMailCredits: 1 }).success, false);
    assert.equal(
      linkedInAssistSettingsSchema.safeParse({ ...SETTINGS, accountTier: "PREMIUM", monthlyInMailCredits: 15 }).success,
      true,
    );
    assert.equal(
      linkedInAssistSettingsSchema.safeParse({ ...SETTINGS, accountTier: "PREMIUM", monthlyInMailCredits: 16 }).success,
      false,
    );
  });

  test("a stored row out of range is read on the safe side", () => {
    const read = settingsFromRow({
      account_tier: "RECRUITER",
      daily_connection_notes: 500,
      daily_messages: -3,
      monthly_inmail_credits: 40,
      follow_up_after_days: 1,
      max_follow_ups: 9,
    });
    assert.equal(read.accountTier, "FREE");
    assert.equal(read.dailyConnectionNotes, 15);
    assert.equal(read.dailyMessages, 0);
    assert.equal(read.monthlyInMailCredits, 0);
    assert.equal(read.followUpAfterDays, 3);
    assert.equal(read.maxFollowUps, 2);
  });

  test("today's list holds anything over the daily caps", () => {
    const result = paceToday([...tasks("CONNECTION_NOTE", 20), ...tasks("FOLLOW_UP", 40)], NO_USAGE, SETTINGS);
    assert.equal(result.visible.filter((t) => t.kind === "CONNECTION_NOTE").length, 15);
    assert.equal(result.visible.filter((t) => t.kind === "FOLLOW_UP").length, 30);
    assert.deepEqual(result.held, { connections: 5, messages: 10, inmails: 0 });
  });

  test("what was already sent today counts, and the weekly cap binds too", () => {
    const result = paceToday(tasks("CONNECTION_NOTE", 10), { ...NO_USAGE, connectionsToday: 12 }, SETTINGS);
    assert.equal(result.visible.length, 3);
    const weekly = paceToday(tasks("CONNECTION_NOTE", 10), { ...NO_USAGE, connectionsThisWeek: 78 }, SETTINGS);
    assert.equal(weekly.visible.length, 2);
  });

  test("replies come first and are never held, even when paused or over the cap", () => {
    const result = paceToday(
      [...tasks("FOLLOW_UP", 3), ...tasks("REPLY", 4)],
      { ...NO_USAGE, messagesToday: 30 },
      { ...SETTINGS, paused: true },
    );
    assert.equal(result.visible.length, 4);
    assert.ok(result.visible.every((t) => t.kind === "REPLY"));
    assert.equal(result.held.messages, 3);
  });

  test("InMail needs both a credit and message headroom", () => {
    const premium = { ...SETTINGS, accountTier: "PREMIUM" as const, monthlyInMailCredits: 2 };
    const result = paceToday(tasks("INMAIL", 5), NO_USAGE, premium);
    assert.equal(result.visible.length, 2);
    assert.equal(result.held.inmails, 3);
    assert.equal(paceToday(tasks("INMAIL", 1), NO_USAGE, SETTINGS).visible.length, 0);
    assert.equal(INMAIL_CREDIT_CEILING.FREE, 0);
  });

  test("a free account out of personalised notes is told so", () => {
    assert.equal(paceToday([], { ...NO_USAGE, notesThisMonth: 3 }, SETTINGS).notesExhausted, true);
    assert.equal(paceToday([], { ...NO_USAGE, notesThisMonth: 3 }, { ...SETTINGS, accountTier: "PREMIUM" }).notesExhausted, false);
  });

  test("usage is counted on the workspace's calendar", () => {
    const now = new Date("2026-09-28T23:30:00Z"); // 00:30 on the 29th in London
    const usage = usageFrom(
      [
        { kind: "CONNECTION_NOTE", completedAt: "2026-09-28T23:10:00Z", withNote: true }, // today (29th) London
        { kind: "CONNECTION_NOTE", completedAt: "2026-09-28T12:00:00Z", withNote: false }, // yesterday
        { kind: "FOLLOW_UP", completedAt: "2026-09-28T23:20:00Z", withNote: true },
        { kind: "REPLY", completedAt: "2026-09-28T23:25:00Z", withNote: true },
        { kind: "INMAIL", completedAt: "2026-09-02T10:00:00Z", withNote: true },
      ],
      now,
      "Europe/London",
    );
    assert.equal(usage.connectionsToday, 1);
    assert.equal(usage.connectionsThisWeek, 2);
    assert.equal(usage.messagesToday, 1, "a reply is not counted against the message cap");
    assert.equal(usage.notesThisMonth, 1);
    assert.equal(usage.inmailsThisMonth, 1);
  });

  test("dates", () => {
    assert.equal(addDays("2026-09-28", 4), "2026-10-02");
    assert.equal(localDate(new Date("2026-09-28T23:30:00Z"), "Europe/London"), "2026-09-29");
    assert.equal(localDate(new Date("2026-09-28T23:30:00Z"), "Not/AZone"), "2026-09-28");
  });
});

/* ================================================================ state */

describe("follow-ups are scheduled as tasks, and stop", () => {
  const settings = { followUpAfterDays: 4, maxFollowUps: 2 };

  test("a connection request schedules the first message N days later", () => {
    const out = onMarkSent({ contactId: "c", kind: "CONNECTION_NOTE", step: 1, today: "2026-09-28", settings, currentState: "NOT_STARTED" });
    assert.equal(out.nextState, "INVITED");
    assert.deepEqual(out.next, { kind: "FOLLOW_UP", step: 1, dueOn: "2026-10-02", dedupeKey: "followup:c:1" });
  });

  test("the sequence ends after the last follow-up", () => {
    const second = onMarkSent({ contactId: "c", kind: "FOLLOW_UP", step: 2, today: "2026-09-28", settings, currentState: "MESSAGED" });
    assert.equal(second.next?.step, 3);
    const last = onMarkSent({ contactId: "c", kind: "FOLLOW_UP", step: 3, today: "2026-09-28", settings, currentState: "MESSAGED" });
    assert.equal(last.next, null);
    assert.equal(last.finished, true);
    const none = onMarkSent({ contactId: "c", kind: "FOLLOW_UP", step: 1, today: "2026-09-28", settings: { followUpAfterDays: 4, maxFollowUps: 0 }, currentState: "INVITED" });
    assert.equal(none.finished, true);
  });

  test("an InMail schedules nothing: a second one would cost a credit and read as pressure", () => {
    const out = onMarkSent({ contactId: "c", kind: "INMAIL", step: 1, today: "2026-09-28", settings, currentState: "NOT_STARTED" });
    assert.equal(out.next, null);
    assert.equal(out.nextState, "MESSAGED");
  });

  test("skipping", () => {
    assert.equal(onSkip({ contactId: "c", kind: "CONNECTION_NOTE", step: 1, today: "2026-09-28", settings }).stop, "SKIPPED");
    assert.equal(onSkip({ contactId: "c", kind: "FOLLOW_UP", step: 1, today: "2026-09-28", settings }).stop, "NO_RESPONSE");
    assert.equal(onSkip({ contactId: "c", kind: "FOLLOW_UP", step: 2, today: "2026-09-28", settings }).next?.step, 3);
    assert.equal(onSkip({ contactId: "c", kind: "REPLY", step: 1, today: "2026-09-28", settings }).stop, null);
  });

  test("only the first message can be put off, twice", () => {
    assert.equal(canSnooze("FOLLOW_UP", 1, 0), true);
    assert.equal(canSnooze("FOLLOW_UP", 1, 2), false);
    assert.equal(canSnooze("FOLLOW_UP", 2, 0), false);
    assert.equal(canSnooze("CONNECTION_NOTE", 1, 0), false);
  });

  test("stop conditions: opt-out stops everything, a reply stops outreach only", () => {
    const live = { contactState: "MESSAGED" as const, optedOut: false, leadStatus: "CONTACTED" };
    assert.equal(stopReasonFor("FOLLOW_UP", live), null);
    assert.equal(stopReasonFor("REPLY", { ...live, optedOut: true }), "OPTED_OUT");
    assert.equal(stopReasonFor("FOLLOW_UP", { ...live, contactState: "REPLIED" }), "REPLIED");
    assert.equal(stopReasonFor("REPLY", { ...live, contactState: "REPLIED" }), null);
    assert.equal(stopReasonFor("FOLLOW_UP", { ...live, leadStatus: "WON" }), "WON");
    assert.equal(stopReasonFor("CONNECTION_NOTE", { ...live, leadStatus: "LOST" }), "LOST");
    assert.equal(stopReasonFor("REPLY", { ...live, leadStatus: "WON" }), null);
    assert.equal(stopReasonFor("FOLLOW_UP", { ...live, contactState: "STOPPED" }), "REMOVED");
  });
});

/* ================================================================ moves */

describe("moving to email, SMS or a call only where the person gave the channel", () => {
  const lead = {
    email: "jane@acme.co.uk",
    emailOrigin: "CUSTOMER_PROVIDED",
    phone: "07700900123",
    phoneSource: "LEAD_FORM",
    phoneType: "UK_MOBILE",
    optedOut: false,
  };
  const allowed = (l: typeof lead | null) =>
    Object.fromEntries(channelMoves(l).map((m) => [m.channel, m.allowed]));

  test("a lead-form mobile allows all three", () => {
    assert.deepEqual(allowed(lead), { email: true, sms: true, call: true });
  });

  test("an enriched or imported number is never texted or rung (CLAUDE.md conflict 6)", () => {
    assert.deepEqual(allowed({ ...lead, phoneSource: "ENRICHMENT" }), { email: true, sms: false, call: false });
    assert.deepEqual(allowed({ ...lead, phoneSource: "IMPORT" }), { email: true, sms: false, call: false });
  });

  test("a guessed email is not a channel they gave", () => {
    assert.equal(allowed({ ...lead, emailOrigin: "PATTERN_INFERRED" }).email, false);
  });

  test("a landline they gave can be rung but not texted; an inbound caller can be rung", () => {
    assert.deepEqual(allowed({ ...lead, phone: "02079460000", phoneType: "UK_GEOGRAPHIC" }), { email: true, sms: false, call: true });
    assert.equal(allowed({ ...lead, phoneSource: "INBOUND_CALL" }).call, true);
    assert.equal(allowed({ ...lead, phoneSource: "INBOUND_CALL" }).sms, false);
  });

  test("a prospect or an opted-out lead cannot be moved", () => {
    assert.deepEqual(allowed(null), { email: false, sms: false, call: false });
    assert.deepEqual(allowed({ ...lead, optedOut: true }), { email: false, sms: false, call: false });
  });
});

/* ================================================================ drafting */

describe("drafting: AI proposes, the guard and the template decide", () => {
  const subject: DraftSubject = {
    firstName: "Jane",
    lastName: "Doe",
    roleTitle: "Head of Growth",
    companyName: "Acme Studio",
    industry: "design agencies",
  };
  const business: DraftBusiness = { name: "Northwind", serviceLine: "Shopify builds" };
  const facts = draftFacts(subject, business);

  function fake(result: Awaited<ReturnType<Generate>> | Error): { generate: Generate; calls: number } {
    const box = { calls: 0, generate: (async () => {
      box.calls += 1;
      if (result instanceof Error) throw result;
      return result;
    }) as Generate };
    return box;
  }

  test("templates fit LinkedIn's limits and never say 'thanks for connecting' in an InMail", () => {
    const longBusiness = { name: "N".repeat(200), serviceLine: "S".repeat(200) };
    assert.ok(templateDraft("CONNECTION_NOTE", 1, subject, longBusiness).length <= CONNECTION_NOTE_MAX_CHARS);
    assert.doesNotMatch(templateDraft("INMAIL", 1, subject, business), /thanks for connecting/i);
    assert.match(templateDraft("FOLLOW_UP", 1, subject, business), /Thanks for connecting/);
    assert.match(templateDraft("FOLLOW_UP", 3, subject, business), /Last one from me/);
    assert.equal(copyKindFor("FOLLOW_UP", 2), "FOLLOW_UP");
  });

  test("AI off: the template, and the model is never called", async () => {
    const box = fake({ data: { body: "x", used_facts: [] } });
    const draft = await composeDraft({ kind: "FOLLOW_UP", step: 1, subject, business, aiEnabled: false, idempotencyKey: "k", generate: box.generate });
    assert.equal(draft.source, "TEMPLATE");
    assert.equal(box.calls, 0);
  });

  test("a clean draft that cites supplied facts is used", async () => {
    const body = "Hi Jane, Northwind builds Shopify stores for design agencies. Is that something Acme Studio looks after in-house?";
    const box = fake({ data: { body, used_facts: [facts[0]] } });
    const draft = await composeDraft({ kind: "FOLLOW_UP", step: 1, subject, business, aiEnabled: true, idempotencyKey: "k", generate: box.generate });
    assert.equal(draft.source, "AI");
    assert.equal(draft.body, body);
  });

  test("a price, a promise, a fake relationship or an invented fact falls back to the template", async () => {
    for (const [body, used] of [
      ["Our builds start at £499, want one?", []],
      ["We guarantee more sales within 30 days.", []],
      ["As we discussed last week, shall we talk?", []],
      ["Congrats on the funding round!", ["They just raised a Series A."]],
    ] as [string, string[]][]) {
      const box = fake({ data: { body, used_facts: used } });
      const draft = await composeDraft({ kind: "FOLLOW_UP", step: 2, subject, business, aiEnabled: true, idempotencyKey: "k", generate: box.generate });
      assert.equal(draft.source, "TEMPLATE", body);
      assert.ok(draft.fallbackReason, body);
    }
  });

  test("a connection note over 300 characters is never used", async () => {
    const box = fake({ data: { body: "Hi Jane. ".repeat(40), used_facts: [] } });
    const draft = await composeDraft({ kind: "CONNECTION_NOTE", step: 1, subject, business, aiEnabled: true, idempotencyKey: "k", generate: box.generate });
    assert.equal(draft.source, "TEMPLATE");
    assert.ok(draft.body.length <= 300);
  });

  test("no tokens, a budget refusal or a failed call degrade to the template, with the reason", async () => {
    const tokens = await composeDraft({ kind: "INMAIL", step: 1, subject, business, aiEnabled: true, idempotencyKey: "k", generate: fake({ data: null, skippedReason: "NO_TOKENS" }).generate });
    assert.match(tokens.fallbackReason ?? "", /AI allowance/);
    const failed = await composeDraft({ kind: "INMAIL", step: 1, subject, business, aiEnabled: true, idempotencyKey: "k", generate: fake(new Error("boom")).generate });
    assert.equal(failed.source, "TEMPLATE");
  });
});

/* ================================================================ agent + registry */

describe("the agent never sends on LinkedIn; a person does", () => {
  const base = {
    agentMode: "AUTO_REPLY" as const,
    contactSuppressed: false,
    hasDestination: true,
    providerHealthy: true,
    lastInboundAt: new Date("2026-09-28T11:00:00Z").toISOString(),
    socialConnectionState: "REPLIED",
    quietHours: { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" },
    now: new Date("2026-09-28T12:00:00Z"),
  };

  test("an allowed LinkedIn reply is a DRAFT, never a SEND", () => {
    assert.equal(evaluateSendGate({ ...base, channel: "linkedin" } as never).decision, "DRAFT");
  });

  test("opt-out and a missing connection still deny outright", () => {
    assert.equal(evaluateSendGate({ ...base, channel: "linkedin", contactSuppressed: true } as never).decision, "DENY");
    assert.equal(evaluateSendGate({ ...base, channel: "linkedin", socialConnectionState: null } as never).decision, "DENY");
  });

  test("other channels are unchanged", () => {
    assert.equal(evaluateSendGate({ ...base, channel: "sms" } as never).decision, "SEND");
  });
});

describe("registry and migration", () => {
  const OPS = [
    "linkedin_assist.add_contact",
    "linkedin_assist.redraft",
    "linkedin_assist.mark_sent",
    "linkedin_assist.skip",
    "linkedin_assist.snooze",
    "linkedin_assist.log_reply",
    "linkedin_assist.move_channel",
    "linkedin_assist.update_settings",
  ];

  test("every LinkedIn Assist operation is declared, well formed and UI-only", () => {
    for (const name of OPS) {
      const op = serviceOperation(name);
      assert.ok(op, name);
      assert.deepEqual(declarationProblems(op!), [], name);
      assert.deepEqual([...(op!.callers ?? [])], ["UI"], name);
      assert.equal(op!.minimumRole, "member", name);
    }
    assert.equal(ALL_OPERATIONS.filter((op) => op.domain === "linkedin_assist").length, OPS.length);
  });

  const sql = readFileSync(path.join(process.cwd(), "supabase", "migrations", "0171_linkedin_assist.sql"), "utf8");

  test("every table has business_id, forced RLS, member-only select and no browser writes", () => {
    for (const table of ["linkedin_assist_settings", "linkedin_assist_contacts", "linkedin_assist_tasks"]) {
      const body = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
      assert.match(body, /business_id uuid not null references public\.businesses\(id\) on delete cascade/, table);
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`), table);
      assert.match(sql, new RegExp(`alter table public\\.${table} force row level security;`), table);
      assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated;`), table);
      assert.match(sql, new RegExp(`grant select on public\\.${table} to authenticated;`), table);
      assert.match(sql, new RegExp(`on public\\.${table}\\s+for select to authenticated\\s+using \\(public\\.is_business_member\\(business_id\\)\\);`), table);
      assert.doesNotMatch(sql, new RegExp(`grant (insert|update|delete)[^;]*on public\\.${table}`), table);
    }
  });

  test("the CHECK ceilings are the code's ceilings: configurable lower only", () => {
    assert.match(sql, new RegExp(`daily_connection_notes between 0 and ${LINKEDIN_ASSIST_LIMITS.dailyConnectionNotes}\\)`));
    assert.match(sql, new RegExp(`weekly_connection_requests between 0 and ${LINKEDIN_ASSIST_LIMITS.weeklyConnectionRequests}\\)`));
    assert.match(sql, new RegExp(`daily_messages between 0 and ${LINKEDIN_ASSIST_LIMITS.dailyMessages}\\)`));
    assert.match(sql, new RegExp(`max_follow_ups between 0 and ${LINKEDIN_ASSIST_LIMITS.maxFollowUps}\\)`));
    assert.match(sql, new RegExp(`follow_up_after_days between ${LINKEDIN_ASSIST_LIMITS.followUpAfterDaysMin} and ${LINKEDIN_ASSIST_LIMITS.followUpAfterDaysMax}\\)`));
    assert.match(sql, /char_length\(body\) <= 300/);
  });
});

/* ================================================================ Meta */

describe("Messenger and Instagram: opt-outs land on the thread's own address", () => {
  test("a platform sender is filed as social, verbatim, never as a phone number", () => {
    assert.deepEqual(optOutDestination("instagram", "meta_igsid:17841400000000001"), {
      email: null,
      phone: null,
      social: "meta_igsid:17841400000000001",
    });
    assert.deepEqual(optOutDestination("messenger", "meta_psid:123"), { email: null, phone: null, social: "meta_psid:123" });
  });

  test("phone and email are unchanged", () => {
    assert.deepEqual(optOutDestination("sms", "07700 900123"), { email: null, phone: "+447700900123", social: null });
    assert.deepEqual(optOutDestination("email", "jane1@acme.co.uk"), { email: "jane1@acme.co.uk", phone: null, social: null });
  });
});

describe("Meta messaging needs Meta's approval, and says so", () => {
  const connected = { connected: true, pageId: "p1", instagramUserId: "ig1", scopes: ["pages_messaging", "instagram_basic", "instagram_manage_messages"] };

  test("granted permissions are read from /me/permissions", () => {
    assert.deepEqual(
      grantedPermissions({
        data: [
          { permission: "pages_messaging", status: "granted" },
          { permission: "instagram_manage_messages", status: "declined" },
          { permission: "instagram_basic", status: "granted" },
        ],
      }),
      ["instagram_basic", "pages_messaging"],
    );
    assert.deepEqual(grantedPermissions(null), []);
  });

  test("Instagram without instagram_manage_messages is 'requires Meta approval' and refused", () => {
    const capability = metaChannelCapability("instagram", { ...connected, scopes: ["pages_messaging", "instagram_basic"] });
    assert.equal(capability.state, "NEEDS_META_APPROVAL");
    assert.match("message" in capability ? capability.message : "", /requires Meta approval/);
    assert.equal(metaSendPermitted(capability), false);
    // Messenger on the same connection is fine.
    assert.equal(metaChannelCapability("messenger", { ...connected, scopes: ["pages_messaging", "instagram_basic"] }).state, "READY");
  });

  test("no linked Instagram account, no connection, unknown permissions", () => {
    assert.equal(metaChannelCapability("instagram", { ...connected, instagramUserId: null }).state, "NO_INSTAGRAM_ACCOUNT");
    assert.equal(metaChannelCapability("messenger", null).state, "NOT_CONNECTED");
    const legacy = metaChannelCapability("instagram", { ...connected, scopes: [] });
    assert.equal(legacy.state, "UNVERIFIED");
    // A connection made before permissions were recorded keeps working.
    assert.equal(metaSendPermitted(legacy), true);
    assert.equal(metaSendPermitted(metaChannelCapability("instagram", connected)), true);
  });
});
