/**
 * Voice agent wiring harness (no phone call, no paid spend).
 *
 * Replays exactly what Retell sends during a call (signed call webhooks and
 * signed custom-function calls) against the REAL ClientTurn code, on the
 * DEMO workspace "Blackwellen Ltd" (slug blackwellen-demo, job_claims_paused),
 * and asserts the database effect of every step. Only the provider HTTP is
 * faked, at the network edge (scripts/lib/voice-e2e-fakes.mjs); every other
 * host is refused (scripts/lib/egress-guard.mjs).
 *
 * Two transports:
 *   - HTTP: a local `next dev` started with the guard and the fakes preloaded
 *     (scripts/voice-e2e-wiring.mjs starts it), requests signed like Retell;
 *   - in-process: the same route handlers' POST functions called directly
 *     (tests/voice-e2e-wiring.test.ts).
 *
 * Jobs the steps queue are run here, in-process, one by one (the demo
 * workspace's claims are paused, so the deployed worker never runs them);
 * only the voice / qualification types the chain needs run, never a send.
 *
 * Everything this creates is removed at the end (the lead, its calls and
 * bookings cascade; jobs, webhook rows, integrations and settings are put
 * back explicitly). The owner's real workspace is never touched.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { signRetellBody } from "../../src/lib/voice/providers/retell-protocol.ts";

export const DEMO_SLUG = "blackwellen-demo";
export const FAKE_RETELL_KEY = "voice-e2e-fake-retell-key";

export type Json = Record<string, unknown>;

export type Check = { step: string; name: string; ok: boolean; detail?: string };
export type Latency = { tool: string; ms: number; status: number; ok: boolean | null; code: string | null };

export type HarnessOptions = {
  /** http://localhost:3107 for the HTTP transport; absent = in-process. */
  baseUrl?: string | null;
  statePath: string;
  logPath: string;
  /** Which calendar the booking scenario uses. */
  calendars?: readonly ("google" | "calendly" | "none")[];
  verbose?: boolean;
  /**
   * REAL mode: sign with this key (the deployed RETELL_SECRET_KEY) instead of
   * the fake one, and expect no provider fakes to be loaded.
   */
  retellKey?: string;
};

export type HarnessReport = { checks: Check[]; latencies: Latency[]; failures: Check[]; notes: string[] };

/* ------------------------------------------------------------ utilities */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`voice-e2e: ${what}`);
  return value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The next weekday at hh:mm Europe/London, as an ISO instant (handles BST/GMT). */
export function londonInstant(day: Date, hh: number, mm = 0): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
  // Try both offsets; keep the one whose London wall clock reads hh:mm.
  for (const offset of ["+01:00", "+00:00"]) {
    const candidate = new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${offset}`);
    const wall = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(candidate);
    if (wall === `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`) return candidate.toISOString();
  }
  throw new Error(`no London instant for ${ymd} ${hh}:${mm}`);
}

export function londonParts(iso: string): { weekday: string; hhmm: string; ymd: string } {
  const d = new Date(iso);
  return {
    weekday: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(d).toLowerCase(),
    hhmm: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d),
    ymd: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d),
  };
}

/** The next open weekday (Mon-Fri) at least `minDays` ahead, in London. */
export function nextWeekday(from: Date, minDays = 1): Date {
  const d = new Date(from.getTime() + minDays * 86_400_000);
  for (let i = 0; i < 7; i++) {
    const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(d);
    if (wd !== "Sat" && wd !== "Sun") return d;
    d.setTime(d.getTime() + 86_400_000);
  }
  return d;
}

/* --------------------------------------------------------------- harness */

export class VoiceHarness {
  readonly opts: HarnessOptions;
  readonly admin: SupabaseClient;
  readonly run = randomUUID().slice(0, 8);
  readonly startedAt = new Date();
  checks: Check[] = [];
  latencies: Latency[] = [];
  notes: string[] = [];
  businessId = "";
  step = "setup";
  /** Rows to put back or remove. */
  private restore: { table: string; match: Json; row: Json }[] = [];
  private createdIntegrations: string[] = [];
  private createdLeads: string[] = [];
  private createdServices: string[] = [];
  private minuteGrantKey: string | null = null;

  constructor(opts: HarnessOptions) {
    this.opts = opts;
    const url = must(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL unset");
    const key = must(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY unset");
    this.admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }

  log(...args: unknown[]) {
    if (this.opts.verbose) console.log(`[voice-e2e ${this.step}]`, ...args);
  }

  check(name: string, ok: boolean, detail?: unknown) {
    const d = detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 600);
    this.checks.push({ step: this.step, name, ok, detail: d });
    if (this.opts.verbose || !ok) console.log(`${ok ? "  ok  " : "  FAIL"} [${this.step}] ${name}${d && !ok ? ` :: ${d}` : ""}`);
  }

  /* ------------------------------------------------------ fakes state */

  state(): Json {
    try {
      return JSON.parse(readFileSync(this.opts.statePath, "utf8")) as Json;
    } catch {
      return {};
    }
  }

  setState(patch: Json) {
    writeFileSync(this.opts.statePath, JSON.stringify({ ...this.state(), ...patch }, null, 2));
  }

  providerLog(): { host: string; path: string; method: string; body: string | null; status: number | string; search: string }[] {
    if (!existsSync(this.opts.logPath)) return [];
    return readFileSync(this.opts.logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  /* --------------------------------------------------------- transport */

  private async send(path: string, body: string, headers: Record<string, string>): Promise<{ status: number; json: Json | null; ms: number }> {
    const started = performance.now();
    let res: Response;
    if (this.opts.baseUrl) {
      res = await fetch(`${this.opts.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    } else {
      const request = new Request(`http://voice-e2e.local${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
      const tool = /^\/api\/voice\/tools\/(.+)$/.exec(path)?.[1];
      if (tool) {
        const mod = await import("../../src/app/api/voice/tools/[tool]/route.ts");
        res = await mod.POST(request, { params: Promise.resolve({ tool }) });
      } else {
        const mod = await import("../../src/app/api/webhooks/retell/route.ts");
        res = await mod.POST(request);
      }
    }
    const ms = Math.round(performance.now() - started);
    const text = await res.text();
    let json: Json | null = null;
    try {
      json = text ? (JSON.parse(text) as Json) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, ms };
  }

  signed(body: string, key = this.opts.retellKey ?? FAKE_RETELL_KEY): Record<string, string> {
    return { "x-retell-signature": signRetellBody(body, Date.now(), key) };
  }

  async webhook(event: string, call: Json): Promise<number> {
    const body = JSON.stringify({ event, call });
    const r = await this.send("/api/webhooks/retell", body, this.signed(body));
    this.log("webhook", event, r.status);
    return r.status;
  }

  async tool(
    call: { id: string; providerCallId: string },
    name: string,
    args: Json,
    opts: { toolCallId?: string; key?: string } = {},
  ): Promise<{ status: number; json: Json | null; ms: number }> {
    const body = JSON.stringify({
      name,
      ...(opts.toolCallId ? { tool_call_id: opts.toolCallId } : {}),
      call: { call_id: call.providerCallId, metadata: { voice_call_id: call.id }, transcript_with_tool_calls: [] },
      args,
    });
    const r = await this.send(`/api/voice/tools/${name}`, body, this.signed(body, opts.key));
    this.latencies.push({ tool: name, ms: r.ms, status: r.status, ok: typeof r.json?.ok === "boolean" ? (r.json.ok as boolean) : null, code: (r.json?.code as string) ?? null });
    this.log("tool", name, r.status, r.ms, "ms", JSON.stringify(r.json).slice(0, 400));
    return r;
  }

  /* ------------------------------------------------------------- jobs */

  static readonly RUNNABLE = new Set([
    "voice.webhook_ingest",
    "voice.post_call",
    "lead.score",
    "lead.qualify",
    "voice.retry",
  ]);

  /**
   * Runs the pending jobs this run queued (created since the start, for the
   * demo workspace or with no workspace but naming this run's call or lead),
   * of the runnable types only, until none is left. Returns what ran.
   */
  async runJobs(ref: { leadIds: string[]; callIds: string[] }, opts: { types?: string[]; fastForward?: boolean } = {}): Promise<{ type: string; ok: boolean; error?: string }[]> {
    const { handleJob } = await import("../../src/lib/jobs/registry.ts");
    const { registerJobHandlers } = await import("../../src/lib/jobs/register.ts");
    registerJobHandlers();
    const ran: { type: string; ok: boolean; error?: string }[] = [];
    const types = opts.types ?? [...VoiceHarness.RUNNABLE];
    for (let loop = 0; loop < 40; loop++) {
      const { data, error } = await this.admin
        .from("jobs")
        .select("id, type, business_id, payload, attempts, max_attempts, run_at, created_at")
        .eq("state", "pending")
        .in("type", types)
        .gte("created_at", this.startedAt.toISOString())
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      const mine = (data ?? []).filter((j) => {
        const p = JSON.stringify(j.payload ?? {});
        const ours = ref.leadIds.some((id) => p.includes(id)) || ref.callIds.some((id) => p.includes(id)) || (j.type === "voice.webhook_ingest" && ref.callIds.some((id) => p.includes(id.slice(0, 8))));
        const due = opts.fastForward || Date.parse(j.run_at as string) <= Date.now() + 1000;
        return (j.business_id === this.businessId || j.business_id === null) && ours && due;
      });
      // webhook_ingest payloads carry the provider event id (call_<run>...:event), not our ids.
      const ingest = (data ?? []).filter((j) => j.type === "voice.webhook_ingest" && String((j.payload as Json)?.externalEventId ?? "").includes(this.run));
      const next = [...ingest, ...mine.filter((j) => !ingest.includes(j))][0];
      if (!next) return ran;
      const claimed = await this.admin
        .from("jobs")
        .update({ state: "running", locked_at: new Date().toISOString(), locked_by: `voice-e2e-${this.run}`, attempts: (next.attempts as number) + 1 })
        .eq("id", next.id)
        .eq("state", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed.data) continue;
      try {
        await handleJob({
          id: next.id as string,
          type: next.type as never,
          business_id: next.business_id as string | null,
          payload: next.payload as Json,
          attempts: (next.attempts as number) + 1,
          max_attempts: next.max_attempts as number,
        });
        await this.admin.from("jobs").update({ state: "completed", completed_at: new Date().toISOString(), locked_at: null }).eq("id", next.id);
        ran.push({ type: next.type as string, ok: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await this.admin.from("jobs").update({ state: "dead", last_error: `voice-e2e: ${message.slice(0, 1500)}`, locked_at: null }).eq("id", next.id);
        ran.push({ type: next.type as string, ok: false, error: message });
      }
    }
    return ran;
  }

  /**
   * The ingest job is queued with no workspace (webhook-inbox.ts), so the
   * deployed worker may claim it before this run does: wait for it to finish
   * there, and record who ran it.
   */
  async explainIngest(providerCallId: string) {
    for (let i = 0; i < 20; i++) {
      const { data } = await this.admin.from("jobs").select("id, state, locked_by, last_error").eq("type", "voice.webhook_ingest").like("idempotency_key", `%${providerCallId}%`);
      const rows = (data ?? []) as { state: string; locked_by: string | null; last_error: string | null }[];
      if (rows.length && rows.every((r) => r.state === "completed" || r.state === "dead")) {
        this.notes.push(`webhook ingest for ${providerCallId} ran elsewhere: ${JSON.stringify(rows)}`);
        return;
      }
      if (!rows.length) {
        this.notes.push(`no webhook ingest job found for ${providerCallId}`);
        return;
      }
      await sleep(2000);
    }
    this.notes.push(`webhook ingest for ${providerCallId} still not done after 40 s`);
  }

  /* ------------------------------------------------------------ setup */

  async snapshot(table: string, match: Json, columns: string) {
    let q = this.admin.from(table).select(columns);
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v as string);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    if (data) this.restore.push({ table, match, row: data as unknown as Json });
  }

  async setup(): Promise<void> {
    const { data: biz, error } = await this.admin.from("businesses").select("id, name, job_claims_paused, timezone").eq("slug", DEMO_SLUG).maybeSingle();
    if (error) throw error;
    const b = must(biz, "the demo workspace was not found") as { id: string; name: string; job_claims_paused: boolean; timezone: string };
    if (!b.job_claims_paused) throw new Error("voice-e2e: the demo workspace's job claims are not paused; refusing to run.");
    if (b.name !== "Blackwellen Ltd") throw new Error(`voice-e2e: unexpected demo workspace name ${b.name}`);
    this.businessId = b.id;
    await this.snapshot("business_settings", { business_id: b.id }, "booking_mode, booking_url, ai_assist_enabled, business_hours, appointment_duration_minutes, booking_buffer_minutes");
    await this.snapshot("voice_settings", { business_id: b.id }, "voice_enabled, transfer_mode, transfer_number_e164");
    // Leftovers of an earlier, interrupted run are removed first.
    await this.sweepLeftovers();
  }

  /** Removes anything an interrupted earlier run left (names carry the marker). */
  async sweepLeftovers() {
    const { data: leads } = await this.admin.from("leads").select("id").eq("business_id", this.businessId).like("first_name", "Voicee2e%");
    for (const l of leads ?? []) await this.deleteLead(l.id as string);
    await this.admin.from("integrations").delete().eq("business_id", this.businessId).like("display_name", "voice-e2e%");
  }

  async setSettings(patch: Json) {
    const { error } = await this.admin.from("business_settings").update(patch).eq("business_id", this.businessId);
    if (error) throw error;
  }

  async setVoiceSettings(patch: Json) {
    const { error } = await this.admin.from("voice_settings").update(patch).eq("business_id", this.businessId);
    if (error) throw error;
  }

  /** A calendar integration with a fake token (the fakes answer its provider). */
  async connectCalendar(kind: "google" | "calendly"): Promise<string> {
    const provider = kind === "google" ? "google_calendar" : "calendly";
    await this.admin.from("integrations").delete().eq("business_id", this.businessId).eq("provider_type", provider).like("display_name", "voice-e2e%");
    const { data: existing } = await this.admin.from("integrations").select("id").eq("business_id", this.businessId).eq("provider_type", provider).maybeSingle();
    if (existing) throw new Error(`voice-e2e: the demo workspace already has a real ${provider} connection; refusing to replace it.`);
    const { data, error } = await this.admin
      .from("integrations")
      .insert({
        business_id: this.businessId,
        provider_type: provider,
        status: "HEALTHY",
        display_name: `voice-e2e ${kind}`,
        config: kind === "google" ? { calendar_ids: ["primary"] } : { event_type_uri: "https://api.calendly.com/event_types/voice-e2e", organizationUri: "https://api.calendly.com/organizations/voice-e2e" },
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = (data as { id: string }).id;
    this.createdIntegrations.push(id);
    const secret = await this.admin.from("integration_secrets").insert({
      integration_id: id,
      business_id: this.businessId,
      access_token: `voice-e2e-${kind}-token`,
      refresh_token: kind === "google" ? "voice-e2e-refresh" : null,
      token_expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
    });
    if (secret.error) throw secret.error;
    return id;
  }

  async disconnectCalendars() {
    for (const id of this.createdIntegrations) await this.admin.from("integrations").delete().eq("id", id);
    this.createdIntegrations = [];
  }

  /** A lead who asked to be called (lawful call consent recorded), on a drama-range mobile. */
  async createLead(label: string, extra: Json = {}): Promise<{ id: string; phone: string; email: string }> {
    const phone = `+447700900${String(100 + Math.floor(Math.random() * 800)).padStart(3, "0")}`;
    const email = `voicee2e.${label}.${this.run}@example.invalid`;
    const { data: service } = await this.admin.from("services").select("id").eq("business_id", this.businessId).eq("name", "Website design and build").maybeSingle();
    const { data, error } = await this.admin
      .from("leads")
      .insert({
        business_id: this.businessId,
        first_name: `Voicee2e${label}`,
        last_name: this.run,
        phone,
        email,
        service_id: (service as { id: string } | null)?.id ?? null,
        status: "CONTACTED",
        qualification_state: "PENDING",
        automation_active: false,
        human_takeover: false,
        notes: "Wants a new marketing site for a 12-person design studio.",
        company_name: `Voicee2e ${label} Studio Ltd`,
        subscriber_type: "CORPORATE",
        relationship_type: "THEY_CONTACTED_US",
        intake_method: "PHONE_CALL",
        email_origin: "CUSTOMER_PROVIDED",
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = (data as { id: string }).id;
    this.createdLeads.push(id);
    const perm = await this.admin.from("contact_permissions").insert({
      business_id: this.businessId,
      subject_type: "LEAD",
      subject_id: id,
      phone_e164: phone,
      email,
      relationship_type: "THEY_CONTACTED_US",
      consent_status: "GRANTED",
      consent_scope: ["CALL_REQUESTED"],
      consent_evidence: "voice-e2e: the lead asked to be called on the enquiry form",
      consent_source: "FORM",
      consent_captured_at: new Date().toISOString(),
      subscriber_type: "CORPORATE",
      country: "GB",
      call_consent_wording: "Call me about my enquiry",
    });
    if (perm.error) this.notes.push(`contact_permissions insert: ${perm.error.message}`);
    return { id, phone, email };
  }

  /** The call row as dialCall leaves it once Retell accepted the call (state DIALLING, minutes held). */
  async createCall(lead: { id: string; phone: string }, route = "QUALIFICATION"): Promise<{ id: string; providerCallId: string }> {
    const providerCallId = `call_e2e_${this.run}_${randomUUID().slice(0, 6)}`;
    const { data, error } = await this.admin
      .from("voice_calls")
      .insert({
        business_id: this.businessId,
        lead_id: lead.id,
        direction: "OUTBOUND",
        route,
        state: "DIALLING",
        call_key: `voice:e2e:${this.run}:${providerCallId}`,
        attempt_number: 1,
        consent_basis: "CALL_REQUESTED",
        to_e164: lead.phone,
        from_e164: "+447700900001",
        destination_class: "UK_MOBILE",
        recipient_timezone: "Europe/London",
        calling_as_name: "Blackwellen",
        legal_entity_name: "Blackwellen Ltd",
        identification_contact: "hello@blackwellen-demo.example",
        opener_version: "od1.2026-09-27.v1",
        recording_enabled: false,
        provider: "retell",
        provider_call_id: providerCallId,
        queued_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: (data as { id: string }).id, providerCallId };
  }

  async grantMinutes() {
    const { grantVoicePeriodMinutes } = await import("../../src/lib/voice/minutes.ts");
    const periodStart = new Date(Date.now() - 60_000).toISOString();
    this.minuteGrantKey = periodStart;
    return grantVoicePeriodMinutes({ businessId: this.businessId, includedMinutes: 30, periodStart, periodEnd: new Date(Date.now() + 86_400_000).toISOString() });
  }

  /* ---------------------------------------------------------- cleanup */

  async deleteLead(id: string) {
    const { data: calls } = await this.admin.from("voice_calls").select("id").eq("lead_id", id);
    const callIds = (calls ?? []).map((c) => c.id as string);
    // Jobs never cascade: remove every job naming the lead or its calls.
    const { data: jobs } = await this.admin.from("jobs").select("id, payload, type").or(`business_id.eq.${this.businessId},business_id.is.null`).gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(5000);
    const ids = (jobs ?? [])
      .filter((j) => {
        const p = JSON.stringify(j.payload ?? {});
        return p.includes(id) || callIds.some((c) => p.includes(c)) || (j.type === "voice.webhook_ingest" && p.includes("call_e2e_"));
      })
      .map((j) => j.id as string);
    for (let i = 0; i < ids.length; i += 100) await this.admin.from("jobs").delete().in("id", ids.slice(i, i + 100));
    await this.admin.from("webhook_events").delete().eq("provider", "retell").like("external_event_id", "call_e2e_%");
    const { data: lead } = await this.admin.from("leads").select("phone, email").eq("id", id).maybeSingle();
    if (lead) {
      const l = lead as { phone: string | null; email: string | null };
      if (l.phone) await this.admin.from("suppression_entries").delete().eq("business_id", this.businessId).eq("phone_e164", l.phone);
      if (l.email) await this.admin.from("suppression_entries").delete().eq("business_id", this.businessId).eq("email", l.email);
    }
    for (const c of callIds) {
      for (const table of ["voice_minute_ledger", "voice_minute_reservations", "voice_cost_ledger"]) {
        // Errors are reported, never swallowed: a ledger that refuses deletes
        // left 36 rows behind on 2026-09-30 with nothing said.
        const r = await this.admin.from(table).delete().eq("voice_call_id", c);
        if (r.error) this.notes.push(`cleanup ${table} for call ${c}: ${r.error.message}`);
      }
    }
    // Events about the lead's bookings, opportunities and contact (their
    // subject is not the lead) and the dispatch jobs queued for them.
    const [bookingRows, oppRows] = await Promise.all([
      this.admin.from("bookings").select("id").eq("lead_id", id),
      this.admin.from("opportunities").select("id").eq("lead_id", id),
    ]);
    const subjects = [...(bookingRows.data ?? []), ...(oppRows.data ?? [])].map((r) => r.id as string);
    const { data: evRows } = await this.admin
      .from("domain_events")
      .select("id")
      .eq("business_id", this.businessId)
      .or([`subject_id.eq.${id}`, ...callIds.map((c) => `subject_id.eq.${c}`), ...subjects.map((s) => `subject_id.eq.${s}`), `payload->>lead_id.eq.${id}`].join(","));
    const eventIds = (evRows ?? []).map((e) => e.id as string);
    for (let i = 0; i < eventIds.length; i += 50) {
      const chunk = eventIds.slice(i, i + 50);
      await this.admin.from("jobs").delete().in("type", ["event.dispatch", "webhook.dispatch", "automation.dispatch"]).in("payload->>eventId", chunk);
      await this.admin.from("domain_events").delete().in("id", chunk);
    }
    await this.admin.from("contact_permissions").delete().eq("subject_id", id);
    await this.admin.from("notifications").delete().eq("business_id", this.businessId).like("link_url", `%${id}%`);
    await this.admin.from("domain_events").delete().eq("business_id", this.businessId).eq("subject_id", id);
    for (const c of callIds) await this.admin.from("domain_events").delete().eq("business_id", this.businessId).eq("subject_id", c);
    // An opportunity's lead_id is set null on delete, which its own CHECK refuses: removed first.
    await this.admin.from("opportunities").delete().eq("business_id", this.businessId).eq("lead_id", id);
    const del = await this.admin.from("leads").delete().eq("id", id);
    if (del.error) this.notes.push(`lead delete ${id}: ${del.error.message}`);
  }

  async cleanup() {
    this.step = "cleanup";
    for (const id of this.createdLeads) await this.deleteLead(id);
    await this.disconnectCalendars();
    for (const r of this.restore) {
      let q = this.admin.from(r.table).update(r.row);
      for (const [k, v] of Object.entries(r.match)) q = q.eq(k, v as string);
      const { error } = await q;
      if (error) this.notes.push(`restore ${r.table}: ${error.message}`);
    }
    if (this.minuteGrantKey) {
      // The grant and anything it touched: the demo workspace had no minutes before.
      const led = await this.admin.from("voice_minute_ledger").delete().eq("business_id", this.businessId).gte("created_at", this.startedAt.toISOString());
      if (led.error) this.notes.push(`cleanup voice_minute_ledger: ${led.error.message}`);
      const bal = await this.admin.from("voice_minute_balances").delete().eq("business_id", this.businessId);
      if (bal.error) this.notes.push(`cleanup voice_minute_balances: ${bal.error.message}`);
    }
    // Leftover proof.
    const { count } = await this.admin.from("leads").select("id", { count: "exact", head: true }).eq("business_id", this.businessId).like("first_name", "Voicee2e%");
    this.check("cleanup left no harness leads", (count ?? 0) === 0, { count });
  }

  report(): HarnessReport {
    return { checks: this.checks, latencies: this.latencies, failures: this.checks.filter((c) => !c.ok), notes: this.notes };
  }
}

export { sleep };
