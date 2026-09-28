/**
 * An in-memory world for the voice runtime tests: a VoiceRepo with the same
 * compare-and-swap semantics as the Supabase one (and the 0157 RPC), the
 * in-memory minute store, and the P1 fakes. No network, no database, no spend.
 * Not a test file itself (no `.test.ts`).
 */

import { InMemoryMinuteStore } from "../src/lib/voice/minutes-core.ts";
import { FakeNumberProvider, FakeVoiceProvider } from "../src/lib/voice/providers/fake.ts";
import { newProvisioningRecord, type ProvisioningRecord, type StepLogEntry } from "../src/lib/voice/numbers/provisioning.ts";
import type { EntitlementFacts, PermissionRow } from "../src/lib/voice/snapshot.ts";
import type { CallState } from "../src/lib/voice/state-machine.ts";
import type {
  AdminControls,
  AuditEntry,
  BeginDialResult,
  CallRow,
  DialContext,
  EligibilityRecord,
  LeadRow,
  NewCallRow,
  VoiceDeps,
  VoiceRepo,
  VoiceSettingsRow,
} from "../src/lib/voice/runtime-core.ts";

export const BIZ = "11111111-1111-4111-8111-111111111111";
export const LEAD = "22222222-2222-4222-8222-222222222222";
export const LEAD2 = "33333333-3333-4333-8333-333333333333";

const ACTIVE: CallState[] = ["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"];
const ATTEMPTED: CallState[] = ["DIALLING", "RINGING", "ANSWERED", "VOICEMAIL", "NO_ANSWER", "BUSY", "FAILED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED", "ENDED", "POST_PROCESSING", "COMPLETE"];

export function paidFacts(overrides: Partial<EntitlementFacts> = {}): EntitlementFacts {
  return {
    plan: "pro",
    subscriptionStatus: "ACTIVE",
    businessStatus: "ACTIVE",
    voiceCapability: true,
    grants: { proVoiceItem: true, numberItem: false },
    packsHeld: false,
    balance: { includedRemainingSec: 200 * 60, packRemainingSec: 0 },
    platformKill: false,
    settings: {
      voice_enabled: true,
      admin_kill_switch: false,
      calling_as_name: "Acme Studio",
      legal_entity_name: "Acme Studio Ltd",
      identification_contact: "1 High Street, London, EC1A 1AA",
      assistant_persona_name: "Sam",
    },
    number: { provisioning_state: "ACTIVE", e164: "+447700900111" },
    ...overrides,
  };
}

export function settingsRow(overrides: Partial<VoiceSettingsRow> = {}): VoiceSettingsRow {
  return {
    voice_enabled: true,
    admin_kill_switch: false,
    calling_as_name: "Acme Studio",
    legal_entity_name: "Acme Studio Ltd",
    identification_contact: "1 High Street, London, EC1A 1AA",
    assistant_persona_name: "Sam",
    opener_suffix: null,
    recording_enabled: true,
    recording_retention_days: 90,
    voicemail_enabled: false,
    // Every day open all day (within the legal bounds) so the clock never defers a test.
    calling_hours: {
      days: Array.from({ length: 7 }, () => ({ start: "08:00", end: "21:00" })),
      callOnBankHolidays: true,
    },
    max_attempts: 3,
    workspace_concurrency: 2,
    transfer_number_e164: null,
    provider_agent_id: "agent_1",
    ...overrides,
  };
}

export function leadRow(id = LEAD, overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id,
    business_id: BIZ,
    first_name: "Priya",
    phone: "+447700900123",
    email: "priya@example.com",
    phone_source: "LEAD_FORM",
    timezone: "Europe/London",
    uk_region: "ENGLAND_AND_WALES",
    anonymised_at: null,
    opted_out: false,
    human_takeover: false,
    subscriber_type: "CORPORATE",
    qualification_state: "PENDING",
    source_submitted_at: "2026-09-28T09:00:00.000Z",
    created_at: "2026-09-28T09:00:00.000Z",
    ...overrides,
  };
}

export function permissionRow(overrides: Partial<PermissionRow> = {}): PermissionRow {
  return {
    consent_scope: ["SMS", "CALL_REQUESTED"],
    consent_status: "GRANTED",
    consent_captured_at: "2026-09-28T09:00:00.000Z",
    call_consent_wording: "Please call me about my enquiry",
    subscriber_type: "CORPORATE",
    tps_listed: null,
    ctps_listed: null,
    ...overrides,
  };
}

export type Job = { type: string; payload: Record<string, unknown>; runAt: Date | undefined; key: string };

export class VoiceWorld {
  now = new Date("2026-09-28T11:00:00.000Z"); // a Monday, 12:00 in London
  facts: EntitlementFacts = paidFacts();
  settings: VoiceSettingsRow = settingsRow();
  leads = new Map<string, LeadRow>([[LEAD, leadRow()], [LEAD2, leadRow(LEAD2, { phone: "+447700900124" })]]);
  permissions = new Map<string, PermissionRow>([[LEAD, permissionRow()], [LEAD2, permissionRow()]]);
  suppressed = new Set<string>();
  calls = new Map<string, CallRow>();
  events: { provider: string; dedupeKey: string; applied: boolean; eventType: string }[] = [];
  eligibility: EligibilityRecord[] = [];
  audits: AuditEntry[] = [];
  jobs: Job[] = [];
  outcomes = new Map<string, { disposition: string; summary: string | null; nextAction?: string | null; callbackRequestedFor?: string | null }>();
  /** Successful in-call tool results per call (voice_tool_calls status OK), oldest first. */
  toolOutcomes = new Map<string, { tool: string; data: Record<string, unknown> }[]>();
  objections: { callId: string; key: string }[] = [];
  costs: { idempotencyKey: string; totalUsd: number; estimated: boolean }[] = [];
  optOuts: string[] = [];
  /** The scope of each opt-out, in order (voice QA pass: ALL propagates to every channel). */
  optOutScopes: string[] = [];
  signals: string[] = [];
  nextActions: string[] = [];
  numbers = new Map<string, { id: string; record: ProvisioningRecord }>();
  numberEvents: StepLogEntry[] = [];
  details: unknown = {};
  telephonyAccounts: string[] = [];
  notifications: string[] = [];
  minutes = new InMemoryMinuteStore();
  voice: FakeVoiceProvider | null = new FakeVoiceProvider();
  numbersProvider: FakeNumberProvider | null = new FakeNumberProvider();
  platformActive = 0;
  /** The platform operator's controls (0158). */
  adminControls: AdminControls | null = null;
  /** Simulates a crash: the next number record save is lost. */
  dropNextNumberSave = false;
  private seq = 0;

  constructor() {
    this.minutes.balanceOf(BIZ).includedRemainingSec = 200 * 60;
    this.minutes.balanceOf(BIZ).periodIncludedSec = 200 * 60;
  }

  id(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }

  providerCalls(): number {
    return this.voice ? this.voice.log.filter((l) => l.method === "startOutboundCall").length : 0;
  }

  context(leadId: string, route: string, exclude: string | null): DialContext {
    const lead = this.leads.get(leadId) ?? null;
    const calls = [...this.calls.values()].filter((c) => c.lead_id === leadId && c.id !== exclude);
    const attempted = calls.filter((c) => ATTEMPTED.includes(c.state));
    const last = attempted.map((c) => Date.parse(c.started_at ?? c.created_at)).sort((a, b) => b - a)[0];
    return {
      lead,
      permission: this.permissions.get(leadId) ?? null,
      suppressed: lead?.phone ? this.suppressed.has(lead.phone) : false,
      voiceOptedOut: false,
      settings: this.settings,
      number: this.facts.number ? { businessId: BIZ, state: this.facts.number.provisioning_state as never, e164: this.facts.number.e164, messagingServiceSid: "MG1" } : null,
      workspaceTimezone: "Europe/London",
      attempts: {
        total: attempted.length,
        last24h: attempted.filter((c) => Date.parse(c.started_at ?? c.created_at) >= this.now.getTime() - 86_400_000).length,
        lastAttemptAt: last ? new Date(last) : null,
        routeTotal: calls.filter((c) => c.route === route).length,
      },
      activeCallForLead: calls.some((c) => ACTIVE.includes(c.state)),
      pendingCalls: calls
        .filter((c) => c.state === "REQUESTED" || c.state === "ELIGIBILITY_CHECKED" || c.state === "QUEUED")
        .map((c) => ({ id: c.id, route: c.route, queuedAt: c.queued_at ?? null })),
      concurrency: {
        workspaceActive: [...this.calls.values()].filter((c) => ACTIVE.includes(c.state)).length,
        platformActive: this.platformActive,
      },
      allocation: null,
      adminControls: this.adminControls,
    };
  }

  repo(): VoiceRepo {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the repo methods close over the world
    const w = this;
    return {
      async loadCall(id) {
        const c = w.calls.get(id);
        return c ? { ...c } : null;
      },
      async findCallByProviderId(pid) {
        const c = [...w.calls.values()].find((x) => x.provider_call_id === pid || x.carrier_call_sid === pid);
        return c ? { ...c } : null;
      },
      async findCallByKey(b, key) {
        const c = [...w.calls.values()].find((x) => x.business_id === b && x.call_key === key);
        return c ? { ...c } : null;
      },
      async insertCall(row: NewCallRow) {
        const existing = [...w.calls.values()].find((x) => x.business_id === row.business_id && x.call_key === row.call_key);
        if (existing) return { row: { ...existing }, inserted: false };
        const full: CallRow = {
          ...row,
          id: w.id(),
          created_at: w.now.toISOString(),
          provider: null,
          provider_call_id: null,
          carrier_call_sid: null,
          outcome: null,
          disconnection_reason: null,
          duration_sec: null,
          billed_sec: null,
          reserved_sec: null,
          voicemail_left: false,
          started_at: null,
          answered_at: null,
          ended_at: null,
        };
        w.calls.set(full.id, full);
        return { row: { ...full }, inserted: true };
      },
      async transitionCall(id, from, patch) {
        const c = w.calls.get(id);
        if (!c || !from.includes(c.state)) return null;
        const next = { ...c, ...patch } as CallRow;
        // The one-active-call-per-lead unique index.
        if (patch.state && ACTIVE.includes(patch.state) && [...w.calls.values()].some((o) => o.id !== id && o.lead_id === c.lead_id && ACTIVE.includes(o.state))) return null;
        w.calls.set(id, next);
        return { ...next };
      },
      async patchCall(id, patch) {
        const c = w.calls.get(id);
        if (c) w.calls.set(id, { ...c, ...patch } as CallRow);
      },
      async loadEntitlementFacts() {
        return { ...w.facts, balance: { includedRemainingSec: w.minutes.balanceOf(BIZ).includedRemainingSec, packRemainingSec: w.minutes.balanceOf(BIZ).packRemainingSec } };
      },
      async loadDialContext(_b, leadId, route, exclude) {
        return w.context(leadId, route, exclude);
      },
      async recordEligibility(r) {
        w.eligibility.push(r);
      },
      async beginDial(input): Promise<BeginDialResult> {
        const c = w.calls.get(input.callId);
        if (!c) return "NOT_FOUND";
        if (c.state !== "QUEUED") return "NOT_QUEUED";
        if (w.leads.get(c.lead_id)?.human_takeover) return "HUMAN_ACTIVE";
        if ([...w.calls.values()].some((o) => o.id !== c.id && o.lead_id === c.lead_id && ACTIVE.includes(o.state))) return "LEAD_BUSY";
        if (w.platformActive >= input.platformLimit) return "PLATFORM_FULL";
        if ([...w.calls.values()].filter((o) => ACTIVE.includes(o.state)).length >= input.workspaceLimit) return "WORKSPACE_FULL";
        w.calls.set(c.id, { ...c, state: "DIALLING", started_at: w.now.toISOString() });
        return "OK";
      },
      async queueCall() {},
      async dequeueCall() {},
      async insertCallEvent(row) {
        if (w.events.some((e) => e.provider === row.provider && e.dedupeKey === row.dedupeKey)) return false;
        w.events.push({ provider: row.provider, dedupeKey: row.dedupeKey, applied: row.applied, eventType: row.eventType });
        return true;
      },
      async saveTranscript() {},
      async saveOutcome(input) {
        w.outcomes.set(input.callId, {
          disposition: input.analysis.disposition,
          summary: input.analysis.summary,
          nextAction: input.analysis.nextAction,
          callbackRequestedFor: input.analysis.callbackRequestedFor,
        });
      },
      async findStaleLiveCalls({ startedBefore, limit }) {
        const live = ["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"];
        return [...w.calls.values()]
          .filter((c) => live.includes(c.state) && Date.parse(c.created_at) < startedBefore.getTime())
          .slice(0, limit)
          .map((c) => ({ ...c }));
      },
      async loadToolOutcomes(callId) {
        return (w.toolOutcomes.get(callId) ?? []).map((t) => ({ ...t }));
      },
      async saveObjections(input) {
        for (const o of input.objections) if (!w.objections.some((x) => x.callId === input.callId && x.key === o.key)) w.objections.push({ callId: input.callId, key: o.key });
      },
      async saveCostLines(input) {
        for (const l of input.lines) if (!w.costs.some((c) => c.idempotencyKey === l.idempotencyKey)) w.costs.push({ idempotencyKey: l.idempotencyKey, totalUsd: l.totalUsd, estimated: l.estimated });
      },
      async recordVoiceOptOut(input) {
        if (input.phone) w.optOuts.push(input.phone);
        w.optOutScopes.push(input.scope ?? "CALLS");
      },
      async writeQualificationSignals(input) {
        w.signals.push(input.callId);
      },
      async saveRecording() {},
      async loadRecording() {
        return null;
      },
      async setLeadNextAction(input) {
        w.nextActions.push(input.nextAction);
      },
      async loadNumberRecord(b) {
        const n = w.numbers.get(b);
        return n ? { id: n.id, record: { ...n.record } } : null;
      },
      async createNumberRecord(b) {
        const n = { id: w.id(), record: newProvisioningRecord(b) };
        w.numbers.set(b, n);
        return { id: n.id, record: { ...n.record } };
      },
      async saveNumberRecord({ id, record, expectedVersion }) {
        const n = [...w.numbers.values()].find((x) => x.id === id);
        if (!n || n.record.version !== expectedVersion) return false;
        if (w.dropNextNumberSave) {
          w.dropNextNumberSave = false;
          throw new Error("simulated crash before the record was saved");
        }
        n.record = { ...record };
        return true;
      },
      async appendNumberEvents({ log }) {
        for (const l of log) if (!w.numberEvents.some((e) => e.idempotencyKey === l.idempotencyKey)) w.numberEvents.push(l);
      },
      async loadProvisioningDetails() {
        return w.details;
      },
      async findNumberByBundle(bundleSid) {
        for (const [b, n] of w.numbers) if (n.record.bundleSid === bundleSid) return { id: n.id, businessId: b, record: { ...n.record } };
        return null;
      },
      async quarantinedE164s() {
        return new Set<string>();
      },
      async upsertTelephonyAccount({ subaccountSid }) {
        if (!w.telephonyAccounts.includes(subaccountSid)) w.telephonyAccounts.push(subaccountSid);
      },
      async notifyOwner(input) {
        w.notifications.push(input.title);
      },
      async audit(entry) {
        w.audits.push(entry);
      },
    };
  }

  deps(): VoiceDeps {
    return {
      now: () => this.now,
      repo: this.repo(),
      minutes: this.minutes,
      providers: () => ({ voice: this.voice, telephony: null, numbers: this.numbersProvider }),
      enqueue: async (type, payload, options) => {
        this.jobs.push({ type, payload, runAt: options.runAt, key: options.idempotencyKey });
      },
      config: {
        defaultAgentId: null,
        platformKill: false,
        provisioningUrls: {
          voiceWebhookUrl: "https://app.example.com/api/webhooks/twilio/voice",
          voiceStatusCallbackUrl: "https://app.example.com/api/webhooks/twilio/voice",
          smsInboundUrl: "https://app.example.com/api/webhooks/twilio",
          bundleStatusCallbackUrl: "https://app.example.com/api/webhooks/twilio/regulatory",
        },
      },
    };
  }
}

export function validDetails(): Record<string, unknown> {
  return {
    callingAsName: "Acme Studio",
    legalEntityName: "Acme Studio Ltd",
    identificationContact: "1 High Street, London, EC1A 1AA",
    companyNumber: "12345678",
    websiteUrl: "https://acme.example.com",
    registeredAddress: { line1: "1 High Street", city: "London", postcode: "EC1A 1AA", country: "GB" },
    representative: { firstName: "Jo", lastName: "Bloggs", phone: "+447700900555", workEmail: "jo@acme.example.com" },
    notificationEmail: "ops@example.com",
  };
}
