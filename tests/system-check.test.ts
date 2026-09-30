import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  FIX,
  SYSTEM_CHECK_HREF,
  buildReport,
  callRefusalText,
  checkAgents,
  checkAi,
  checkBilling,
  checkBooking,
  checkFindLeads,
  checkMessaging,
  checkPayments,
  checkSources,
  checkVoice,
  checkWorker,
  explainLead,
  isBookingConfigured,
  rollup,
  unknownEngine,
  type AiFacts,
  type CheckRow,
  type EngineReport,
  type LeadWhyFacts,
  type MessagingFacts,
  type SourceFacts,
  type VoiceFacts,
} from "../src/lib/system-check/model.ts";
import { PROVIDERS, type ProviderCardModel } from "../src/lib/integrations/catalog.ts";
import { SETTINGS_SECTIONS } from "../src/lib/settings/types.ts";
import { VOICE_PANELS } from "../src/lib/voice/settings-ui.ts";
import { ENTITLEMENT_MESSAGES } from "../src/lib/voice/dial-decision.ts";

/**
 * Settings -> System check and the lead page's "Why hasn't anything
 * happened?", with fakes only: every engine's states, the link each problem
 * offers, the admin/customer difference and the read-only wiring.
 */

// Tue 29 Sep 2026, 11:00 in London (BST): inside default calling hours and outside quiet hours.
const NOON = new Date("2026-09-29T10:00:00Z");
// 23:30 London: inside quiet hours, outside calling hours.
const NIGHT = new Date("2026-09-29T22:30:00Z");
const TZ = "Europe/London";

function row(report: EngineReport, id: string): CheckRow {
  const found = report.rows.find((r) => r.id === id);
  assert.ok(found, `row ${id} missing from ${report.id}: ${report.rows.map((r) => r.id).join(", ")}`);
  return found;
}

/* ------------------------------------------------------------------ AI */

const AI_ON: AiFacts = { enabled: true, planAllows: true, mode: "AUTO_REPLY", channels: ["sms", "email"], whatsappEnabled: false, emailConnected: true };

describe("AI assistant", () => {
  test("ready when on, auto-replying, on usable channels", () => {
    const report = checkAi(AI_ON);
    assert.equal(report.status, "READY");
    assert.equal(row(report, "ai.channels").status, "READY");
  });

  test("switched off is off by choice, and says AI calls can't run, linking to the switch", () => {
    const report = checkAi({ ...AI_ON, enabled: false });
    assert.equal(report.status, "OFF");
    const r = row(report, "ai.switch");
    assert.match(r.reason, /AI voice calls/);
    assert.deepEqual(r.fix, FIX.aiAssistant);
  });

  test("not on the plan links to billing", () => {
    const report = checkAi({ ...AI_ON, planAllows: false });
    assert.equal(row(report, "ai.plan").fix, FIX.billing);
  });

  test("mode Off is off by choice", () => {
    assert.equal(row(checkAi({ ...AI_ON, mode: "OFF" }), "ai.mode").status, "OFF");
  });

  test("no channels, or a ticked channel that can't send, needs attention", () => {
    assert.equal(row(checkAi({ ...AI_ON, channels: [] }), "ai.channels").status, "ATTENTION");
    const email = row(checkAi({ ...AI_ON, emailConnected: false }), "ai.channels");
    assert.equal(email.status, "ATTENTION");
    assert.equal(email.fix, FIX.mailbox);
    assert.equal(row(checkAi({ ...AI_ON, channels: ["whatsapp"] }), "ai.channels").fix, FIX.billing);
  });
});

/* ------------------------------------------------------------ messaging */

const MSG: MessagingFacts = {
  sendingAllowed: true,
  integrations: [{ provider_type: "imap_smtp", status: "HEALTHY" }],
  smsPlatformReady: true,
  whatsappPlatformReady: true,
  whatsappOnPlan: true,
  mailbox: { status: "HEALTHY", lastErrorMessage: null },
  quietHours: { enabled: true, start: "20:00", end: "08:00", timezone: TZ },
  senders: [{ email: "a@b.example", paused: false, pausedUntil: null, sentToday: 3, dailySendCap: 50 }],
  domains: [{ domain: "b.example", healthState: "HEALTHY", bounceRate: 0.01, complaintRate: 0 }],
  budgets: [{ key: "sms", label: "SMS", level: "ok", used: 10, limit: 500, credits: 0 }],
};

describe("Text replies and follow-up", () => {
  test("ready in the day with everything healthy", () => {
    const report = checkMessaging(MSG, NOON);
    assert.equal(report.status, "READY");
    assert.match(row(report, "messaging.quiet").reason, /Outside quiet hours/);
  });

  test("quiet hours now says when messages resume", () => {
    const r = row(checkMessaging(MSG, NIGHT), "messaging.quiet");
    assert.equal(r.status, "READY");
    assert.match(r.reason, /held, not dropped/);
    assert.match(r.reason, /08:00/);
  });

  test("billing pause, broken SMS and a broken mailbox need attention with their fixes", () => {
    const report = checkMessaging(
      {
        ...MSG,
        sendingAllowed: false,
        integrations: [{ provider_type: "twilio_sms", status: "ACTION_REQUIRED" }],
        mailbox: { status: "ACTION_REQUIRED", lastErrorMessage: "Authentication failed" },
      },
      NOON,
    );
    assert.equal(report.status, "ATTENTION");
    assert.equal(row(report, "messaging.sending").fix, FIX.billing);
    assert.equal(row(report, "messaging.sms").fix, FIX.connections);
    const mailbox = row(report, "messaging.mailbox");
    assert.equal(mailbox.status, "ATTENTION");
    assert.match(mailbox.reason, /Authentication failed/);
    assert.equal(mailbox.fix, FIX.mailbox);
  });

  test("no mailbox is off by choice; WhatsApp off the plan is off", () => {
    const report = checkMessaging({ ...MSG, mailbox: null, whatsappOnPlan: false }, NOON);
    assert.equal(row(report, "messaging.mailbox").status, "OFF");
    assert.equal(row(report, "messaging.whatsapp").status, "OFF");
  });

  test("a paused sender or a warning domain, and a used-up allowance, need attention", () => {
    const report = checkMessaging(
      {
        ...MSG,
        senders: [{ email: "a@b.example", paused: true, pausedUntil: "2026-09-30T08:00:00Z", sentToday: 0, dailySendCap: 50 }],
        domains: [{ domain: "b.example", healthState: "WARNING", bounceRate: 0.06, complaintRate: 0.001 }],
        budgets: [{ key: "sms", label: "SMS", level: "reached", used: 500, limit: 500, credits: 0 }],
      },
      NOON,
    );
    assert.equal(row(report, "messaging.senders").fix, FIX.sendingDomains);
    const budget = row(report, "messaging.budget.sms");
    assert.equal(budget.status, "ATTENTION");
    assert.equal(budget.fix, FIX.credits);
  });

  test("a domain failing SPF/DKIM/DMARC is not reported as healthy", () => {
    const report = checkMessaging(
      {
        ...MSG,
        senders: [{ email: "a@b.example", paused: false, pausedUntil: null, sentToday: 0, dailySendCap: 50 }],
        domains: [{ domain: "b.example", healthState: "HEALTHY", bounceRate: 0, complaintRate: 0, spf: "FAIL", dkim: "PASS", dmarc: "MISSING" }],
      },
      NOON,
    );
    const senders = row(report, "messaging.senders");
    assert.equal(senders.status, "ATTENTION");
    assert.match(senders.reason, /b\.example: SPF, DMARC not passing/);
  });
});

/* ---------------------------------------------------------------- voice */

const VOICE: VoiceFacts = {
  entitlement: { allowed: true, locked: false, reasons: [], message: null },
  integration: { ready: true, missing: [] },
  settings: { voiceEnabled: true, adminKillSwitch: false, callingHours: null },
  identity: { ready: true, problems: [] },
  number: { state: "ACTIVE", stageLabel: "Active", e164: "+442071234567", needsAttention: false, rejectionReason: null },
  minutes: { available: true, includedRemainingMin: 150, packRemainingMin: 30 },
  timezone: TZ,
};

describe("AI voice calls", () => {
  test("ready inside calling hours with everything set", () => {
    const report = checkVoice(VOICE, NOON);
    assert.equal(report.status, "READY");
    assert.match(row(report, "voice.minutes").reason, /180 minutes left/);
  });

  test("the owner's live test: AI off, no number, identity and minutes each get their own row and link", () => {
    const report = checkVoice(
      {
        ...VOICE,
        entitlement: { allowed: false, locked: false, reasons: ["AI_ASSISTANT_OFF", "IDENTITY_INCOMPLETE", "NO_NUMBER", "NO_MINUTES"], message: null },
        identity: { ready: false, problems: ["legalEntityName:missing"] },
        number: { state: "NOT_REQUESTED", stageLabel: "Not requested", e164: null, needsAttention: false, rejectionReason: null },
        minutes: { available: false, includedRemainingMin: 0, packRemainingMin: 0 },
      },
      NOON,
    );
    assert.equal(report.status, "ATTENTION");
    assert.equal(row(report, "voice.ai").fix, FIX.aiAssistant);
    assert.equal(row(report, "voice.identity").fix, FIX.voiceIdentity);
    assert.equal(row(report, "voice.number").fix, FIX.voiceNumber);
    const minutes = row(report, "voice.minutes");
    assert.ok(minutes.reason.startsWith(ENTITLEMENT_MESSAGES.NO_MINUTES));
    assert.equal(minutes.fix, FIX.voiceBudget);
  });

  test("locked (trial or no voice) is one off-by-choice row linking to billing", () => {
    const report = checkVoice({ ...VOICE, entitlement: { allowed: false, locked: true, reasons: ["TRIAL_ACCOUNT"], message: "Trials don't call." } }, NOON);
    assert.equal(report.rows.length, 1);
    assert.equal(report.status, "OFF");
    assert.equal(report.rows[0].fix, FIX.billing);
  });

  test("voice switched off is off; outside calling hours is off with the next window", () => {
    assert.equal(row(checkVoice({ ...VOICE, settings: { ...VOICE.settings, voiceEnabled: false } }, NOON), "voice.switch").status, "OFF");
    const hours = row(checkVoice(VOICE, NIGHT), "voice.hours");
    assert.equal(hours.status, "OFF");
    assert.match(hours.reason, /queued until/);
    assert.equal(hours.fix, FIX.voiceHours);
  });

  test("a kill switch and an unknown future reason are never dropped", () => {
    const report = checkVoice({ ...VOICE, entitlement: { allowed: false, locked: false, reasons: ["KILL_SWITCH_WORKSPACE", "SOMETHING_NEW"], message: null } }, NOON);
    assert.equal(row(report, "voice.paused").status, "ATTENTION");
    assert.equal(row(report, "voice.entitlement.SOMETHING_NEW").status, "ATTENTION");
  });

  test("calling service missing: the customer is told to contact support; admin sees what is missing and no link", () => {
    const facts = { ...VOICE, integration: { ready: false, missing: ["RETELL_API_KEY"] } };
    const customer = row(checkVoice(facts, NOON, "customer"), "voice.service");
    assert.doesNotMatch(customer.reason, /RETELL_API_KEY/);
    assert.equal(customer.fix, FIX.help);
    const admin = row(checkVoice(facts, NOON, "admin"), "voice.service");
    assert.match(admin.reason, /RETELL_API_KEY/);
    assert.equal(admin.fix, null);
  });
});

/* -------------------------------------------------------------- booking */

describe("Booking", () => {
  const BASE = { bookingMode: "google_calendar", bookingUrl: null, calendars: [{ provider: "google_calendar", status: "HEALTHY" }], calendlyEventTypeChosen: false, aiMayBook: true, aiAssistantOn: true };

  test("the shared booking rule: a link, or the chosen calendar connected", () => {
    assert.equal(isBookingConfigured({ bookingMode: "handover", bookingUrl: "https://cal.example/x" }, new Set()), true);
    assert.equal(isBookingConfigured({ bookingMode: "calendly", bookingUrl: null }, new Set(["calendly"])), true);
    assert.equal(isBookingConfigured({ bookingMode: "calendly", bookingUrl: null }, new Set(["google_calendar"])), false);
  });

  test("ready with a connected calendar and permission", () => {
    assert.equal(checkBooking(BASE).status, "READY");
  });

  test("calendar chosen but disconnected needs attention -> Connections", () => {
    const report = checkBooking({ ...BASE, calendars: [] });
    assert.equal(row(report, "booking.calendar").fix, FIX.connections);
    assert.equal(row(report, "booking.permission").status, "ATTENTION");
  });

  test("'Book meetings' off links to What the AI may do; AI off links to the assistant", () => {
    assert.equal(row(checkBooking({ ...BASE, aiMayBook: false }), "booking.permission").fix, FIX.aiPermissions);
    assert.equal(row(checkBooking({ ...BASE, aiAssistantOn: false }), "booking.permission").fix, FIX.aiAssistant);
  });

  test("no calendar and no link is off by choice -> booking settings", () => {
    const r = row(checkBooking({ ...BASE, bookingMode: "handover", calendars: [] }), "booking.calendar");
    assert.equal(r.status, "OFF");
    assert.equal(r.fix, FIX.booking);
  });
});

/* ---------------------------------------------------------- lead sources */

function card(id: string, integration: Partial<NonNullable<ProviderCardModel["integration"]>> | null): ProviderCardModel {
  const definition = PROVIDERS.find((p) => p.id === id)!;
  const full = integration
    ? { id: "i1", providerType: definition.id, status: "HEALTHY", externalAccountId: null, displayName: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, ...integration }
    : null;
  return { definition, integration: full, block: null, connected: Boolean(full) && full!.status !== "DISCONNECTED", status: full?.status ?? "DISCONNECTED" };
}

const SOURCES: SourceFacts = {
  cards: [card("meta", { lastSuccessAt: "2026-09-29T09:00:00Z" }), card("google_ads", null)],
  metaTokenExpiresAt: "2026-11-20T00:00:00Z",
  lastEvents: {},
  connectors: [],
  openConnectorFailures: 0,
  apiKeys: { active: 0, lastUsedAt: null },
  timezone: TZ,
};

describe("Lead sources", () => {
  test("connected Meta is ready with its last activity; unconnected Google is off -> Connections", () => {
    const report = checkSources(SOURCES, NOON);
    assert.equal(row(report, "sources.meta").status, "READY");
    assert.match(row(report, "sources.meta").reason, /Last activity/);
    assert.equal(row(report, "sources.google_ads").status, "OFF");
    assert.equal(row(report, "sources.google_ads").fix, FIX.connections);
    assert.equal(row(report, "sources.api").fix, FIX.developer);
  });

  test("Meta token expiring soon, or expired, needs attention", () => {
    assert.match(row(checkSources({ ...SOURCES, metaTokenExpiresAt: "2026-10-03T00:00:00Z" }, NOON), "sources.meta").reason, /expires in 3 days/);
    assert.match(row(checkSources({ ...SOURCES, metaTokenExpiresAt: "2026-09-01T00:00:00Z" }, NOON), "sources.meta").reason, /expired/);
  });

  test("reconnect required and a newer error both need attention", () => {
    assert.equal(row(checkSources({ ...SOURCES, cards: [card("meta", { status: "ACTION_REQUIRED" })] }, NOON), "sources.meta").status, "ATTENTION");
    const err = row(
      checkSources({ ...SOURCES, cards: [card("meta", { lastSuccessAt: "2026-09-28T09:00:00Z", lastErrorAt: "2026-09-29T09:00:00Z", lastErrorMessage: "Page access revoked" })] }, NOON),
      "sources.meta",
    );
    assert.equal(err.status, "ATTENTION");
    assert.match(err.reason, /Page access revoked/);
  });

  test("webhook failures need attention; API keys show last use", () => {
    const report = checkSources(
      {
        ...SOURCES,
        connectors: [{ label: "Zapier", active: true, lastReceivedAt: "2026-09-28T09:00:00Z", lastFailureAt: "2026-09-29T08:00:00Z", lastFailureReason: "missing email" }],
        openConnectorFailures: 2,
        apiKeys: { active: 1, lastUsedAt: "2026-09-29T08:00:00Z" },
      },
      NOON,
    );
    assert.match(row(report, "sources.webhooks").reason, /2 deliveries couldn't be turned into leads\. Zapier: missing email/);
    assert.equal(row(report, "sources.api").status, "READY");
  });
});

/* ------------------------------------------- Find Leads, agents, payments */

describe("Find Leads", () => {
  test("off the plan, used-up allowance, and no sources", () => {
    assert.equal(checkFindLeads({ sourcingEnabled: false, searchRuns: null, verifiedProspects: null, companySearchAvailable: false, contactDiscoveryAvailable: false }).status, "OFF");
    const report = checkFindLeads({
      sourcingEnabled: true,
      searchRuns: { used: 20, limit: 20, allowed: false },
      verifiedProspects: null,
      companySearchAvailable: false,
      contactDiscoveryAvailable: true,
    });
    assert.equal(row(report, "find_leads.runs").fix, FIX.limits);
    assert.equal(row(report, "find_leads.prospects").status, "UNKNOWN");
    assert.equal(row(report, "find_leads.company").status, "ATTENTION");
  });
});

describe("Agents", () => {
  test("none is off; an erroring agent and waiting approvals need attention", () => {
    assert.equal(checkAgents({ agents: [], timezone: TZ }).status, "OFF");
    const report = checkAgents({
      agents: [
        { id: "a1", name: "Prospector", status: "ERROR", statusReason: "Budget exhausted.", lastRunAt: "2026-09-29T08:00:00Z", lastRunStatus: "FAILED", pendingReviewCount: 4 },
        { id: "a2", name: "Paused one", status: "PAUSED", statusReason: null, lastRunAt: null, lastRunStatus: null, pendingReviewCount: 0 },
      ],
      timezone: TZ,
    });
    assert.equal(row(report, "agents.a1").fix?.href, "/app/agents/a1");
    assert.equal(row(report, "agents.a2").status, "OFF");
    assert.match(row(report, "agents.approvals").reason, /4 items/);
  });
});

describe("Quotes and payments", () => {
  test("pay link, webhook health and payments to review", () => {
    const base = { quotesAllowed: true, invoicePayMode: "NONE", endpoints: [], paymentsToReview: 0, timezone: TZ };
    const off = checkPayments(base);
    assert.equal(row(off, "payments.paylink").status, "OFF");
    assert.equal(row(off, "payments.webhook").fix, FIX.payments);
    const broken = checkPayments({
      ...base,
      invoicePayMode: "WORKSPACE_LINK",
      endpoints: [{ kind: "STRIPE", active: true, hasSecret: true, lastReceivedAt: null, lastError: "signature mismatch" }],
      paymentsToReview: 2,
    });
    assert.equal(row(broken, "payments.webhook").status, "ATTENTION");
    assert.equal(row(broken, "payments.review").fix, FIX.paymentReview);
    assert.equal(row(checkPayments({ ...base, endpoints: null, paymentsToReview: null }), "payments.webhook").status, "UNKNOWN");
    assert.equal(checkPayments({ ...base, quotesAllowed: false }).status, "OFF");
  });
});

describe("Plan and limits", () => {
  test("restricted, cancelled, over-limit and reached limits need attention", () => {
    assert.equal(checkBilling({ state: "ACTIVE", planName: "Growth", trialEndsAt: null, overLimit: [], limits: [], timezone: TZ }).status, "READY");
    assert.equal(checkBilling({ state: "PAST_DUE_RESTRICTED", planName: "Growth", trialEndsAt: null, overLimit: [], limits: [], timezone: TZ }).status, "ATTENTION");
    assert.equal(checkBilling({ state: "CANCELLED", planName: "Growth", trialEndsAt: null, overLimit: [], limits: [], timezone: TZ }).status, "ATTENTION");
    const report = checkBilling({
      state: "ACTIVE",
      planName: "Starter",
      trialEndsAt: null,
      overLimit: [{ label: "Seats", used: 4, limit: 3, action: "Remove 1 member." }],
      limits: [{ key: "leads", label: "Leads", level: "reached", used: 500, limit: 500, atLimit: "New leads are held." }],
      timezone: TZ,
    });
    assert.equal(row(report, "billing.limit.leads").fix, FIX.limits);
    assert.match(row(report, "billing.over.Seats").reason, /Remove 1 member/);
  });
});

describe("Background processing", () => {
  const base = { alive: true, lastCompletedAt: "2026-09-29T09:58:00Z", overdue: 0, stuck: 0, dead: { count: 0, types: [], latestError: null }, timezone: TZ };
  test("healthy, then a stopped worker and stuck/dead jobs", () => {
    assert.equal(checkWorker(base).status, "READY");
    const bad = checkWorker({ ...base, alive: false, overdue: 3, stuck: 1, dead: { count: 2, types: ["message.send"], latestError: "boom: secret detail" } });
    assert.equal(bad.status, "ATTENTION");
    assert.doesNotMatch(row(bad, "worker.dead").reason, /secret detail/, "customers never see raw job errors");
    const admin = checkWorker({ ...base, dead: { count: 1, types: ["x"], latestError: "boom" } }, "admin");
    assert.match(row(admin, "worker.dead").reason, /boom/);
    assert.equal(row(admin, "worker.dead").fix, null);
  });

  test("a paused workspace says it is paused, not just overdue", () => {
    const paused = row(checkWorker({ ...base, overdue: 99, claimsPaused: true }), "worker.backlog");
    assert.equal(paused.status, "ATTENTION");
    assert.match(paused.reason, /paused by ClientTurn/);
    assert.match(paused.reason, /99 tasks waiting/);
    // Operators are support: their copy names the flag instead.
    const adminPaused = row(checkWorker({ ...base, overdue: 99, claimsPaused: true }, "admin"), "worker.backlog");
    assert.match(adminPaused.reason, /job_claims_paused/);
    assert.match(adminPaused.reason, /99 tasks are waiting/);
    assert.doesNotMatch(adminPaused.reason, /Contact support/);
  });
});

/* --------------------------------------------------------------- report */

describe("Report", () => {
  test("roll-up: attention beats unknown beats ready; all-off is off", () => {
    const r = (status: CheckRow["status"]): CheckRow => ({ id: status, label: status, status, reason: "", fix: null });
    assert.equal(rollup([r("READY"), r("ATTENTION"), r("UNKNOWN")]), "ATTENTION");
    assert.equal(rollup([r("READY"), r("UNKNOWN")]), "UNKNOWN");
    assert.equal(rollup([r("OFF"), r("OFF")]), "OFF");
    assert.equal(rollup([r("OFF"), r("READY")]), "READY");
  });

  test("problems sort first and counts add up; a failed engine read is 'couldn't check'", () => {
    const report = buildReport([checkAi(AI_ON), unknownEngine("worker"), checkVoice({ ...VOICE, minutes: { available: false, includedRemainingMin: 0, packRemainingMin: 0 } }, NOON)], NOON, TZ);
    assert.deepEqual(report.engines.map((e) => e.id), ["voice", "worker", "ai"]);
    assert.equal(report.counts.ATTENTION + report.counts.UNKNOWN + report.counts.READY + report.counts.OFF, 3);
    assert.equal(report.timezone, TZ);
  });

  test("every fix link targets a real Settings section or voice panel, and every #anchor exists in the source", () => {
    const sections = new Set(SETTINGS_SECTIONS.map((s) => s.id as string));
    const panels = new Set(VOICE_PANELS.map((p) => p.key as string));
    const source = collectSource(path.join(process.cwd(), "src", "components"));
    for (const fix of [...Object.values(FIX), { href: SYSTEM_CHECK_HREF, label: "" }]) {
      const url = new URL(fix.href, "https://app.example");
      assert.ok(url.pathname.startsWith("/app"), fix.href);
      if (url.pathname === "/app/settings") {
        assert.ok(sections.has(url.searchParams.get("section") ?? ""), `unknown section in ${fix.href}`);
        const panel = url.searchParams.get("panel");
        if (panel) assert.ok(panels.has(panel), `unknown voice panel in ${fix.href}`);
      }
      if (url.hash) assert.ok(source.includes(`id="${url.hash.slice(1)}"`), `no element with id="${url.hash.slice(1)}" for ${fix.href}`);
    }
  });
});

function collectSource(dir: string): string {
  let out = "";
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out += collectSource(full);
    else if (name.endsWith(".tsx")) out += readFileSync(full, "utf8");
  }
  return out;
}

/* ------------------------------------------------------- permission wiring */

describe("Permission states (source wiring)", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  test("Settings: signed-in workspace only, read-only notice for members and viewers, error state", () => {
    const src = read("src/app/(app)/app/settings/_sections/system-check-section.tsx");
    assert.match(src, /requireWorkspace\(\)/);
    assert.match(src, /!hasRole\(workspace\.role, "admin"\)[\s\S]*ReadOnlyNotice/);
    assert.match(src, /SectionLoadError/);
    assert.match(src, /audience: "customer"/);
  });

  test("Admin: platform admin only, audited, rendered read-only", () => {
    const lib = read("src/lib/admin/system-check.ts");
    assert.match(lib, /requirePlatformAdmin\(\)/);
    assert.match(lib, /admin\.support_view/);
    assert.match(lib, /audience: "admin"/);
    assert.match(read("src/components/admin/customers/customer-support-drawer.tsx"), /<SystemCheckReportView[^>]*readOnly/);
  });

  test("the read-only report never renders fix links, and status is text, not colour alone", () => {
    const view = read("src/components/system-check/system-check-report.tsx");
    assert.match(view, /readOnly \? \(/);
    assert.match(view, /StatusBadge kind="system_check"/);
    assert.match(read("src/components/ui/badge.tsx"), /system_check: SYSTEM_CHECK_STATUS/);
  });
});

/* -------------------------------------------------------------- per lead */

const LEAD: LeadWhyFacts = {
  lead: { status: "NEW", optedOut: false, humanTakeover: false, automationActive: true, firstRepliedAt: null, archived: false, anonymised: false },
  sendingAllowed: true,
  quietHours: { enabled: true, start: "20:00", end: "08:00", timezone: TZ },
  aiMode: "AUTO_REPLY",
  runs: [{ state: "ACTIVE", nextRunAt: "2026-09-29T14:00:00Z", stoppedReason: null, stoppedAt: null }],
  channels: [{ channel: "SMS", decision: "ALLOWED", reason: "Lead-form mobile" }],
  lastOutboundAt: "2026-09-29T09:00:00Z",
  lastInboundAt: null,
  failedSends: [],
  failedCalls: [],
};

describe("Why hasn't anything happened?", () => {
  test("a scheduled next step reads as nothing wrong, with the time", () => {
    const why = explainLead(LEAD, NOON);
    assert.ok(why.next);
    assert.match(why.headline, /Nothing is wrong/);
    assert.ok(why.items.some((i) => i.id === "waiting"));
  });

  test("opted out, human takeover and paused use the send guard's stop rule", () => {
    assert.equal(explainLead({ ...LEAD, lead: { ...LEAD.lead, optedOut: true } }, NOON).items[0].id, "stop.opted_out");
    assert.equal(explainLead({ ...LEAD, lead: { ...LEAD.lead, humanTakeover: true } }, NOON).items[0].id, "stop.human_takeover");
    const paused = explainLead({ ...LEAD, lead: { ...LEAD.lead, automationActive: false } }, NOON);
    assert.equal(paused.items[0].id, "stop.paused");
    assert.equal(paused.next, null, "no next step is promised while a stop condition holds");
  });

  test("billing pause links to billing", () => {
    const why = explainLead({ ...LEAD, sendingAllowed: false }, NOON);
    assert.equal(why.items.find((i) => i.id === "stop.subscription_inactive")?.fix, FIX.billing);
  });

  test("no lawful channel, and quiet hours moving the next step", () => {
    const blocked = explainLead({ ...LEAD, channels: [{ channel: "EMAIL", decision: "REQUIRE_CONSENT", reason: "Individual subscriber" }] }, NOON);
    assert.ok(blocked.items.some((i) => i.id === "channels.none" && i.tone === "blocked"));
    const night = explainLead({ ...LEAD, runs: [{ state: "ACTIVE", nextRunAt: "2026-09-29T22:00:00Z", stoppedReason: null, stoppedAt: null }] }, NIGHT);
    assert.match(night.next?.label ?? "", /after quiet hours/);
    assert.ok(night.items.some((i) => i.id === "quiet"));
  });

  test("stopped sequence, AI off with a reply, and refusal reasons from calls and sends", () => {
    const why = explainLead(
      {
        ...LEAD,
        lead: { ...LEAD.lead, firstRepliedAt: "2026-09-29T09:30:00Z" },
        aiMode: "OFF",
        runs: [{ state: "STOPPED", nextRunAt: null, stoppedReason: "replied", stoppedAt: "2026-09-29T09:30:00Z" }],
        failedSends: [{ at: "2026-09-29T08:00:00Z", channel: "SMS", error: "Unreachable handset" }],
        failedCalls: [{ at: "2026-09-29T08:30:00Z", state: "CANCELLED", reasons: ["OUTSIDE_CALLING_HOURS"], disconnection: null }],
      },
      NOON,
    );
    assert.equal(why.items[0].id, "stop.replied");
    assert.equal(why.items.find((i) => i.id === "ai.off")?.fix, FIX.aiAssistant);
    assert.ok(why.items.some((i) => i.detail.includes("Unreachable handset")));
    assert.ok(why.items.some((i) => i.title === "An AI call didn't go ahead"));
  });

  test("call refusals read in the dial decision's own words", () => {
    assert.equal(callRefusalText({ state: "CANCELLED", reasons: [], disconnection: "NO_MINUTES" }), ENTITLEMENT_MESSAGES.NO_MINUTES);
    assert.match(callRefusalText({ state: "FAILED", reasons: [], disconnection: null }), /failed/);
  });

  test("an erased lead says so and nothing else", () => {
    const why = explainLead({ ...LEAD, lead: { ...LEAD.lead, anonymised: true } }, NOON);
    assert.equal(why.items.length, 0);
    assert.match(why.headline, /erased/);
  });
});
