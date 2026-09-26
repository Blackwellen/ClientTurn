/**
 * Runtime harness for the business stories: the test workspace, the
 * in-process job runner, the deployed-worker guard loop, the provider fakes
 * and the cleanup proof. `safety.ts` must be installed before this is imported.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  PARK_AT,
  PARK_MARK,
  RUN,
  SERVICE_KEY,
  SUPABASE_URL,
  WORKER_ID,
  egress,
  json,
  readSql,
  realFetch,
  registerFake,
  setTestBusiness,
} from "./safety.ts";

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const BUSINESS_PREFIX = "ZZ-E2E-STORY";

/* --------------------------------------------------------------- the world */

export type World = {
  businessId: string;
  ownerId: string;
  businessName: string;
  createdGlobal: { webhookEvents: { provider: string; id: string }[]; authUsers: string[] };
};

export let world: World | null = null;

export function mustWorld(): World {
  if (!world) throw new Error("world not set up");
  return world;
}

/** Drama-range mobile, unique per run and call. */
let phoneSeq = Math.floor(Math.random() * 400);
export function dramaPhone(): string {
  phoneSeq = (phoneSeq + 7) % 1000;
  return `+447700900${String(phoneSeq).padStart(3, "0")}`;
}
export function testEmail(local: string, domain = "example.invalid"): string {
  return `${local}.${RUN}@${domain}`;
}

export async function setupWorld(): Promise<World> {
  const businessName = `${BUSINESS_PREFIX}-${RUN}`;
  const ownerEmail = `zz-e2e-story-owner-${RUN}@example.invalid`;
  const ownerPassword = `Story!${randomUUID()}`;
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`owner user: ${userError?.message}`);
  const ownerId = user.user.id;
  const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await anon.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
  if (signIn.error || !signIn.data.session) throw new Error(`owner sign-in: ${signIn.error?.message}`);
  (globalThis as { __STORY_ACCESS_TOKEN__?: string }).__STORY_ACCESS_TOKEN__ = signIn.data.session.access_token;

  const { data: business, error } = await admin
    .from("businesses")
    .insert({
      name: businessName,
      slug: `zz-e2e-story-${RUN}`,
      status: "active",
      timezone: "Europe/London",
      industry: "Marketing agency",
      onboarding_step: "complete",
      activated_at: new Date().toISOString(),
      created_by: ownerId,
    })
    .select("id")
    .single();
  if (error || !business) throw new Error(`business: ${error?.message}`);
  const businessId = business.id as string;
  world = {
    businessId,
    ownerId,
    businessName,
    createdGlobal: { webhookEvents: [], authUsers: [ownerId] },
  };
  setTestBusiness(businessId);

  await must(
    admin.from("business_members").insert({ business_id: businessId, user_id: ownerId, role: "owner", status: "active" }),
    "member",
  );
  // SAFETY layer 6: the real row is CANCELLED, so deployed code refuses sends.
  await must(
    admin.from("subscriptions").insert({ business_id: businessId, plan: "pro", status: "CANCELLED", cancelled_at: new Date().toISOString() }),
    "cancelled subscription",
  );
  await must(
    admin.from("business_settings").upsert({
      business_id: businessId,
      quiet_hours_enabled: false,
      default_channel: "sms",
      booking_mode: "google_calendar",
      ai_assist_enabled: true,
      appointment_duration_minutes: 30,
      booking_buffer_minutes: 0,
      business_hours: allWeekHours(),
      notify_handover: true,
      notify_booking: true,
      slack_notify_new_lead: false,
      slack_notify_handover: false,
      slack_notify_booking: false,
      slack_notify_warm_prospect: false,
      message_signature: "Northlight Growth",
    }),
    "settings",
  );
  // The workspace's SMS connection. Sends from THIS process use the faked
  // Twilio; the deployed worker never sees a job for this workspace (parked)
  // and its policy gate refuses the CANCELLED workspace anyway.
  await must(
    admin.from("integrations").insert({
      business_id: businessId,
      provider_type: "twilio_sms",
      status: "HEALTHY",
      display_name: "Story SMS (fake)",
      config: { phoneNumber: process.env.TWILIO_SMS_FROM },
    }),
    "sms integration",
  );
  await must(
    admin.from("business_ai_settings").upsert(
      {
        business_id: businessId,
        tone: "professional",
        reply_length: "short",
        business_description: "Northlight Growth is a UK B2B marketing agency (paid social, SEO, content).",
        allow_ai_reply: true,
        allow_ai_interpretation: true,
        agent_mode: "AUTO_REPLY",
        agent_channels: ["sms", "email"],
        agent_handover_on_review: true,
        agent_answer_service_questions: true,
      },
      { onConflict: "business_id" },
    ),
    "ai settings",
  );
  return world;
}

function allWeekHours() {
  const day = { open: true, start: "09:00", end: "17:30" };
  const closed = { open: false, start: "09:00", end: "17:30" };
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: closed, sun: closed };
}

export async function must<T extends { error: { message: string } | null }>(p: PromiseLike<T>, what: string): Promise<T> {
  const result = await p;
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result;
}

/* ------------------------------------------------------ the session fake */

export function signInAsOwner() {
  const w = mustWorld();
  (globalThis as { __STORY_SESSION__?: unknown }).__STORY_SESSION__ = {
    userId: w.ownerId,
    businessId: w.businessId,
    role: "owner",
    businessName: w.businessName,
    businessStatus: "active",
    onboardingStep: "complete",
    activatedAt: new Date().toISOString(),
    timezone: "Europe/London",
  };
}

/* ------------------------------------------------- the deployed-worker guard */

const claimedByUs = new Set<string>();
let guardTimer: NodeJS.Timeout | null = null;
let guardBusy = false;
export const guardStats = { sweeps: 0, reparked: 0, maxExposureMs: 0 };

/**
 * Parks any pending job of the test business that is not yet parked. Uses the
 * raw fetch so the parking PATCH is not itself rewritten.
 */
async function guardSweep() {
  if (guardBusy || !world) return;
  guardBusy = true;
  try {
    const now = new Date().toISOString();
    const url =
      `${SUPABASE_URL}/rest/v1/jobs?business_id=eq.${world.businessId}&state=eq.pending` +
      `&run_at=neq.${encodeURIComponent(PARK_AT)}&select=id,type,created_at`;
    const response = await realFetch(url, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ run_at: PARK_AT, last_error: `${PARK_MARK}${now}` }),
    });
    guardStats.sweeps += 1;
    if (response.ok) {
      const rows = (await response.json()) as { id: string; type: string; created_at: string }[];
      for (const row of rows) {
        guardStats.reparked += 1;
        egress.reparked.push({ id: row.id, type: row.type });
        guardStats.maxExposureMs = Math.max(guardStats.maxExposureMs, Date.now() - new Date(row.created_at).getTime());
      }
    }
  } catch {
    // A missed sweep is caught by the next one 100ms later.
  } finally {
    guardBusy = false;
  }
}

export function startGuard() {
  if (guardTimer) return;
  guardTimer = setInterval(() => void guardSweep(), 100);
}
export async function stopGuard() {
  if (guardTimer) clearInterval(guardTimer);
  guardTimer = null;
  await guardSweep();
}

/**
 * The proof: every test-business job that left `pending` was claimed by this
 * process. Anything else was touched by another worker (the deployed one).
 */
export async function foreignlyTouchedJobs() {
  const w = mustWorld();
  const { data, error } = await admin
    .from("jobs")
    .select("id, type, state, attempts, locked_by, last_error")
    .eq("business_id", w.businessId)
    .or("state.neq.pending,attempts.gt.0");
  if (error) throw error;
  return (data ?? []).filter((row) => !claimedByUs.has(row.id as string));
}

/* ------------------------------------------------------------ the runner */

export type JobLogEntry = { id: string; type: string; ok: boolean; error?: string };
export const jobLog: JobLogEntry[] = [];

function originalDue(lastError: string | null): number {
  if (!lastError || !lastError.startsWith(PARK_MARK)) return 0;
  const t = Date.parse(lastError.slice(PARK_MARK.length));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Runs every parked job of this run that is due (by its ORIGINAL run_at), in
 * priority order, until the queue is quiet. `until` lets a story fast-forward
 * delayed jobs of the named types.
 */
export async function runJobs(opts: { maxJobs?: number; fastForward?: string[]; skip?: string[] } = {}) {
  const { handleJob } = await import("../../src/lib/jobs/registry.ts");
  await import("../../src/lib/jobs/register.ts");
  const max = opts.maxJobs ?? 200;
  let ran = 0;
  for (;;) {
    await guardSweep();
    const { data, error } = await admin
      .from("jobs")
      .select("id, type, business_id, payload, attempts, max_attempts, last_error, priority, created_at")
      .eq("state", "pending")
      .eq("run_at", PARK_AT)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    const now = Date.now();
    const due = (data ?? []).filter(
      (job) =>
        !(opts.skip ?? []).includes(job.type as string) &&
        (originalDue(job.last_error as string | null) <= now || (opts.fastForward ?? []).includes(job.type as string)),
    );
    if (due.length === 0) return ran;
    const job = due[0];
    const { data: claimed } = await admin
      .from("jobs")
      .update({ state: "running", locked_at: new Date().toISOString(), locked_by: WORKER_ID, attempts: (job.attempts as number) + 1 })
      .eq("id", job.id)
      .eq("state", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    claimedByUs.add(job.id as string);
    ran += 1;
    try {
      await handleJob({
        id: job.id as string,
        type: job.type as never,
        business_id: job.business_id as string | null,
        payload: job.payload as Record<string, unknown>,
        attempts: (job.attempts as number) + 1,
        max_attempts: job.max_attempts as number,
      });
      await admin.from("jobs").update({ state: "completed", completed_at: new Date().toISOString(), locked_at: null }).eq("id", job.id);
      jobLog.push({ id: job.id as string, type: job.type as string, ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Never failJob(): a retry would be rescheduled. Dead, with the reason.
      await admin.from("jobs").update({ state: "dead", last_error: `story: ${message.slice(0, 1500)}`, locked_at: null }).eq("id", job.id);
      jobLog.push({ id: job.id as string, type: job.type as string, ok: false, error: message });
    }
    if (ran >= max) return ran;
  }
}

export function failedJobs(since = 0) {
  return jobLog.slice(since).filter((entry) => !entry.ok);
}

/* ------------------------------------------------------------- the fakes */

export type AiCall = { taskType: string; system: string; user: string; response: unknown };
export const aiCalls: AiCall[] = [];
type AiScript = (taskType: string, user: string) => unknown | undefined;
let aiScript: AiScript | null = null;
export function scriptAi(script: AiScript | null) {
  aiScript = script;
}

let promptIndex: Map<string, string> | null = null;
async function taskTypeOf(system: string): Promise<string> {
  if (!promptIndex) {
    const { getPrompt } = await import("../../src/lib/ai/prompt-registry.ts");
    const { SCHEMAS } = await import("../../src/lib/ai/schemas.ts");
    promptIndex = new Map();
    for (const task of Object.keys(SCHEMAS)) {
      try {
        promptIndex.set(getPrompt(task as never).systemPrompt, task);
      } catch {
        /* a task without a prompt */
      }
    }
  }
  return promptIndex.get(system) ?? "unknown";
}

/** The next question the strategy block tells the model to ask, if any. */
export function strategyQuestion(user: string): string | null {
  const match = user.match(/Next best question\. Ask only this, in natural wording: (.+?)(?: \(acceptable answers: .*\))?$/m);
  return match ? match[1].trim() : null;
}
export function strategySaysStop(user: string): boolean {
  return /Stop qualifying: enough is known\.|No further questions\./.test(user);
}

/** Default scripted decisions. Model QUALITY is not evaluated by these stories. */
function defaultAi(taskType: string, user: string): unknown {
  switch (taskType) {
    case "agent_decision": {
      const q = strategyQuestion(user);
      if (q) {
        return {
          intent: "SERVICE_ENQUIRY",
          confidence: 0.92,
          proposed_action: "ASK_NEXT_QUESTION",
          message: `Thanks, that helps. ${q}`,
          extracted: [],
          reasoning_code: "SCRIPTED_ASK",
        };
      }
      if (strategySaysStop(user) || (!q && /Close target:/.test(user))) {
        const link = user.match(/^- ([a-z0-9][a-z0-9_-]*): /m);
        if (user.includes("DIRECT CLOSE (approved checkout links)") && link) {
          return { intent: "POSITIVE_REPLY", confidence: 0.93, proposed_action: "PROPOSE_CHECKOUT", checkout_link_id: link[1], message: "Brilliant, here is the link to get started.", extracted: [], reasoning_code: "SCRIPTED_CHECKOUT" };
        }
        if (/book a call|book a consultation/i.test(user)) {
          return { intent: "BOOKING_REQUEST", confidence: 0.93, proposed_action: "SEND_BOOKING_OPTIONS", message: "Happy to set up a call with the team. Which of these times suits you best?", extracted: [], reasoning_code: "SCRIPTED_BOOK" };
        }
        if (/hand to a person|a person owns it/i.test(user)) {
          return { intent: "SERVICE_ENQUIRY", confidence: 0.9, proposed_action: "REQUEST_HANDOVER", handover_reason: "HIGH_VALUE", message: null, extracted: [], reasoning_code: "SCRIPTED_HANDOVER" };
        }
      }
      return {
        intent: "SERVICE_ENQUIRY",
        confidence: 0.9,
        proposed_action: "REPLY",
        message: "Thanks for the detail, that is really helpful.",
        extracted: [],
        reasoning_code: "SCRIPTED_REPLY",
      };
    }
    case "handoff_brief":
      return { brief: "Qualified inbound enquiry. Goal, channel and timing captured in the conversation. Next step: a person follows up." };
    case "conversation_summary":
      return { summary: "Lead is qualifying for a growth engagement.", key_points: ["Scripted summary"] };
    case "intent_classification":
      return { intent: "SERVICE_ENQUIRY", service_id: null, confidence: 0.9, requires_human: false };
    case "answer_extraction":
      return { question_id: "", normalized_value: null, confidence: 0.2, requires_review: true };
    default:
      return {};
  }
}

export function installProviderFakes() {
  registerFake({
    name: "azure",
    match: (url) => url.hostname.endsWith("openai.azure.com"),
    respond: async (_url, _method, body) => {
      const parsed = JSON.parse(body) as { messages: { role: string; content: string }[] };
      const system = parsed.messages.find((m) => m.role === "system")?.content ?? "";
      const user = parsed.messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n");
      const taskType = await taskTypeOf(system);
      const response = aiScript?.(taskType, user) ?? defaultAi(taskType, user);
      aiCalls.push({ taskType, system, user, response });
      return json({
        choices: [{ message: { role: "assistant", content: JSON.stringify(response) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 900, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 0 } },
      });
    },
  });

  registerFake({
    name: "twilio",
    match: (url) => url.hostname === "api.twilio.com",
    respond: (url, method, body) => {
      if (method === "POST" && url.pathname.endsWith("/Messages.json")) {
        const form = new URLSearchParams(body);
        smsOutbox.push({ to: form.get("To") ?? "", body: form.get("Body") ?? "", at: new Date().toISOString() });
        return json({ sid: `SM${randomUUID().replace(/-/g, "")}`, status: "queued" }, 201);
      }
      return json({ message: "not faked" }, 404);
    },
  });

  registerFake({
    name: "resend",
    match: (url) => url.hostname === "api.resend.com",
    respond: (_url, _method, body) => {
      emailOutbox.push({ body, at: new Date().toISOString() });
      return json({ id: randomUUID() });
    },
  });

  registerFake({
    name: "google-calendar",
    match: (url) => url.hostname === "www.googleapis.com" && url.pathname.startsWith("/calendar/v3"),
    respond: (url, method, body) => {
      if (url.pathname.endsWith("/freeBusy")) {
        return json({ calendars: { primary: { busy: [] } } });
      }
      if (method === "POST" && url.pathname.endsWith("/events")) {
        const event = JSON.parse(body) as Record<string, unknown>;
        calendarEvents.push({ event, sendUpdates: url.searchParams.get("sendUpdates") });
        return json({ id: `evt_${RUN}_${calendarEvents.length}`, htmlLink: "https://calendar.invalid/e", status: "confirmed" });
      }
      if (url.pathname.includes("/calendars/primary")) return json({ id: "primary", timeZone: "Europe/London" });
      return json({ error: "not faked" }, 404);
    },
  });
}

export const smsOutbox: { to: string; body: string; at: string }[] = [];
export const emailOutbox: { body: string; at: string }[] = [];
export const calendarEvents: { event: Record<string, unknown>; sendUpdates: string | null }[] = [];

/* ---------------------------------------------------- inbound SMS webhook */

/** Twilio's documented signature: HMAC-SHA1 over url + sorted k/v pairs. */
function twilioSignature(token: string, url: string, params: Record<string, string>) {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

/** Delivers an inbound SMS through the real Twilio webhook route handler. */
export async function inboundSms(from: string, body: string) {
  const { POST } = await import("../../src/app/api/webhooks/twilio/route.ts");
  const sid = `SM${randomUUID().replace(/-/g, "")}`;
  const params: Record<string, string> = {
    MessageSid: sid,
    AccountSid: process.env.TWILIO_ACCOUNT_SID ?? process.env.TWILIO_SID ?? "ACstory",
    From: from,
    To: process.env.TWILIO_SMS_FROM!,
    Body: body,
  };
  const url = process.env.TWILIO_WEBHOOK_URL!;
  const signature = twilioSignature(process.env.TWILIO_AUTH_TOKEN!, url, params);
  const response = await POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature, "x-forwarded-for": "127.0.0.1" },
      body: new URLSearchParams(params).toString(),
    }),
  );
  mustWorld().createdGlobal.webhookEvents.push({ provider: "twilio", id: sid });
  return { status: response.status, sid };
}

export function metaSignature(rawBody: string) {
  return `sha256=${createHmac("sha256", process.env.META_APP_SECRET!).update(rawBody).digest("hex")}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/* ------------------------------------------------------------ assertions */

export async function leadRow(leadId: string) {
  const { data } = await admin.from("leads").select("*").eq("id", leadId).single();
  return data as Record<string, unknown>;
}
export async function domainEventsFor(subjectIds: string[]) {
  const { data } = await admin
    .from("domain_events")
    .select("type, subject_type, subject_id, occurred_at, payload")
    .eq("business_id", mustWorld().businessId)
    .order("occurred_at", { ascending: true });
  const ids = new Set(subjectIds);
  return (data ?? []).filter(
    (row) => ids.has(row.subject_id as string) || ids.has(((row.payload ?? {}) as { lead_id?: string; leadId?: string }).lead_id ?? "") || ids.has(((row.payload ?? {}) as { leadId?: string }).leadId ?? ""),
  );
}
export async function outboundMessages(leadId: string) {
  const { data } = await admin
    .from("messages")
    .select("id, direction, channel, body, status, origin, created_at, error_code")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  return (data ?? []) as Record<string, unknown>[];
}
export function questionMarks(text: string) {
  return (text.match(/\?/g) ?? []).length;
}

/* ---------------------------------------------------------------- cleanup */

/** Every public table with a business_id column, and its row count for the test business. */
export async function remainingRows(businessId: string) {
  const tables = await readSql<{ table_name: string }>(
    "select c.table_name from information_schema.columns c join information_schema.tables t " +
      "on t.table_schema = c.table_schema and t.table_name = c.table_name " +
      "where c.table_schema = 'public' and c.column_name = 'business_id' and t.table_type = 'BASE TABLE' order by 1",
  );
  const counts: Record<string, number> = {};
  const parts = tables.map((t) => `select '${t.table_name}' t, count(*)::int n from public."${t.table_name}" where business_id = '${businessId}'`);
  for (let i = 0; i < parts.length; i += 40) {
    const rows = await readSql<{ t: string; n: number }>(parts.slice(i, i + 40).join(" union all "));
    for (const row of rows) if (row.n > 0) counts[row.t] = row.n;
  }
  return { tablesChecked: tables.length, nonZero: counts };
}

export async function countBusinessRows(businessId: string) {
  return remainingRows(businessId);
}

export async function teardownWorld(): Promise<{
  before: Record<string, number>;
  after: { tablesChecked: number; nonZero: Record<string, number> };
  globals: Record<string, number>;
}> {
  const w = mustWorld();
  const before = (await remainingRows(w.businessId)).nonZero;
  // Jobs this run parked without a business (the Twilio route queues inbound
  // processing with no business id) and the global inbox rows it wrote.
  await admin.from("jobs").delete().eq("run_at", PARK_AT);
  for (const event of w.createdGlobal.webhookEvents) {
    await admin.from("webhook_events").delete().eq("provider", event.provider).like("external_event_id", `%${event.id}%`);
  }
  const { error } = await admin.from("businesses").delete().eq("id", w.businessId);
  if (error) throw new Error(`business delete: ${error.message}`);
  for (const id of w.createdGlobal.authUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  const after = await remainingRows(w.businessId);
  const globals: Record<string, number> = {};
  const [parked] = await readSql<{ n: number }>(`select count(*)::int n from public.jobs where run_at = '${PARK_AT}'`);
  globals.parked_jobs = parked?.n ?? -1;
  const ids = w.createdGlobal.webhookEvents.map((e) => `'${e.id.replace(/'/g, "")}'`);
  if (ids.length) {
    const [wh] = await readSql<{ n: number }>(
      `select count(*)::int n from public.webhook_events where ${w.createdGlobal.webhookEvents.map((e) => `external_event_id like '%${e.id.replace(/'/g, "")}%'`).join(" or ")}`,
    );
    globals.webhook_events = wh?.n ?? -1;
  }
  const users = w.createdGlobal.authUsers.map((u) => `'${u}'`).join(",");
  const [au] = await readSql<{ n: number }>(`select count(*)::int n from auth.users where id in (${users})`);
  globals.auth_users = au?.n ?? -1;
  const [biz] = await readSql<{ n: number }>(`select count(*)::int n from public.businesses where name like '${BUSINESS_PREFIX}-${RUN}%'`);
  globals.businesses = biz?.n ?? -1;
  return { before, after, globals };
}

/* ------------------------------------------------------- time and turns */

/** The UK pack's quiet hours (20:00-08:00) defer SMS; stories need daytime. */
export function assertUkDaytime(now = new Date()) {
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const [h, m] = hhmm.split(":").map(Number);
  const minutes = h * 60 + m;
  if (minutes < 8 * 60 + 2 || minutes > 19 * 60 + 30) {
    throw new Error(`Stories send SMS and must run 08:02-19:30 UK time (the UK pack's quiet hours); it is ${hhmm}`);
  }
}

/** The latest agent run for a lead, with its decision_json. */
export async function latestRun(leadId: string) {
  const { data } = await admin
    .from("conversation_agent_runs")
    .select("id, outcome, status, mode, error_code, decision_json, qualification_after, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

/**
 * One lead turn: an inbound SMS through the real Twilio route, then every job
 * it causes. Returns the outbound SMS bodies the fake received for that phone.
 */
export async function leadSays(phone: string, text: string) {
  const sent = smsOutbox.length;
  const r = await inboundSms(phone, text);
  if (r.status !== 200) throw new Error(`twilio route returned ${r.status}`);
  const before = jobLog.length;
  await runJobs();
  return {
    replies: smsOutbox.slice(sent).filter((m) => m.to === phone).map((m) => m.body),
    failures: failedJobs(before),
    jobs: jobLog.slice(before).map((j) => j.type),
  };
}
