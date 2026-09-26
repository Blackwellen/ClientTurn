/**
 * The safety layer for the business stories. Read tests/stories/README.md first.
 *
 * Everything here exists to make one promise provable: a story run against the
 * owner's live Supabase project cannot send anything to anybody, from this
 * process or from the deployed worker.
 *
 *   1. Secrets. Every provider credential in process.env is replaced with a
 *      fake value BEFORE any application module is imported. Even a request
 *      that somehow escaped the guards below would carry a key the provider
 *      rejects. Live Stripe keys are deleted outright.
 *   2. Sockets. `net.connect` / `tls.connect` (which Node's own fetch uses) and
 *      `http(s).request` refuse every host except the Supabase project. Proven
 *      by `assertEgressBlocked()` at start-up.
 *   3. fetch. Supabase traffic passes through; every other URL must be
 *      answered by a registered fake, or the call throws BLOCKED_EGRESS.
 *   4. Jobs. Every `jobs` row this process writes is PARKED: `run_at` is moved
 *      to a far-future sentinel unique to this run. The deployed worker claims
 *      only `state = 'pending' AND run_at <= now()` (live `claim_jobs`, checked
 *      by `assertClaimContract()`), so a parked job is invisible to it. The
 *      original due time is kept in `last_error` for the in-process runner.
 *   5. SQL-originated jobs (`emit_domain_event` -> event.dispatch,
 *      `receive_workspace_app_event` -> app.ingest) cannot be intercepted at
 *      insert, so a guard loop parks any unparked pending job of the test
 *      business every 200ms, and every story checks afterwards that no
 *      test-business job was ever locked by a worker that is not us.
 *   6. Entitlements. The test workspace's REAL subscription row is CANCELLED,
 *      so the deployed code's policy gate (BLOCKED_BUSINESS_STATE) refuses any
 *      send for it even if a job were claimed. In this process only, the read
 *      of that one row is answered with an ACTIVE row, so the stories exercise
 *      the real, active-workspace code paths. Billing itself is never touched.
 *   7. `claim_jobs` / `reap_stalled_jobs` RPCs are refused in-process, so no
 *      code path here can ever claim another workspace's job.
 */
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";

/* ------------------------------------------------------------ run identity */

export const RUN = randomUUID().slice(0, 8);
/** A far-future timestamp unique to this run. Nothing real ever has it. */
export const PARK_AT = new Date(
  Date.UTC(2999, 0, 1) + Math.floor(Math.random() * 300 * 86_400_000),
).toISOString();
export const PARK_MARK = `STORY_PARKED:${RUN}:orig=`;
export const WORKER_ID = `story-${RUN}`;

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_HOST = new URL(SUPABASE_URL).hostname;
/** The harness's own read-only verification queries (never app code). */
const MANAGEMENT_HOST = "api.supabase.com";

/* ------------------------------------------------------------------ secrets */

/** Provider secrets replaced with fakes. Ids/endpoints stay so code looks configured. */
const FAKE_SECRETS: Record<string, string> = {
  TWILIO_AUTH_TOKEN: "story-fake-twilio-auth-token",
  TWILIO_CLIENT_SECRET: "story-fake-twilio-client-secret",
  TWILIO_API_KEY_SID: "SKstoryfake",
  RESEND_API_KEY: "re_story_fake",
  AZURE_OPENAI_API_KEY: "story-fake-azure-key",
  META_APP_SECRET: "story-fake-meta-app-secret",
  META_GRAPH_API_ACCESS_TOKEN: "story-fake-graph-token",
  META_WEBHOOK_VERIFY_TOKEN: "story-fake-verify",
  GOOGLE_CLIENT_SECRET: "story-fake-google-secret",
  GOOGLE_ADS_CLIENT_SECRET: "story-fake-google-ads-secret",
  GOOGLE_ADS_DEVELOPER_TOKEN: "story-fake-developer-token",
  GOOGLE_PLACES_API_KEY: "story-fake-places-key",
  COMPANIES_HOUSE_API_KEY: "story-fake-ch-key",
  LINKEDIN_CLIENT_SECRET: "story-fake-linkedin-secret",
  SALESFORCE_CLIENT_SECRET: "story-fake-sf-secret",
  ZOHO_CLIENT_SECRET: "story-fake-zoho-secret",
  SLACK_CLIENT_SECRET: "story-fake-slack-secret",
  SLACK_SIGNING_SECRET: "story-fake-slack-signing",
  CALENDLY_CLIENT_SECRET: "story-fake-calendly-secret",
  CALENDLY_API_KEY: "story-fake-calendly-key",
  CALENDLY_WEBHOOK_SIGNING_KEY: "story-fake-calendly-signing",
  TIKTOK_CLIENT_SECRET: "story-fake-tiktok-secret",
  STRIPE_SECRET_KEY_TEST: "sk_test_story_fake",
  CRON_SECRET: "story-fake-cron",
  R2_SECRET_ACCESS_KEY: "story-fake-r2",
};
const DELETED_SECRETS = [
  "STRIPE_SECRET_KEY_LIVE",
  "STRIPE_SECRET_KEY",
  "SUPABASE_PAT_FOR_APP", // placeholder: SUPABASE_PAT is captured below, then removed
  "LINKEDIN_SNAP_ACCESS_TOKEN",
  "APOLLO_API_KEY",
  "HUNTER_API_KEY",
  "CLEARBIT_API_KEY",
  "META_AD_LIBRARY_TOKEN",
  "TIKTOK_COMMERCIAL_CONTENT_TOKEN",
  "MESSAGING_PROVIDER",
];

/** Captured for the harness's own verification SQL, then removed from env. */
const SUPABASE_PAT = process.env.SUPABASE_PAT ?? null;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? null;

export function scrubSecrets() {
  for (const [name, value] of Object.entries(FAKE_SECRETS)) process.env[name] = value;
  for (const name of DELETED_SECRETS) delete process.env[name];
  delete process.env.SUPABASE_PAT;
  // Real-looking config for the fakes to answer.
  // Always the fake host: a real endpoint must never be the one addressed.
  process.env.AZURE_OPENAI_ENDPOINT = "https://story-fake.openai.azure.com";
  process.env.AZURE_OPENAI_DEPLOYMENT_DEFAULT ||= "story-mini";
  process.env.AZURE_OPENAI_DEPLOYMENT_FAST ||= "story-nano";
  process.env.AZURE_OPENAI_API_VERSION ||= "2024-10-21";
  process.env.TWILIO_SMS_FROM = "+447700900000";
  // Signed URL for inbound Twilio webhooks computed by the stories.
  process.env.TWILIO_WEBHOOK_URL = "https://story.invalid/api/webhooks/twilio";
  process.env.NEXT_PUBLIC_SITE_URL = "https://story.invalid";
}

/* -------------------------------------------------------------- the ledger */

export type FakeCall = { host: string; method: string; path: string; body: string; at: string };
export const egress = {
  faked: [] as FakeCall[],
  blocked: [] as string[],
  parkedInserts: 0,
  reparked: [] as { id: string; type: string }[],
  schemaShims: {} as Record<string, number>,
  dnsFaked: [] as string[],
};

/* ------------------------------------------------------------- the sockets */

function hostOf(args: unknown[]): string {
  const first = args[0] as unknown;
  if (first && typeof first === "object") {
    const o = first as { servername?: string; host?: string; hostname?: string };
    return o.servername || o.host || o.hostname || "";
  }
  if (typeof first === "number") return String(args[1] ?? "localhost");
  return String(first ?? "");
}

const ALLOWED_SOCKET_HOSTS = new Set([SUPABASE_HOST, MANAGEMENT_HOST, "localhost", "127.0.0.1", "::1"]);

let socketsGuarded = false;
function guardSockets() {
  if (socketsGuarded) return;
  socketsGuarded = true;
  const realTls = tls.connect;
  const realNet = net.connect;
  const deny = (kind: string, host: string) => {
    egress.blocked.push(`${kind}:${host}`);
    throw new Error(`BLOCKED_EGRESS ${kind} ${host}`);
  };
  (tls as { connect: unknown }).connect = function (this: unknown, ...args: unknown[]) {
    const host = hostOf(args);
    if (!ALLOWED_SOCKET_HOSTS.has(host)) deny("tls", host);
    return (realTls as (...a: unknown[]) => unknown).apply(this, args);
  };
  const netConnect = function (this: unknown, ...args: unknown[]) {
    const host = hostOf(args);
    if (!ALLOWED_SOCKET_HOSTS.has(host)) deny("net", host);
    return (realNet as (...a: unknown[]) => unknown).apply(this, args);
  };
  (net as { connect: unknown }).connect = netConnect;
  (net as { createConnection: unknown }).createConnection = netConnect;
  for (const mod of [http, https] as { request: unknown; get: unknown }[]) {
    const refuse = (...args: unknown[]) => {
      const target = args[0];
      const host =
        typeof target === "string"
          ? new URL(target).hostname
          : target instanceof URL
            ? target.hostname
            : ((target as { hostname?: string; host?: string })?.hostname ??
              (target as { host?: string })?.host ??
              "?");
      egress.blocked.push(`http:${host}`);
      throw new Error(`BLOCKED_EGRESS http ${host}`);
    };
    mod.request = refuse;
    mod.get = refuse;
  }
}

/* ------------------------------------------------------------------ fakes */

export type FakeResponder = {
  name: string;
  match: (url: URL, method: string) => boolean;
  respond: (url: URL, method: string, body: string, headers: Headers) => Response | Promise<Response>;
};
const fakes: FakeResponder[] = [];
export function registerFake(fake: FakeResponder) {
  fakes.unshift(fake); // later registrations win, so a story can override a default
}
export function removeFake(name: string) {
  for (let i = fakes.length - 1; i >= 0; i -= 1) if (fakes[i].name === name) fakes.splice(i, 1);
}
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/* ------------------------------------------------------ the fetch wrapper */

export const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);
let testBusinessId: string | null = null;
export function setTestBusiness(id: string | null) {
  testBusinessId = id;
}

/** The ACTIVE row this process sees in place of the real CANCELLED one. */
function syntheticSubscription(businessId: string) {
  const now = Date.now();
  return {
    id: "00000000-0000-4000-8000-00000000e2e5",
    business_id: businessId,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: null,
    plan: "pro",
    status: "ACTIVE",
    billing_interval: "month",
    trial_ends_at: null,
    current_period_start: new Date(now - 5 * 86_400_000).toISOString(),
    current_period_end: new Date(now + 25 * 86_400_000).toISOString(),
    cancel_at_period_end: false,
    cancelled_at: null,
    lead_limit: 5000,
    user_limit: 10,
    whatsapp_enabled: true,
    campaigns_enabled: true,
    ai_assist_allowed: true,
    created_at: new Date(now - 30 * 86_400_000).toISOString(),
    updated_at: new Date(now).toISOString(),
    plan_amount_minor: 0,
    verified_prospect_limit: 1000,
    search_capacity: 1000,
    intent_monitor_limit: 10,
    sender_limit: 5,
    communication_pool_minor: 100000,
    sourcing_enabled: true,
    cold_email_enabled: true,
    analytics_tier: "ADVANCED",
    auto_optimize_tier: "RECOMMENDATIONS",
  };
}

function parkRow(row: Record<string, unknown>): Record<string, unknown> {
  const original = typeof row.run_at === "string" ? row.run_at : new Date().toISOString();
  egress.parkedInserts += 1;
  return { ...row, run_at: PARK_AT, last_error: `${PARK_MARK}${original}` };
}

async function supabaseFetch(input: RequestInfo | URL, init: RequestInit | undefined, url: URL) {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const path = url.pathname;

  // No code path in this process may claim or reap the shared queue.
  if (path === "/rest/v1/rpc/claim_jobs") return json([]);
  if (path === "/rest/v1/rpc/reap_stalled_jobs") return json(0);

  // Park every job this process writes.
  if (path === "/rest/v1/jobs" && (method === "POST" || method === "PATCH") && typeof init?.body === "string") {
    const parsed = JSON.parse(init.body) as Record<string, unknown> | Record<string, unknown>[];
    let rewritten: unknown = parsed;
    if (method === "POST") {
      rewritten = Array.isArray(parsed) ? parsed.map(parkRow) : parkRow(parsed);
    } else if (!Array.isArray(parsed) && "run_at" in parsed) {
      // A retry reschedule (failJob) or any other run_at move: stays parked.
      rewritten = { ...parsed, run_at: PARK_AT, last_error: `${PARK_MARK}${String(parsed.run_at)}` };
    }
    return realFetch(input instanceof Request ? input.url : url, { ...init, body: JSON.stringify(rewritten) });
  }

  // The one read answered synthetically: the test workspace's subscription.
  if (
    path === "/rest/v1/subscriptions" &&
    method === "GET" &&
    testBusinessId &&
    url.searchParams.get("business_id") === `eq.${testBusinessId}`
  ) {
    const row = syntheticSubscription(testBusinessId);
    const accept = new Headers(init?.headers).get("accept") ?? "";
    return json(accept.includes("vnd.pgrst.object") ? row : [row]);
  }

  // Migration 0129 (billing, concurrent work) is not applied to this database
  // yet, but the working-tree send path already reads two of its tables. For
  // the TEST business only, those reads answer "nothing recorded" -- which is
  // exactly what an applied 0129 would return for a new workspace. Counted.
  const table = path.replace("/rest/v1/", "");
  if (
    method === "GET" &&
    UNAPPLIED_0129_TABLES.has(table) &&
    testBusinessId &&
    url.searchParams.get("business_id") === `eq.${testBusinessId}`
  ) {
    egress.schemaShims[table] = (egress.schemaShims[table] ?? 0) + 1;
    const accept = new Headers(init?.headers).get("accept") ?? "";
    return json(accept.includes("vnd.pgrst.object") ? null : []);
  }

  return realFetch(input, init);
}

const UNAPPLIED_0129_TABLES = new Set(["usage_overage_events", "message_credit_balances"]);

let fetchGuarded = false;
function guardFetch() {
  if (fetchGuarded) return;
  fetchGuarded = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === SUPABASE_HOST) return supabaseFetch(input, init, url);

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body = "";
    if (init?.body !== undefined && init.body !== null) {
      body =
        typeof init.body === "string"
          ? init.body
          : init.body instanceof URLSearchParams
            ? init.body.toString()
            : await new Response(init.body as BodyInit).text();
    } else if (input instanceof Request) {
      body = await input.clone().text();
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const fake of fakes) {
      if (fake.match(url, method)) {
        egress.faked.push({ host: url.hostname, method, path: url.pathname + url.search, body, at: new Date().toISOString() });
        return fake.respond(url, method, body, headers);
      }
    }
    egress.blocked.push(`fetch:${method} ${url.hostname}${url.pathname}`);
    throw new TypeError(`BLOCKED_EGRESS fetch ${method} ${url.hostname}${url.pathname}`);
  }) as typeof fetch;
}

/**
 * DNS: only the Supabase hosts resolve for real. Every other name answers with
 * a fixed documentation-style public address, so `safe-fetch`'s "resolves
 * public" check passes for fixture domains and no query ever leaves for them.
 * (The socket guard would refuse a connection to that address anyway.)
 */
export const FAKE_PUBLIC_IP = "93.184.215.14";
let dnsGuarded = false;
function guardDns() {
  if (dnsGuarded) return;
  dnsGuarded = true;
  const realLookup = dns.lookup;
  const realPromiseLookup = dnsPromises.lookup;
  const real = (host: string) => ALLOWED_SOCKET_HOSTS.has(host);
  (dns as { lookup: unknown }).lookup = function (host: string, ...rest: unknown[]) {
    if (real(host)) return (realLookup as (...a: unknown[]) => unknown)(host, ...rest);
    const callback = rest.find((arg) => typeof arg === "function") as (...a: unknown[]) => void;
    const options = rest.find((arg) => arg && typeof arg === "object") as { all?: boolean } | undefined;
    egress.dnsFaked.push(host);
    process.nextTick(() =>
      options?.all ? callback(null, [{ address: FAKE_PUBLIC_IP, family: 4 }]) : callback(null, FAKE_PUBLIC_IP, 4),
    );
  };
  (dnsPromises as { lookup: unknown }).lookup = async (host: string, options?: { all?: boolean }) => {
    if (real(host)) return (realPromiseLookup as (...a: unknown[]) => unknown)(host, options);
    egress.dnsFaked.push(host);
    return options?.all ? [{ address: FAKE_PUBLIC_IP, family: 4 }] : { address: FAKE_PUBLIC_IP, family: 4 };
  };
  syncBuiltinESMExports();
}

export function installGuards() {
  guardSockets();
  guardDns();
  guardFetch();
}

/* -------------------------------------------------------------- self-tests */

/** Proves the guards work before a single row is written. */
export async function assertEgressBlocked() {
  const probes = ["https://api.twilio.com/", "https://api.resend.com/emails", "https://graph.facebook.com/"];
  for (const probe of probes) {
    let refused = false;
    try {
      await globalThis.fetch(probe, { method: "POST", body: "{}" });
    } catch (error) {
      refused = String((error as Error).message).includes("BLOCKED_EGRESS");
    }
    if (!refused) throw new Error(`SAFETY: ${probe} was not refused`);
  }
  let socketRefused = false;
  try {
    tls.connect({ host: "api.twilio.com", port: 443, servername: "api.twilio.com" });
  } catch (error) {
    socketRefused = String((error as Error).message).includes("BLOCKED_EGRESS");
  }
  if (!socketRefused) throw new Error("SAFETY: raw TLS socket to api.twilio.com was not refused");
  let httpRefused = false;
  try {
    https.request("https://api.twilio.com/");
  } catch (error) {
    httpRefused = String((error as Error).message).includes("BLOCKED_EGRESS");
  }
  if (!httpRefused) throw new Error("SAFETY: https.request was not refused");
  // Clear the self-test entries so the story ledger starts empty.
  egress.blocked.length = 0;
}

/* ----------------------------------------------------- verification SQL */

/** Read-only SQL through the Management API. Harness use only. */
export async function readSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error("readSql is read-only");
  if (!SUPABASE_PAT || !PROJECT_REF) throw new Error("SUPABASE_PAT / SUPABASE_PROJECT_REF missing");
  const response = await realFetch(`https://${MANAGEMENT_HOST}/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) throw new Error(`readSql failed: ${JSON.stringify(body).slice(0, 300)}`);
  return body as T[];
}

/**
 * The deployed worker's claim contract, read live: it must still require
 * `state = 'pending'` and `run_at <= now()`. If it ever stops doing so, parking
 * no longer hides a job and the run must not start.
 */
export async function assertClaimContract() {
  const [row] = await readSql<{ d: string }>(
    "select pg_get_functiondef('public.claim_jobs(integer,text)'::regprocedure) as d",
  );
  const definition = row?.d ?? "";
  if (!/j\.state\s*=\s*'pending'/.test(definition) || !/j\.run_at\s*<=\s*now\(\)/.test(definition)) {
    throw new Error("SAFETY: live claim_jobs no longer filters on state/run_at; parking is not proof");
  }
  const inserters = await readSql<{ proname: string }>(
    "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
      "where n.nspname = 'public' and (p.prosrc ilike '%insert into public.jobs%' or p.prosrc ilike '%insert into jobs%') order by 1",
  );
  return inserters.map((r) => r.proname);
}

/** The deployed daily cron runs at 03:07 UTC; never overlap it. */
export function assertOutsideDailyCronWindow(now = new Date()) {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (minutes >= 2 * 60 + 45 && minutes <= 3 * 60 + 40) {
    throw new Error("SAFETY: refusing to run between 02:45 and 03:40 UTC (deployed daily cron)");
  }
}
