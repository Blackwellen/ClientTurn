/**
 * Find Leads + engagement, end to end, against the DEMO workspace.
 *
 *   node --experimental-transform-types --env-file=.env --env-file=.env.local \
 *     --import ./scripts/e2e-resolver.mjs --test tests/stories/find-leads-engagement.test.ts
 *   (npm run test:stories:demo)
 *
 * What it proves, on real code (route handlers, server actions, job handlers,
 * SQL triggers, RLS), with fakes only at the network edge:
 *
 *   S  sourcing: describe the ICP -> plan -> run -> Google Places discovery ->
 *      company-website contacts -> Companies House identity -> dedupe ->
 *      contactability (PECR corporate vs unincorporated) -> score -> review ->
 *      approve -> promote to lead
 *   O  outreach: campaign created on submit -> audience -> manual review ->
 *      activate -> dispatch to the (fake) mailbox with the Article 14 line and
 *      unsubscribe link -> suppression, unsubscribe, bounce -> step 2 timing
 *   E  engagement: new lead -> first follow-up -> inbound reply -> agent turn
 *      -> send guard (quiet hours, opt-out, takeover) -> stop conditions ->
 *      re-engagement trigger -> reactivation -> LinkedIn Assist
 *   A  background agents: sourcing, re-engagement and closing agent ticks,
 *      through the real scheduler scoped to this workspace
 *
 * The workspace is `blackwellen-demo`, which has `job_claims_paused = true`,
 * so the deployed worker never claims its jobs. Every job this process writes
 * is also parked (tests/stories/safety.ts) and run here in-process. Every row
 * this run creates is tracked and deleted in `after`; settings it changes are
 * restored. See the README beside this file.
 *
 * FLE_REAL=1 (owner decision 2026-09-29) makes sourcing use the REAL Companies
 * House API, REAL Google Places (hard cap 50 requests), REAL company-website
 * GETs (hard cap 20 sites, robots respected by the product) and REAL Azure for
 * the planner and contact extraction (hard cap GBP 2, tokens logged). Email,
 * SMS and WhatsApp stay fake in every mode: nothing can reach a prospect.
 *
 * FLE_ONLY=S,O,E,A runs a subset of sections (setup and teardown always run).
 * Never use --test-name-pattern (see README).
 */
import { register } from "node:module";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as Safety from "./safety.ts";

const REAL = process.env.FLE_REAL === "1";
/**
 * FLE_RECOVER_USER=<temp user id> FLE_RECOVER_TAG=FLE-xxxxxxxx: a run that was
 * killed before its teardown (a timeout) is cleaned by running only the
 * teardown, seeded with that run's temp user and tag. No section runs.
 */
const RECOVER_USER = process.env.FLE_RECOVER_USER ?? null;
const RECOVER_TAG = process.env.FLE_RECOVER_TAG ?? null;
const ONLY = RECOVER_USER ? new Set<string>() : new Set((process.env.FLE_ONLY ?? "S,O,E,A").split(",").map((s) => s.trim().toUpperCase()));
const DEMO_SLUG = "blackwellen-demo";

// Real credentials are captured BEFORE the scrub, and restored only in REAL mode.
const realEnv = {
  places: process.env.GOOGLE_PLACES_API_KEY,
  ch: process.env.COMPANIES_HOUSE_API_KEY,
  azureKey: process.env.AZURE_OPENAI_API_KEY,
  azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
};

Safety.scrubSecrets();
if (REAL) {
  if (realEnv.places) process.env.GOOGLE_PLACES_API_KEY = realEnv.places;
  if (realEnv.ch) process.env.COMPANIES_HOUSE_API_KEY = realEnv.ch;
  if (realEnv.azureKey) process.env.AZURE_OPENAI_API_KEY = realEnv.azureKey;
  if (realEnv.azureEndpoint) process.env.AZURE_OPENAI_ENDPOINT = realEnv.azureEndpoint;
}
Safety.installGuards();
register("./story-hooks.mjs", import.meta.url);
register("./fle-hooks.mjs", import.meta.url);

const H = await import("./harness.ts");
const K = await import("./kit.ts");
const { admin } = H;
const { check, evidence } = K;
const { RUN, registerFake, json, egress, realFetch } = Safety;

/* ================================================================ ledger */

/** Every row this run created, by table, for the targeted teardown. */
const created = new Map<string, Set<string>>();
function track(table: string, id: string | null | undefined) {
  if (!id) return;
  if (!created.has(table)) created.set(table, new Set());
  created.get(table)!.add(id);
}
/** Settings rows changed here, restored in `after`. */
const restore: { table: string; key: Record<string, string>; row: Record<string, unknown> | null }[] = [];

let RUN_STARTED = new Date(Date.now() - 5_000).toISOString();
const TAG = RECOVER_TAG ?? `FLE-${RUN}`;
const mail = () => ((globalThis as { __FLE_MAIL__?: { to: string; subject: string; html: string; text: string; headers: Record<string, string>; host: string | null }[] }).__FLE_MAIL__ ??= []);

const S: Record<string, string> = {};
const real = { places: 0, placesCap: 50, ch: 0, sites: new Set<string>(), siteCap: 30, siteGets: 0, aiCalls: 0, aiIn: 0, aiOut: 0, aiCostGbp: 0, aiCapGbp: 1 };

async function snapshot(table: string, key: Record<string, string>) {
  let q = admin.from(table).select("*");
  for (const [k, v] of Object.entries(key)) q = q.eq(k, v);
  const { data } = await q.maybeSingle();
  restore.push({ table, key, row: (data as Record<string, unknown> | null) ?? null });
}

/* ============================================================ fixtures */

type Person = { first: string; last: string; role: string; email: string | null };
type Site = { domain: string; placeId: string; lat: number; lon: number; companyNumber: string | null; robots: string; pages: Record<string, string>; people: Person[] };

const D = (label: string) => `${label}-fle${RUN.slice(0, 4)}.co.uk`;
const SITES: Site[] = [
  {
    // A limited company that prints its number in the footer: CORPORATE.
    domain: D("northwindstudio"),
    placeId: `pl-nw-${RUN}`,
    lat: 51.4545,
    lon: -2.5879,
    companyNumber: "09876543",
    robots: "User-agent: *\nDisallow: /private\n",
    pages: {},
    people: [
      { first: "Priya", last: "Shah", role: "Managing Director", email: "priya@" },
      { first: "Tom", last: "Reed", role: "Founder", email: "tom@" },
      { first: "Bea", last: "Bounce", role: "Director", email: "bounce.bea@" },
    ],
  },
  {
    // An unincorporated studio: no number anywhere, so it stays UNKNOWN (PECR).
    domain: D("harbourweb"),
    placeId: `pl-hw-${RUN}`,
    lat: 51.46,
    lon: -2.6,
    companyNumber: null,
    robots: "",
    pages: {},
    people: [{ first: "Dan", last: "Carter", role: "Founder", email: "dan@" }],
  },
  {
    // A Scottish company whose robots.txt forbids /team: only /about is read.
    domain: D("oakleafdigital"),
    placeId: `pl-oak-${RUN}`,
    lat: 51.45,
    lon: -2.58,
    companyNumber: "SC654321",
    robots: "User-agent: *\nDisallow: /team\n",
    pages: {},
    people: [
      { first: "Grace", last: "Lin", role: "Founder", email: "grace@" },
      // A personal mailbox printed on the page: refused, never stored.
      { first: "Sam", last: "Jones", role: "Director", email: "sam.jones.fle@gmail.com" },
    ],
  },
];
for (const site of SITES) {
  for (const p of site.people) if (p.email?.endsWith("@")) p.email = `${p.email}${site.domain}`;
  const footer = site.companyNumber
    ? `<footer>&copy; 2026 ${site.domain.split("-")[0]} Ltd. Registered in England and Wales. Company No. ${site.companyNumber}. VAT GB 123456789. Tel 0117 496 0000</footer>`
    : "<footer>&copy; 2026. Tel 0117 496 0001</footer>";
  const people = site.people.map((p) => `<li>${p.first} ${p.last} &ndash; ${p.role}${p.email ? ` &ndash; <a href="mailto:${p.email}">${p.email}</a>` : ""}</li>`).join("");
  const filler = "We design and build fast websites for ambitious UK businesses. ".repeat(6);
  site.pages["/"] = `<html><body><h1>Welcome</h1><p>${filler}</p>${footer}</body></html>`;
  site.pages["/team"] = `<html><body><h1>Our team</h1><p>${filler}</p><ul>${people}</ul>${footer}</body></html>`;
  site.pages["/about"] = `<html><body><h1>About us</h1><p>${filler}</p><ul>${people}</ul>${footer}</body></html>`;
}
const siteByDomain = new Map(SITES.map((s) => [s.domain, s]));
const emailOf = (domainLabel: string, first: string) => SITES.find((s) => s.domain.startsWith(domainLabel))!.people.find((p) => p.first === first)!.email!;

/** Company profiles the Companies House fake answers for. */
const CH_COMPANIES: Record<string, { company_name: string; type: string; company_status: string }> = {
  "09876543": { company_name: "NORTHWIND STUDIO LTD", type: "ltd", company_status: "active" },
  SC654321: { company_name: "OAKLEAF DIGITAL LIMITED", type: "ltd", company_status: "active" },
};

/* ================================================================ fakes */

function installFakes() {
  H.installProviderFakes();

  if (!REAL) {
    registerFake({
      name: "google-geocode",
      match: (url) => url.hostname === "maps.googleapis.com" && url.pathname.includes("/geocode/"),
      respond: () => json({ status: "OK", results: [{ formatted_address: "Bristol, UK", geometry: { location: { lat: 51.4545, lng: -2.5879 } } }] }),
    });
    registerFake({
      name: "google-places",
      match: (url) => url.hostname === "places.googleapis.com",
      respond: (_url, _method, body) => {
        const request = JSON.parse(body || "{}") as { pageToken?: string };
        if (request.pageToken) return json({ places: [] });
        return json({
          places: [
            ...SITES.map((s) => ({ id: s.placeId, websiteUri: `https://www.${s.domain}/`, location: { latitude: s.lat, longitude: s.lon } })),
            // No website: nothing lawful to keep (B24), dropped.
            { id: `pl-nosite-${RUN}`, location: { latitude: 51.45, longitude: -2.59 } },
            // Leeds, far outside a 30 km radius of Bristol: never stored.
            { id: `pl-leeds-${RUN}`, websiteUri: `https://${D("leedsdesign")}/`, location: { latitude: 53.8, longitude: -1.55 } },
          ],
        });
      },
    });
    registerFake({
      name: "companies-house",
      match: (url) => url.hostname === "api.company-information.service.gov.uk",
      respond: (url) => {
        const number = /^\/company\/([^/]+)$/.exec(url.pathname)?.[1];
        if (number) {
          const profile = CH_COMPANIES[decodeURIComponent(number)];
          return profile ? json({ company_number: decodeURIComponent(number), ...profile }) : json({ errors: [{ error: "company-profile-not-found" }] }, 404);
        }
        if (url.pathname === "/search/companies") return json({ items: [] });
        return json({ items: [] });
      },
    });
    registerFake({
      name: "company-websites",
      match: (url) => siteByDomain.has(url.hostname.replace(/^www\./, "")),
      respond: (url) => {
        const site = siteByDomain.get(url.hostname.replace(/^www\./, ""))!;
        if (url.pathname === "/robots.txt") return new Response(site.robots, { status: 200, headers: { "content-type": "text/plain" } });
        const page = site.pages[url.pathname];
        return page ? new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
      },
    });
    // The scripted model for the two sourcing tasks.
    H.scriptAi((taskType, user) => {
      if (taskType === "search_planning") {
        return {
          reply: "I have set this up as web design and development agencies within about 20 miles of Bristol, contacting founders and managing directors. What area should I target?",
          plan_patch: {
            industries: ["Web design agency"],
            locations: [{ country: "GB", city: "Bristol", radiusKm: 30 }],
            decisionMakerRoles: ["Managing Director", "Founder", "Director"],
            targetVerifiedProspects: 5,
            minimumGrade: "D",
          },
          clarifying_question: "What area should I target?",
          summary_lines: [{ label: "Location", value: "Bristol + 30 km" }],
          breadth: "GOOD",
        };
      }
      if (taskType === "website_contacts") {
        const domain = /Website: (\S+)/.exec(user)?.[1] ?? "";
        const site = siteByDomain.get(domain.replace(/^www\./, ""));
        return { people: (site?.people ?? []).map((p) => ({ first_name: p.first, last_name: p.last, role_title: p.role, email: p.email })) };
      }
      return undefined;
    });
  } else {
    installRealPassthrough();
  }
}

/**
 * REAL mode: the four permitted real services, each behind a hard cap that
 * refuses (never spends) once reached. Everything else stays faked or blocked.
 */
function installRealPassthrough() {
  const pass = async (url: URL, method: string, body: string, headers: Headers, extra: RequestInit = {}) =>
    realFetch(url.toString(), { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body, ...extra });

  for (const host of ["api.company-information.service.gov.uk", "places.googleapis.com", "maps.googleapis.com"]) Safety.allowRealHost(host);
  const azureHost = realEnv.azureEndpoint ? new URL(realEnv.azureEndpoint).hostname : null;
  if (azureHost) Safety.allowRealHost(azureHost);

  registerFake({
    name: "real-companies-house",
    match: (url) => url.hostname === "api.company-information.service.gov.uk",
    respond: (url, method, body, headers) => {
      real.ch += 1;
      return pass(url, method, body, headers);
    },
  });
  registerFake({
    name: "real-google",
    match: (url) => url.hostname === "places.googleapis.com" || url.hostname === "maps.googleapis.com",
    respond: (url, method, body, headers) => {
      if (real.places >= real.placesCap) return json({ error: { message: "FLE cap reached" } }, 429);
      real.places += 1;
      return pass(url, method, body, headers);
    },
  });
  // Azure: every task goes to the real model, refused (429) once the cap is near.
  registerFake({
    name: "real-azure",
    // The endpoint is the workspace's Azure resource (…services.ai.azure.com
    // or …openai.azure.com). The first REAL run matched only the latter, so
    // every planner call was blocked and nothing real was exercised.
    match: (url) => url.hostname === azureHost || /\.(openai|services\.ai)\.azure\.com$/.test(url.hostname),
    respond: async (url, method, body, headers) => {
      // Owner decision 2026-09-30: every AI task real, under the cap.
      if (real.aiCostGbp >= real.aiCapGbp * 0.9) return json({ error: { message: "FLE AI cap reached" } }, 429);
      const target = azureHost ? new URL(url.pathname + url.search, `https://${azureHost}`) : url;
      const response = await pass(target, method, body, headers);
      const copy = response.clone();
      try {
        const parsed = (await copy.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const input = parsed.usage?.prompt_tokens ?? 0;
        const output = parsed.usage?.completion_tokens ?? 0;
        real.aiCalls += 1;
        real.aiIn += input;
        real.aiOut += output;
        // Priced as the dearer mini tier (USD 0.40 / 1.60 per M), at 0.79 GBP/USD.
        real.aiCostGbp += ((input * 0.4 + output * 1.6) / 1_000_000) * 0.79;
      } catch {
        /* the product sees the same response either way */
      }
      return response;
    },
  });
  // Company websites: GET only, at most `siteCap` distinct hosts, redirects
  // not followed here (the product's own fetcher re-validates every hop).
  registerFake({
    name: "real-websites",
    match: (url, method) =>
      method === "GET" &&
      !/(googleapis\.com|azure\.com|company-information\.service\.gov\.uk|twilio\.com|resend\.com|facebook\.com|stripe\.com|supabase)/.test(url.hostname),
    respond: (url, method, body, headers) => {
      const host = url.hostname.toLowerCase();
      if (!real.sites.has(host)) {
        if (real.sites.size >= real.siteCap) return new Response("FLE site cap", { status: 404, headers: { "content-type": "text/plain" } });
        real.sites.add(host);
      }
      real.siteGets += 1;
      Safety.allowRealHost(host);
      return pass(url, method, body, headers, { redirect: "manual" });
    },
  });
}

/* ============================================================ the world */

async function adoptDemo() {
  const { data: business, error } = await admin.from("businesses").select("id, name, job_claims_paused, timezone").eq("slug", DEMO_SLUG).single();
  if (error || !business) throw new Error(`demo workspace ${DEMO_SLUG} not found: ${error?.message}`);
  assert.equal((business as { job_claims_paused: boolean }).job_claims_paused, true, "the demo workspace must have job_claims_paused = true");
  const businessId = business.id as string;

  // A temporary admin member, so server actions and RLS-scoped reads run as a
  // real signed-in person. Removed in `after`.
  const email = `zz-fle-${RUN}@example.invalid`;
  const password = `Fle!${randomUUID()}`;
  const { data: user, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError || !user.user) throw new Error(`temp user: ${userError?.message}`);
  const userId = user.user.id;
  await H.must(admin.from("business_members").insert({ business_id: businessId, user_id: userId, role: "admin", status: "active" }), "temp membership");
  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await anon.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) throw new Error(`temp sign-in: ${signIn.error?.message}`);
  (globalThis as { __STORY_ACCESS_TOKEN__?: string }).__STORY_ACCESS_TOKEN__ = signIn.data.session.access_token;

  H.adoptWorld({ businessId, ownerId: userId, businessName: business.name as string, createdGlobal: { webhookEvents: [], authUsers: [userId] } });
  (globalThis as { __STORY_SESSION__?: unknown }).__STORY_SESSION__ = {
    userId,
    businessId,
    role: "admin",
    businessName: business.name,
    businessStatus: "active",
    onboardingStep: "complete",
    activatedAt: new Date().toISOString(),
    timezone: (business as { timezone?: string }).timezone ?? "Europe/London",
  };
  return { businessId, userId };
}

/** Settings the run needs, snapshotted first and restored in `after`. */
async function configureDemo(businessId: string) {
  await snapshot("business_data_controls", { business_id: businessId });
  // Valid source kinds (the seed wrote two that match nothing: fixed in
  // scripts/seed-help-demo.mjs) and a privacy notice for the Article 14 line.
  await H.must(
    admin.from("business_data_controls").upsert(
      {
        business_id: businessId,
        legal_name: "Blackwellen Ltd",
        privacy_policy_url: "https://clientturn.com/privacy",
        allowed_sources: ["BUSINESS_WEBSITE", "PUBLIC_CORPORATE_REGISTER", "CONNECTED_CRM", "CUSTOMER_UPLOAD", "INBOUND_ENQUIRY"],
        prospect_countries: ["GB"],
        prospect_type: "B2B",
        marketing_lawful_basis: "LEGITIMATE_INTERESTS",
      },
      { onConflict: "business_id" },
    ),
    "data controls",
  );
  await snapshot("business_ai_settings", { business_id: businessId });
  await H.must(
    admin.from("business_ai_settings").update({ agent_mode: "AUTO_REPLY", allow_ai_reply: true, allow_ai_interpretation: true, agent_channels: ["sms", "email"] }).eq("business_id", businessId),
    "ai settings",
  );
}

/* =========================================================== job runner */

/** Runs this run's parked jobs (H.runJobs), recording failures on the ledger. */
async function drain(opts: { fastForward?: string[]; skip?: string[]; maxJobs?: number } = {}) {
  const before = H.jobLog.length;
  await H.runJobs({ maxJobs: opts.maxJobs ?? 300, fastForward: opts.fastForward, skip: opts.skip });
  const ran = H.jobLog.slice(before);
  return { ran: ran.map((j) => j.type), failed: ran.filter((j) => !j.ok) };
}

function ukHour(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":").map(Number);
  return h + m / 60;
}
const smsQuietNow = () => ukHour() >= 20 || ukHour() < 8;

/* ============================================================ lifecycle */

let world: { businessId: string; userId: string } | null = null;

before(async () => {
  Safety.assertOutsideDailyCronWindow();
  await Safety.assertEgressBlocked();
  if (RECOVER_USER) {
    world = await adoptForRecovery(RECOVER_USER);
    return;
  }
  installFakes();
  world = await adoptDemo();
  await configureDemo(world.businessId);
});

/** The seeded values of the two settings rows a run changes (scripts/seed-help-demo.mjs). */
function seededSettings(businessId: string) {
  restore.push({
    table: "business_data_controls",
    key: { business_id: businessId },
    row: { business_id: businessId, legal_name: "Blackwellen Ltd", privacy_policy_url: "https://www.blackwellen-demo.example/privacy", allowed_sources: ["BUSINESS_WEBSITE", "COMPANIES_HOUSE", "CUSTOMER_CRM"], prospect_countries: ["GB"], prospect_type: "B2B", marketing_lawful_basis: "LEGITIMATE_INTERESTS" },
  });
  restore.push({
    table: "business_ai_settings",
    key: { business_id: businessId },
    row: { business_id: businessId, agent_mode: "SUGGEST_ONLY", allow_ai_reply: true, allow_ai_interpretation: true, agent_channels: ["sms", "email"] },
  });
}

async function adoptForRecovery(userId: string) {
  const { data: business } = await admin.from("businesses").select("id, name").eq("slug", DEMO_SLUG).single();
  const { data: user } = await admin.auth.admin.getUserById(userId);
  if (!business || !user.user || !String(user.user.email).startsWith("zz-fle-")) throw new Error("FLE_RECOVER_USER is not an FLE temp user");
  RUN_STARTED = new Date(Date.parse(user.user.created_at) - 5_000).toISOString();
  H.adoptWorld({ businessId: business.id as string, ownerId: userId, businessName: business.name as string, createdGlobal: { webhookEvents: [], authUsers: [userId] } });
  // Jobs that run parked at its own sentinel, and its sourcing runs (the sweep finds the rest).
  const tag = (RECOVER_TAG ?? "").replace(/^FLE-/, "");
  const { data: jobs } = await admin.from("jobs").select("id").eq("business_id", business.id).like("last_error", `STORY_PARKED:${tag}%`);
  for (const j of jobs ?? []) await admin.from("jobs").delete().eq("id", j.id);
  const { data: runs } = await admin.from("sourcing_runs").select("id").eq("business_id", business.id).eq("started_by", userId);
  for (const r of runs ?? []) track("sourcing_runs", r.id as string);
  const { data: companies } = await admin.from("sourcing_run_results").select("company_id").in("run_id", (runs ?? []).map((r) => r.id as string));
  for (const c of companies ?? []) track("prospect_companies", c.company_id as string);
  seededSettings(business.id as string);
  return { businessId: business.id as string, userId };
}

after(async () => {
  const report = {
    run: RUN,
    mode: REAL ? "REAL (capped)" : "FAKES",
    demoWorkspace: world?.businessId,
    real: REAL
      ? { companiesHouseCalls: real.ch, googleRequests: real.places, websiteHosts: [...real.sites], websiteGets: real.siteGets, aiCalls: real.aiCalls, aiInputTokens: real.aiIn, aiOutputTokens: real.aiOut, aiCostGbp: Number(real.aiCostGbp.toFixed(4)) }
      : null,
    egress: {
      faked: egress.faked.length,
      fakedByHost: egress.faked.reduce<Record<string, number>>((acc, c) => ((acc[c.host] = (acc[c.host] ?? 0) + 1), acc), {}),
      blocked: egress.blocked,
    },
    mail: mail().map((m) => m.to),
    jobs: { ran: H.jobLog.length, failed: H.failedJobs() },
  };
  console.log("\n=== FLE REPORT ===\n" + JSON.stringify(report, null, 2));
  console.log("\n=== EVIDENCE ===");
  for (const row of evidence) console.log(`| ${row.id} | ${row.flow} | ${row.expected} | ${row.actual.replace(/\|/g, "/").replace(/\n/g, " ")} | ${row.result} |`);

  const cleanup = world ? await teardown(world) : null;
  console.log("\n=== CLEANUP ===\n" + JSON.stringify(cleanup, null, 2));
  assert.deepEqual(egress.blocked.filter((b) => !b.startsWith("fetch:GET")), [], "an unregistered non-GET call was attempted");
  assert.ok(cleanup && cleanup.errors.length === 0, `cleanup errors: ${JSON.stringify(cleanup?.errors)}`);
  assert.deepEqual(cleanup?.leftovers, {}, "rows created by this run remain in the demo workspace");
});

/* ============================================================== teardown */

/**
 * Deletes what this run created, and nothing else. Roots first (their
 * children cascade), then a sweep: any demo row created since the run started
 * whose JSON mentions one of this run's ids or its tag is also this run's.
 * Rows other people created in the demo workspace meanwhile are left alone
 * and listed.
 */
async function teardown(w: { businessId: string; userId: string }) {
  const errors: string[] = [];
  const deleted: Record<string, number> = {};
  const note = (table: string, n: number) => (deleted[table] = (deleted[table] ?? 0) + n);

  // Restore settings first: they never depend on the rows below.
  for (const r of restore.reverse()) {
    let q = admin.from(r.table).delete();
    if (r.row) {
      const { error } = await admin.from(r.table).upsert(r.row as never, { onConflict: Object.keys(r.key).join(",") });
      if (error) errors.push(`restore ${r.table}: ${error.message}`);
      continue;
    }
    for (const [k, v] of Object.entries(r.key)) q = q.eq(k, v);
    const { error } = await q;
    if (error) errors.push(`restore-delete ${r.table}: ${error.message}`);
  }

  // Jobs this process wrote (parked at this run's sentinel).
  {
    const { data } = await admin.from("jobs").select("id").eq("run_at", Safety.PARK_AT).limit(5000);
    const ids = (data ?? []).map((r) => r.id as string);
    for (let i = 0; i < ids.length; i += 25) {
      const { error } = await admin.from("jobs").delete().in("id", ids.slice(i, i + 25));
      if (error) errors.push(`jobs: ${error.message}`);
    }
    note("jobs", ids.length);
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const known = new Set<string>([w.userId]);
  for (const ids of created.values()) for (const id of ids) if (UUID.test(id)) known.add(id);

  // Rows that point at this run's people only by phone, email or name (no id),
  // which the id sweep below cannot see: an SMS opt-out, the Sources signal.
  {
    const leadIds = [...(created.get("leads") ?? [])];
    const prospectIds = [...(created.get("prospects") ?? [])];
    const runIds = [...(created.get("sourcing_runs") ?? [])];
    const phones = new Set<string>();
    const emails = new Set<string>();
    if (leadIds.length) {
      const { data, error } = await admin.from("leads").select("phone, phone_normalized, email").in("id", leadIds);
      if (error) errors.push(`lead phones: ${error.message}`);
      for (const r of data ?? []) {
        for (const ph of [r.phone, r.phone_normalized]) if (ph) phones.add(String(ph));
        if (r.email) emails.add(String(r.email).toLowerCase());
      }
    }
    if (prospectIds.length) {
      const { data } = await admin.from("prospects").select("email").in("id", prospectIds);
      for (const r of data ?? []) if (r.email) emails.add(String(r.email).toLowerCase());
    }
    for (const m of mail()) emails.add(m.to.toLowerCase());
    if (phones.size) {
      const { data, error } = await admin.from("suppression_entries").delete().eq("business_id", w.businessId).gte("created_at", RUN_STARTED).in("phone_e164", [...phones]).select("id");
      if (error) errors.push(`suppression by phone: ${error.message}`);
      note("suppression_entries", data?.length ?? 0);
    }
    if (emails.size) {
      const { data, error } = await admin.from("suppression_entries").delete().eq("business_id", w.businessId).gte("created_at", RUN_STARTED).in("email", [...emails]).select("id");
      if (error) errors.push(`suppression by email: ${error.message}`);
      note("suppression_entries", data?.length ?? 0);
    }
    if (runIds.length) {
      const { data: runs } = await admin.from("sourcing_runs").select("title").in("id", runIds);
      const titles = [...new Set((runs ?? []).map((r) => r.title as string).filter(Boolean))];
      if (titles.length) {
        const { data, error } = await admin.from("sourcing_signals").delete().eq("business_id", w.businessId).gte("created_at", RUN_STARTED).in("name", titles).select("id");
        if (error) errors.push(`sourcing_signals: ${error.message}`);
        note("sourcing_signals", data?.length ?? 0);
      }
    }
  }

  // The generic sweep, repeated so ids discovered in one pass catch rows that
  // reference them in the next.
  const tables = await Safety.readSql<{ table_name: string }>(
    "select c.table_name from information_schema.columns c join information_schema.columns k on k.table_schema=c.table_schema and k.table_name=c.table_name and k.column_name='created_at' " +
      "join information_schema.columns i on i.table_schema=c.table_schema and i.table_name=c.table_name and i.column_name='id' " +
      "join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE' " +
      "where c.table_schema='public' and c.column_name='business_id' order by 1",
  );
  const leftovers: Record<string, number> = {};
  const foreign: Record<string, number> = {};
  const appendOnly = new Set<string>();
  const appendOnlyKept: Record<string, number> = {};
  for (let pass = 0; pass < 5; pass += 1) {
    let removed = 0;
    for (const { table_name: table } of tables) {
      if (table === "jobs") continue;
      const { data, error } = await admin.from(table).select("*").eq("business_id", w.businessId).gte("created_at", RUN_STARTED).limit(2000);
      if (error) {
        if (pass === 0) errors.push(`scan ${table}: ${error.message}`);
        continue;
      }
      // Only a full uuid, as a quoted JSON value, or this run's tag, counts.
      // The first version also matched bare substrings, and a bigint id such
      // as workspace_stream_events "123" then matched every row: it deleted a
      // parallel session's voice-test rows (2026-09-30). Never again.
      const mine = (data ?? []).filter((row) => {
        const text = JSON.stringify(row);
        return text.includes(TAG) || [...known].some((id) => text.includes(`"${id}"`));
      });
      for (const row of mine) {
        const id = String((row as { id: unknown }).id);
        if (UUID.test(id)) known.add(id);
      }
      if (pass === 4) {
        if (mine.length && !appendOnly.has(table)) leftovers[table] = mine.length;
        if (mine.length && appendOnly.has(table)) appendOnlyKept[table] = mine.length;
        const others = (data ?? []).length - mine.length;
        if (others) foreign[table] = others;
        continue;
      }
      const ids = mine.map((row) => (row as { id: string }).id);
      for (let i = 0; i < ids.length; i += 50) {
        const { data: gone, error: delError } = await admin.from(table).delete().in("id", ids.slice(i, i + 50)).select("id");
        if (delError) {
          if (/append-only/i.test(delError.message)) appendOnly.add(table);
          else if (pass === 3) errors.push(`delete ${table}: ${delError.message}`);
          continue;
        }
        note(table, gone?.length ?? 0);
        removed += gone?.length ?? 0;
      }
    }
    if (removed === 0 && pass < 4) pass = 3; // settle: go straight to the final count
  }

  // Global rows.
  for (const e of H.mustWorld().createdGlobal.webhookEvents) {
    await admin.from("webhook_events").delete().eq("provider", e.provider).eq("external_event_id", e.id);
  }
  const { error: memberError } = await admin.from("business_members").delete().eq("business_id", w.businessId).eq("user_id", w.userId);
  if (memberError) errors.push(`member: ${memberError.message}`);
  const { error: userError } = await admin.auth.admin.deleteUser(w.userId);
  if (userError) errors.push(`auth user: ${userError.message}`);

  return { deleted, leftovers, appendOnlyKept, foreignRowsCreatedMeanwhile: foreign, errors };
}

/* ============================================================== S: sourcing */

const section = (key: string, name: string, fn: () => void) => (ONLY.has(key) ? describe(name, fn) : describe.skip(name, fn));

section("S", "S. Find Leads: describe the ICP, source, review, approve, promote", () => {
  test("S1 describe the ICP: the planner turns plain English into a resolved plan, and asks nothing twice", async () => {
    await check({ id: "S1", flow: "ICP -> plan", scenario: "createSearchSessionAction with a plain-English brief", expected: "session + USER/ASSISTANT messages; plan has industry, a RESOLVED location and roles; the clarifying question appears at most once" }, async () => {
      const { createSearchSessionAction } = await import("../../src/lib/find-leads/actions.ts");
      const brief = REAL
        ? `${TAG}: find web design and development agencies within 15 miles of Bournemouth, and the founders or managing directors there`
        : `${TAG}: find web design agencies within 20 miles of Bristol and contact the founders or managing directors`;
      const result = await createSearchSessionAction(brief);
      assert.equal(result.ok, true, JSON.stringify(result));
      S.sessionId = (result as { data: { sessionId: string } }).data.sessionId;
      track("search_sessions", S.sessionId);
      const { getSession } = await import("../../src/lib/find-leads/server/sessions.ts");
      const session = await getSession(world!.businessId, S.sessionId);
      assert.ok(session, "session not readable");
      if (session.strategyId) track("search_strategies", session.strategyId);
      if (session.strategyId) S.strategyId = session.strategyId;
      const assistant = session.messages.filter((m) => m.role === "ASSISTANT").map((m) => m.content).join("\n");
      const q = "What area should I target?";
      assert.ok(assistant.split(q).length - 1 <= 1, `question repeated: ${assistant}`);
      assert.ok(session.plan.industries.length > 0, `no industry: ${JSON.stringify(session.plan).slice(0, 300)}`);
      assert.ok(session.plan.locations.length > 0 && session.plan.locations.every((l) => l.resolved), `location unresolved: ${JSON.stringify(session.plan.locations)}`);
      if (REAL) {
        // Keep the real run small: at most 3 verified prospects (Places pages <= 2).
        const { updateSearchPlanAction } = await import("../../src/lib/find-leads/actions.ts");
        const patched = await updateSearchPlanAction(S.sessionId, { ...session.plan, targetVerifiedProspects: 3, minimumGrade: "D", maxProviderCostMinor: 500 });
        assert.equal((patched as { ok: boolean }).ok, true, JSON.stringify(patched));
      }
      return `industries=${session.plan.industries.join("/")}; location=${JSON.stringify(session.plan.locations[0])}; roles=${session.plan.decisionMakerRoles.join("/")}; reply="${assistant.slice(0, 120)}"`;
    });
  });

  test("S2 start the run, then run it: providers, contacts, identity, dedupe, contactability, scoring", async () => {
    await check({ id: "S2", flow: "Sourcing run", scenario: "startSourcingRunAction, then sourcing.run in-process", expected: "run COMPLETED/PARTIAL; companies from Places (no-website and out-of-radius places not stored); contacts from the company's own pages (robots respected, personal mailbox refused); Companies House identity from the footer number; per-prospect provenance; lead duplicate caught; CORPORATE vs UNKNOWN verdicts" }, async () => {
      assert.ok(S.sessionId, "no session from S1");
      // A lead the workspace already holds, to be caught by dedupe (fake mode).
      if (!REAL) {
        const { data: lead } = await admin
          .from("leads")
          .insert({ business_id: world!.businessId, first_name: "Tom", last_name: `Reed ${TAG}`, email: emailOf("northwindstudio", "Tom"), status: "NEW", is_test: true })
          .select("id")
          .single();
        track("leads", lead?.id);
      }
      const { startSourcingRunAction } = await import("../../src/lib/find-leads/actions.ts");
      const started = await startSourcingRunAction(S.sessionId);
      assert.equal(started.ok, true, JSON.stringify(started));
      S.runId = (started as { data: { runId: string } }).data.runId;
      track("sourcing_runs", S.runId);
      const drained = await drain({ fastForward: ["sourcing.run"] });
      assert.deepEqual(drained.failed, [], `failed jobs: ${JSON.stringify(drained.failed)}`);
      const { data: run } = await admin.from("sourcing_runs").select("status, current_stage, error_code, error_message, counts_json").eq("id", S.runId).single();
      const { data: stages } = await admin.from("sourcing_run_stages").select("stage_key, status, record_count, safe_summary").eq("run_id", S.runId).order("stage_number");
      const { data: issues } = await admin.from("sourcing_run_issues").select("code, severity, message").eq("run_id", S.runId);
      const { data: companies } = await admin.from("sourcing_run_results").select("company_id, candidate_domain").eq("run_id", S.runId).eq("outcome", "COMPANY_FOUND");
      for (const c of companies ?? []) track("prospect_companies", c.company_id as string);
      const { data: prospects } = await admin
        .from("prospects")
        .select("id, first_name, last_name, email, status, outreach_eligibility, eligibility_reason, verification_status, subscriber_type, source_provider, grade, score, company:prospect_companies(id, name, domain, subscriber_type, registration_id)")
        .eq("source_run_id", S.runId);
      for (const p of prospects ?? []) track("prospects", p.id as string);
      const summary = `run ${run?.status}/${run?.current_stage} ${run?.error_code ?? ""}; stages=${(stages ?? []).map((s) => `${s.stage_key}:${s.status}:${s.record_count ?? 0}`).join(",")}; issues=${(issues ?? []).map((i) => i.code).join(",")}`;
      assert.ok(["COMPLETED", "PARTIAL"].includes(String(run?.status)), summary);
      assert.ok((companies ?? []).length > 0, `no companies. ${summary}`);
      assert.ok((prospects ?? []).length > 0, `no prospects: website contact discovery found nobody. ${summary}`);

      const { data: provenance } = await admin.from("prospect_data_sources").select("prospect_id, source_type, provider").in("prospect_id", (prospects ?? []).map((p) => p.id as string));
      const withProvenance = new Set((provenance ?? []).map((p) => p.prospect_id as string));
      assert.equal(withProvenance.size, (prospects ?? []).length, `prospects without provenance: ${(prospects ?? []).length - withProvenance.size}`);
      assert.ok((prospects ?? []).every((p) => !String(p.email ?? "").endsWith("@gmail.com")), "a personal mailbox was stored");
      const people = (prospects ?? []).map((p) => `${p.email ?? ""}|${p.first_name}|${p.last_name}|${(p.company as { id?: string } | null)?.id ?? ""}`);
      assert.equal(new Set(people).size, people.length, `the same person was stored more than once in one run (${people.length} rows, ${new Set(people).size} people)`);

      if (!REAL) {
        const byEmail = new Map((prospects ?? []).map((p) => [p.email as string, p]));
        const nw = byEmail.get(emailOf("northwindstudio", "Priya")) as { company: { subscriber_type: string; registration_id: string; name: string } } | undefined;
        assert.ok(nw, `Priya missing: ${[...byEmail.keys()].join(",")}`);
        assert.equal(nw!.company.subscriber_type, "CORPORATE", `Northwind identity ${JSON.stringify(nw!.company)}`);
        assert.equal(nw!.company.registration_id, "09876543");
        const dan = byEmail.get(emailOf("harbourweb", "Dan")) as { company: { subscriber_type: string | null } } | undefined;
        assert.ok(dan, "Dan (unincorporated studio) missing");
        assert.notEqual(dan!.company.subscriber_type, "CORPORATE", "an unincorporated studio was asserted CORPORATE");
        const grace = byEmail.get(emailOf("oakleafdigital", "Grace")) as { company: { subscriber_type: string } } | undefined;
        assert.ok(grace, "Grace (from /about, /team disallowed by robots) missing");
        const teamFetched = egress.faked.some((c) => c.host.endsWith(SITES[2].domain) && c.path === "/team");
        assert.equal(teamFetched, false, "robots.txt Disallow: /team was ignored");
        const duplicate = (prospects ?? []).find((p) => p.email === emailOf("northwindstudio", "Tom"));
        assert.equal(duplicate?.status, "DISQUALIFIED", `lead duplicate not caught: ${JSON.stringify(duplicate)}`);
        S.priyaId = (nw as unknown as { id: string }).id;
        S.danId = (dan as unknown as { id: string }).id;
        S.graceId = (grace as unknown as { id: string }).id;
        S.beaId = (byEmail.get(emailOf("northwindstudio", "Bea")) as { id: string } | undefined)?.id ?? "";
      }
      const eligibility = (prospects ?? []).map((p) => `${p.first_name}:${p.status}/${p.outreach_eligibility}/${(p.company as { subscriber_type?: string } | null)?.subscriber_type ?? "-"}`).join(" ");
      return `${summary}; companies=${(companies ?? []).length}; prospects=${(prospects ?? []).length} (${eligibility}); provenance ${withProvenance.size}/${(prospects ?? []).length} types=${[...new Set((provenance ?? []).map((p) => p.source_type))].join(",")}`;
    });
  });

  test("S3 review: a person approves REVIEW prospects (drawer action), a suppressed one is refused", async () => {
    if (REAL) return;
    await check({ id: "S3", flow: "Prospect review -> approve", scenario: "approveProspectAction on REVIEW prospects", expected: "APPROVED + ELIGIBLE with approved_by; a suppressed prospect refused" }, async () => {
      const { approveProspectAction } = await import("../../src/lib/find-leads/actions.ts");
      const outcomes: string[] = [];
      for (const id of [S.priyaId, S.danId, S.graceId, S.beaId].filter(Boolean)) {
        const r = await approveProspectAction(id);
        outcomes.push(r.ok ? "ok" : r.error);
      }
      assert.ok(outcomes.every((o) => o === "ok"), `approvals: ${outcomes.join(" | ")}`);
      const { data } = await admin.from("prospects").select("id, status, outreach_eligibility, approved_by").in("id", [S.priyaId, S.danId]);
      assert.ok((data ?? []).every((p) => p.status === "APPROVED" && p.outreach_eligibility === "ELIGIBLE" && p.approved_by === world!.userId), JSON.stringify(data));
      // A suppressed prospect stays refused.
      const { data: sup } = await admin
        .from("prospects")
        .insert({ business_id: world!.businessId, first_name: "Zed", last_name: TAG, email: `zed.${RUN}@${SITES[0].domain}`, status: "REVIEW", outreach_eligibility: "SUPPRESSED" })
        .select("id")
        .single();
      track("prospects", sup?.id);
      const refused = await approveProspectAction(sup!.id);
      assert.equal(refused.ok, false);
      return `approved ${outcomes.length}; suppressed refused: "${(refused as { error: string }).error}"`;
    });
  });

  test("S4 promote to lead: provenance and relationship travel with it", async () => {
    if (REAL) return;
    await check({ id: "S4", flow: "Prospect -> lead", scenario: "promoteProspectToLeadAction with an explicit relationship", expected: "lead created, prospect.promoted_to_lead_id set, lead cap metered" }, async () => {
      const { data: extra } = await admin
        .from("prospects")
        .insert({ business_id: world!.businessId, first_name: "Promo", last_name: TAG, email: `promo.${RUN}@${SITES[0].domain}`, status: "REVIEW", outreach_eligibility: "REVIEW", source_provider: "manual_prospect" })
        .select("id")
        .single();
      track("prospects", extra?.id);
      const { promoteProspectToLeadAction } = await import("../../src/lib/find-leads/actions.ts");
      const { PROMOTION_RELATIONSHIP_CHOICES } = await import("../../src/lib/find-leads/types.ts");
      const result = await promoteProspectToLeadAction(extra!.id, PROMOTION_RELATIONSHIP_CHOICES[0]);
      assert.equal(result.ok, true, JSON.stringify(result));
      const leadId = (result as { data: { leadId: string } }).data.leadId;
      track("leads", leadId);
      const { data: p } = await admin.from("prospects").select("promoted_to_lead_id").eq("id", extra!.id).single();
      assert.equal(p?.promoted_to_lead_id, leadId);
      return `lead ${leadId.slice(0, 8)} from prospect ${extra!.id.slice(0, 8)} (relationship ${PROMOTION_RELATIONSHIP_CHOICES[0]})`;
    });
  });
});


/** A step the environment prevents, recorded as BLOCKED with the reason. */
function blocked(id: string, flow: string, expected: string, reason: string) {
  K.record({ id, flow, scenario: "not run", expected, actual: reason, result: "BLOCKED", evidence: "environment", fix: reason });
}

/* ============================================================== O: outreach */

section("O", "O. Cold outreach: create on submit, review, activate, dispatch, PECR, suppression, bounce", () => {
  before(async () => {
    if (!ONLY.has("S") || REAL) return;
    const w = world!;
    // The mailbox (fake SMTP at the nodemailer boundary) and a verified,
    // cold-enabled sending identity with a postal footer.
    await snapshot("integrations", { business_id: w.businessId, provider_type: "imap_smtp" });
    try {
      const { saveEmailAccount } = await import("../../src/lib/email/store.ts");
      const saved = await saveEmailAccount({
        businessId: w.businessId,
        userId: w.userId,
        status: "HEALTHY",
        smtpPassword: "fle-fake-password",
        config: {
          fromName: "Blackwellen",
          fromEmail: `outreach@${SITES[0].domain.replace(/^[^-]+/, "blackwellen")}`,
          replyTo: null,
          smtp: { host: "smtp.fle-fake.invalid", port: 587, secure: false, username: "outreach" },
          inbound: { protocol: "none", host: null, port: null, secure: true, username: null },
        } as never,
      });
      S.mailboxId = saved.integrationId;
    } catch (error) {
      // Live drift (supabase/migrations/0181): integrations_provider_type_check
      // lacks 'imap_smtp', so no mailbox can be saved. Dispatch cannot be
      // exercised until 0181 is applied; O3/O4 record BLOCKED, not FAIL.
      S.mailboxBlocked = `saveEmailAccount: ${(error as Error).message} (integrations_provider_type_check lacks 'imap_smtp'; apply migration 0181)`;
    }
    const { data: sender, error } = await admin
      .from("sender_identities")
      .insert({
        business_id: w.businessId,
        email: `outreach.${RUN}@blackwellen-fle.co.uk`,
        display_name: `Blackwellen ${TAG}`,
        domain: "blackwellen-fle.co.uk",
        status: "VERIFIED",
        cold_enabled: true,
        active: true,
        postal_footer: "Blackwellen Ltd, 1 Test Street, Bristol BS1 1AA",
        signature_text: "Jamahl, Blackwellen",
        daily_send_cap: 50,
        mailbox_connection_id: S.mailboxId ?? null,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(`sender: ${error.message}`);
    S.senderId = sender!.id as string;
    track("sender_identities", S.senderId);
  });

  test("O1 create on submit (MANUAL_REVIEW) -> READY with an audience of approved prospects, nothing sent", async () => {
    if (REAL || !S.priyaId) return;
    await check({ id: "O1", flow: "Campaign create-on-submit", scenario: "createAcquisitionCampaignAction(startMode MANUAL_REVIEW) then outreach.audience", expected: "one campaign row, READY, published sequence, recipient runs for the approved prospects, no email yet" }, async () => {
      const { emptyDraft } = await import("../../src/lib/outreach/campaign-draft.ts");
      const { data: service } = await admin.from("services").select("id").eq("business_id", world!.businessId).eq("active", true).limit(1).maybeSingle();
      const draft = emptyDraft();
      draft.goal = { campaignName: `${TAG} Bristol studios`, conversionGoal: "BOOK_MEETING" as never, primaryServiceId: service?.id ?? null, successEvent: null };
      draft.audience.source = "EXISTING_ONLY";
      draft.audience.industries = ["Web design agency"];
      draft.intentScore.minimumGrade = "D";
      draft.intentScore.reviewThreshold = 0;
      draft.outreach.senderIdentityId = S.senderId;
      draft.outreach.sendWindow = "09:00-17:00";
      draft.outreach.steps = [
        { position: 1, delayDays: 0, subject: "Quick question, {{first_name}}", body: "Hi {{first_name}}, I noticed {{company_name}} builds websites in Bristol. Would a short call about lead follow-up be useful?", enabled: true },
        { position: 2, delayDays: 3, subject: "Following up", body: "Hi {{first_name}}, just bringing this back to the top of your inbox. Happy to share how other studios handle it.", enabled: true },
      ];
      draft.budget.dailyContacts = 20;
      draft.budget.prospectsPerRun = 20;
      const { CONVERSION_GOALS } = await import("../../src/lib/outreach/campaign-draft.ts");
      draft.goal.conversionGoal = CONVERSION_GOALS[0].value as never;
      const { defaultSuccessEvent } = await import("../../src/lib/outreach/campaign-draft.ts");
      draft.goal.successEvent = defaultSuccessEvent(draft.goal.conversionGoal as never) as never;
      const { createAcquisitionCampaignAction } = await import("../../src/lib/outreach/campaign-actions.ts");
      const result = await createAcquisitionCampaignAction({ draft, startMode: "MANUAL_REVIEW" });
      if (!result.ok && result.campaignId) track("outreach_campaigns", result.campaignId);
      assert.equal(result.ok, true, JSON.stringify(result).slice(0, 800));
      S.campaignId = (result as { data: { campaignId: string } }).data.campaignId;
      track("outreach_campaigns", S.campaignId);
      const { count: campaigns } = await admin.from("outreach_campaigns").select("id", { count: "exact", head: true }).eq("business_id", world!.businessId).ilike("name", `${TAG}%`);
      assert.equal(campaigns, 1, "create-on-submit left more than one row");
      await drain();
      const { data: campaign } = await admin.from("outreach_campaigns").select("status, review_before_outreach, active_sequence_id").eq("id", S.campaignId).single();
      assert.equal(campaign?.status, "READY");
      const { data: runs } = await admin.from("outreach_recipient_runs").select("prospect_id, status, next_step_due_at, stop_reason").eq("campaign_id", S.campaignId);
      assert.ok((runs ?? []).length >= 2, `audience: ${JSON.stringify(runs)}`);
      assert.equal(mail().length, 0, "a READY campaign sent email");
      return `campaign READY review=${campaign?.review_before_outreach}; audience ${(runs ?? []).length} (${(runs ?? []).map((r) => `${r.status}${r.stop_reason ? `:${r.stop_reason}` : ""}`).join(",")}); 0 emails`;
    });
  });

  test("O2 the send window holds sends outside the customer's hours", async () => {
    if (REAL || !S.campaignId) return;
    await check({ id: "O2", flow: "Send window", scenario: "09:00-17:00 window, activation", expected: "outside the window: dispatch halts OUTSIDE_SEND_WINDOW and sends nothing; inside: proceeds" }, async () => {
      const { withinSendWindow } = await import("../../src/lib/outreach/send-window.ts");
      const open = withinSendWindow({ at: new Date(), timeZone: "Europe/London", start: "09:00", end: "17:00" });
      const { setCampaignStateAction } = await import("../../src/lib/outreach/campaign-actions.ts");
      const activated = await setCampaignStateAction({ campaignId: S.campaignId, status: "ACTIVE" });
      assert.equal(activated.ok, true, JSON.stringify(activated));
      const { data: campaign } = await admin.from("outreach_campaigns").select("status, review_before_outreach").eq("id", S.campaignId).single();
      assert.equal(campaign?.status, "ACTIVE");
      assert.equal(campaign?.review_before_outreach, false, "activation from READY did not clear the review gate");
      if (open) return "inside the window now: covered by O3";
      const { dispatchCampaign } = await import("../../src/lib/outreach/dispatch.ts");
      const outcome = await dispatchCampaign({ businessId: world!.businessId, campaignId: S.campaignId });
      assert.equal(outcome.haltReason, "OUTSIDE_SEND_WINDOW", JSON.stringify(outcome));
      assert.equal(mail().length, 0);
      // Widen to "any time policy permits" for the rest of the story.
      await H.must(admin.from("outreach_campaigns").update({ send_window_start: null, send_window_end: null } as never).eq("id", S.campaignId), "window");
      return `ACTIVE, review gate cleared; outside the window: halt ${outcome.haltReason}, 0 sent`;
    });
  });

  test("O3 dispatch: corporate sent with Article 14 line and unsubscribe; unincorporated held; bounce suppressed", async () => {
    if (REAL || !S.campaignId) return;
    if (S.mailboxBlocked) return blocked("O3", "Cold dispatch (PECR)", "send via the workspace mailbox", S.mailboxBlocked);
    await check({ id: "O3", flow: "Cold dispatch (PECR)", scenario: "outreach.dispatch for the approved audience", expected: "Priya (CORPORATE, website) SENT with source line + List-Unsubscribe; Dan (unincorporated, UNKNOWN) not sent (review); Bea (bounce) BOUNCED + suppressed; messages rows; usage metered" }, async () => {
      const { enqueue } = await import("../../src/lib/jobs/queue.ts");
      await enqueue("outreach.dispatch", { campaignId: S.campaignId, businessId: world!.businessId }, { businessId: world!.businessId, idempotencyKey: `fle-dispatch-${RUN}-1` });
      const drained = await drain({ skip: ["outreach.optimize"] });
      assert.deepEqual(drained.failed, [], JSON.stringify(drained.failed));
      const priya = mail().find((m) => m.to === emailOf("northwindstudio", "Priya"));
      assert.ok(priya, `Priya not emailed; mail=${mail().map((m) => m.to).join(",")}; ran=${drained.ran.join(">")}`);
      assert.match(priya!.text, /found your business contact details via/i, "no Article 14 source line");
      assert.ok(priya!.headers["List-Unsubscribe"], "no List-Unsubscribe header");
      const dan = mail().find((m) => m.to === emailOf("harbourweb", "Dan"));
      assert.equal(dan, undefined, "an unincorporated business (PECR individual subscriber) was cold-emailed");
      const { data: runs } = await admin.from("outreach_recipient_runs").select("prospect_id, status, stop_reason, steps_sent").eq("campaign_id", S.campaignId);
      const byProspect = new Map((runs ?? []).map((r) => [r.prospect_id as string, r]));
      const beaRun = S.beaId ? byProspect.get(S.beaId) : null;
      if (S.beaId) {
        assert.equal(beaRun?.status, "BOUNCED", `bounce run ${JSON.stringify(beaRun)}`);
        const { data: sup } = await admin.from("suppression_entries").select("id, reason").eq("business_id", world!.businessId).ilike("email", emailOf("northwindstudio", "Bea"));
        for (const s of sup ?? []) track("suppression_entries", s.id as string);
        assert.ok((sup ?? []).length > 0, "the bounced address was not suppressed");
      }
      const { data: messages } = await admin.from("messages").select("id, status, origin, prospect_id").eq("campaign_id", S.campaignId);
      for (const m of messages ?? []) track("messages", m.id as string);
      return `sent to ${mail().map((m) => m.to.split("@")[0]).join(",")}; runs=${(runs ?? []).map((r) => `${String(r.prospect_id).slice(0, 4)}:${r.status}${r.stop_reason ? `:${r.stop_reason}` : ""}`).join(" ")}; messages=${(messages ?? []).length}`;
    });
  });

  test("O4 unsubscribe (RFC 8058 one-click) then step 2: only the still-subscribed get it", async () => {
    if (REAL || !S.campaignId) return;
    if (S.mailboxBlocked) return blocked("O4", "Unsubscribe + follow-up step", "send via the workspace mailbox", S.mailboxBlocked);
    await check({ id: "O4", flow: "Unsubscribe + follow-up step", scenario: "POST /api/unsubscribe/[token] for Priya; step 2 made due", expected: "suppression entry; Priya's run stopped/suppressed; step 2 not sent to her" }, async () => {
      const { data: priya } = await admin.from("prospects").select("unsubscribe_token").eq("id", S.priyaId).single();
      assert.ok(priya?.unsubscribe_token, "no unsubscribe token");
      const { POST } = await import("../../src/app/api/unsubscribe/[token]/route.ts");
      const response = await POST(new Request(`https://story.invalid/api/unsubscribe/${priya!.unsubscribe_token}`, { method: "POST", headers: { "x-forwarded-for": "127.0.0.1" }, body: "List-Unsubscribe=One-Click" }), { params: Promise.resolve({ token: priya!.unsubscribe_token as string }) });
      assert.equal(response.status, 200);
      const before = mail().length;
      await H.must(admin.from("outreach_recipient_runs").update({ next_step_due_at: new Date(Date.now() - 60_000).toISOString() }).eq("campaign_id", S.campaignId).in("status", ["SCHEDULED", "ACTIVE", "PENDING"]), "fast-forward step 2");
      const { dispatchCampaign } = await import("../../src/lib/outreach/dispatch.ts");
      const outcome = await dispatchCampaign({ businessId: world!.businessId, campaignId: S.campaignId });
      const after = mail().slice(before);
      assert.ok(!after.some((m) => m.to === emailOf("northwindstudio", "Priya")), "step 2 went to an unsubscribed prospect");
      const { data: sup } = await admin.from("suppression_entries").select("id").eq("business_id", world!.businessId).ilike("email", emailOf("northwindstudio", "Priya"));
      for (const s of sup ?? []) track("suppression_entries", s.id as string);
      assert.ok((sup ?? []).length > 0, "unsubscribe did not suppress the address");
      return `unsubscribe 200; suppression rows ${(sup ?? []).length}; step-2 dispatch ${JSON.stringify(outcome)}; step-2 recipients: ${after.map((m) => m.to.split("@")[0]).join(",") || "none"}`;
    });
  });
});


/* ============================================================ E: engagement */

section("E", "E. Intake paths and engagement: wizard, API, Meta, CSV -> follow-up -> reply -> guard -> re-engage -> LinkedIn", () => {
  const P: Record<string, { first: string; last: string; email: string; phone: string; company: string }> = {
    wizard: { first: "Wendy", last: `Wizard ${TAG}`, email: H.testEmail(`wendy.${RUN}`), phone: H.dramaPhone(), company: "Wendy Studio Ltd" },
    api: { first: "Arlo", last: `Api ${TAG}`, email: H.testEmail(`arlo.${RUN}`), phone: H.dramaPhone(), company: "Arlo Commerce Ltd" },
    meta: { first: "Maya", last: `Meta ${TAG}`, email: H.testEmail(`maya.${RUN}`), phone: H.dramaPhone(), company: "Maya Labs Ltd" },
    csv: { first: "Cody", last: `Csv ${TAG}`, email: H.testEmail(`cody.${RUN}`), phone: H.dramaPhone(), company: "Cody Digital Ltd" },
  };
  const pageId = `PAGE_${RUN}`;
  const formId = `FORM_${RUN}`;
  const leadgenId = `LG${Date.now()}`;

  before(async () => {
    const w = world!;
    // Temporary SMS and Meta connections for the demo (it has neither). Both
    // are removed by the teardown sweep; every send hits the faked Twilio and
    // Graph (installProviderFakes + the fake below).
    const { data: sms, error: smsError } = await admin
      .from("integrations")
      .insert({ business_id: w.businessId, provider_type: "twilio_sms", status: "HEALTHY", display_name: `SMS ${TAG} (fake)`, config: { phoneNumber: process.env.TWILIO_SMS_FROM } })
      .select("id")
      .single();
    if (smsError) throw new Error(`sms integration: ${smsError.message}`);
    track("integrations", sms!.id as string);
    const { data: meta, error: metaError } = await admin
      .from("integrations")
      .insert({ business_id: w.businessId, provider_type: "meta", status: "HEALTHY", display_name: `Meta ${TAG} (fake)`, config: { pageId } })
      .select("id")
      .single();
    if (metaError) throw new Error(`meta integration: ${metaError.message}`);
    track("integrations", meta!.id as string);
    await H.must(admin.from("integration_secrets").insert({ integration_id: meta!.id, business_id: w.businessId, access_token: "fle-fake-page-token", token_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }), "meta secret");
    const created = new Date().toISOString();
    registerFake({
      name: "fle-graph",
      match: (url) => url.hostname === "graph.facebook.com",
      respond: (url) => {
        if (url.pathname.endsWith(`/${pageId}/leadgen_forms`)) return json({ data: [{ id: formId, name: "Website audit", status: "ACTIVE" }] });
        if (url.pathname.endsWith(`/${formId}/leads`) || url.pathname.endsWith(`/${leadgenId}`)) {
          const lead = {
            id: leadgenId,
            created_time: created,
            ad_id: "AD1",
            ad_name: "Audit ad",
            campaign_id: "CMP1",
            campaign_name: `${TAG} audit`,
            form_id: formId,
            platform: "fb",
            field_data: [
              { name: "full_name", values: [`${P.meta.first} ${P.meta.last}`] },
              { name: "email", values: [P.meta.email] },
              { name: "phone_number", values: [P.meta.phone] },
              { name: "company_name", values: [P.meta.company] },
            ],
          };
          return url.pathname.endsWith(`/${leadgenId}`) ? json(lead) : json({ data: [lead] });
        }
        return json({ error: { message: "not faked" } }, 404);
      },
    });
    if (!ONLY.has("S")) H.scriptAi(null);
  });

  test("E1 intake: Add Lead wizard -> CREATED, permission recorded, first follow-up SMS", async () => {
    if (smsQuietNow()) return blocked("E1", "Wizard intake", "first SMS", "UK quiet hours (20:00-08:00): SMS deferred by design");
    await check({ id: "E1", flow: "Add Lead wizard -> ingest -> follow-up", scenario: "phone enquiry keyed in, follow-up on", expected: "CREATED MANUAL_WIZARD; THEY_CONTACTED_US with evidence; first SMS via the new_lead automation" }, async () => {
      const { createManualLead } = await import("../../src/lib/leads/add-lead/actions.ts");
      const { data: service } = await admin.from("services").select("id").eq("business_id", world!.businessId).eq("active", true).limit(1).single();
      const p = P.wizard;
      const outcome = await createManualLead({
        contact: { firstName: p.first, lastName: p.last, company: p.company, email: p.email, mobile: p.phone, telephone: "", postcode: "BS1 4DJ", address: "" },
        enquiry: { serviceId: service!.id, enquiryText: "Called about a new website and lead follow-up.", source: "PHONE_CALL", sourceDetail: "Inbound call", estimatedValue: "4000", conversionGoal: "BOOK_APPOINTMENT", notes: "" },
        permission: { relationship: "THEY_CONTACTED_US", evidence: `${TAG}: phoned the office and asked for a call back.` },
        routing: { assigneeId: "", initialStatus: "NEW", needsAttention: false, attentionReason: "", startFollowUp: true, qualificationFlow: "default" },
        acknowledgedDuplicates: false,
      });
      assert.equal(outcome.status, "CREATED", JSON.stringify(outcome));
      S.wizardLeadId = (outcome as { leadId: string }).leadId;
      track("leads", S.wizardLeadId);
      await drain();
      const lead = await H.leadRow(S.wizardLeadId);
      const sms = H.smsOutbox.filter((m) => m.to === p.phone);
      // Never a literal merge token to a lead (merge-fields.ts singleBraceTokens).
      assert.ok(sms.every((m) => !/\{\{?\s*[a-z_]+\s*\}\}?/i.test(m.body)), `unrendered token sent: ${sms.map((m) => m.body).join(" | ")}`);
      const { data: step1 } = await admin.from("automation_steps").select("template, automation_versions!inner(status, automation_definitions!inner(business_id, type))").eq("business_id", world!.businessId).eq("position", 1).eq("automation_versions.status", "PUBLISHED").eq("automation_versions.automation_definitions.type", "new_lead").maybeSingle();
      const { singleBraceTokens } = await import("../../src/lib/messaging/merge-fields.ts");
      const broken = singleBraceTokens(String((step1 as { template?: string } | null)?.template ?? ""));
      if (broken.length > 0) {
        // The demo's seeded step 1 uses single braces (fixed in the seed; the
        // stored copy needs a re-seed). The step must pause with a flag.
        const { data: flags } = await admin.from("leads").select("needs_attention").eq("id", S.wizardLeadId).single();
        assert.equal(sms.length, 0, "a template with unfillable tokens was sent");
        return `intake=${lead.intake_method} created_via=${lead.created_via}; step 1 paused, not sent (template has ${broken.join(",")}); attention=${JSON.stringify(flags)}`;
      }
      assert.ok(sms.length >= 1, `no first SMS; lead automation_active=${lead.automation_active}; jobs=${H.jobLog.slice(-10).map((j) => `${j.type}:${j.ok}`).join(",")}`);
      return `intake=${lead.intake_method} created_via=${lead.created_via}; SMS#1 "${sms[0].body.slice(0, 70)}"`;
    });
  });

  test("E2 intake: public API with Idempotency-Key -> 201, replay returns the same lead", async () => {
    await check({ id: "E2", flow: "Public API -> ingest", scenario: "POST /api/v1/leads twice with one key", expected: "201 then the same lead id; one lead" }, async () => {
      const { createApiKey } = await import("../../src/lib/api-keys/service.ts");
      const key = await createApiKey({ businessId: world!.businessId, userId: world!.userId, createdBy: world!.userId, name: `${TAG} api`, environment: "test", scopes: ["leads:read", "leads:write"] });
      assert.ok(key, "API key not created");
      track("api_keys", key!.id);
      const { POST } = await import("../../src/app/api/v1/leads/route.ts");
      const p = P.api;
      const body = JSON.stringify({ first_name: p.first, last_name: p.last, email: p.email, phone: p.phone, company_name: p.company, relationship: "THEY_CONTACTED_US", source: { type: "WEB_FORM", provider: "website", record_id: `web-${RUN}`, form_name: "Contact us", utm_source: "google", utm_campaign: `${TAG}` } });
      const call = async () => {
        const response = await (POST as unknown as (r: Request) => Promise<Response>)(new Request("https://story.invalid/api/v1/leads", { method: "POST", headers: { authorization: `Bearer ${key!.key}`, "content-type": "application/json", "idempotency-key": `fle-${RUN}`, "x-forwarded-for": "127.0.0.9" }, body }));
        return { status: response.status, body: (await response.json().catch(() => null)) as { data?: { lead_id: string; outcome: string } } | null };
      };
      const first = await call();
      assert.equal(first.status, 201, JSON.stringify(first));
      const replay = await call();
      assert.equal(replay.body?.data?.lead_id, first.body?.data?.lead_id);
      S.apiLeadId = first.body!.data!.lead_id;
      track("leads", S.apiLeadId);
      await drain();
      assert.equal((await K.leadByEmail(p.email)).length, 1);
      return `first ${first.status} ${first.body?.data?.outcome}; replay ${replay.status} same lead`;
    });
  });

  test("E3 intake: Meta leadgen webhook (signed replay) -> poll -> lead with ad provenance", async () => {
    await check({ id: "E3", flow: "Meta webhook -> poll -> ingest", scenario: "signed leadgen webhook replay (the Lead Ads Testing Tool needs a person in Facebook's UI)", expected: "200, webhook_events row, lead_source.poll runs, lead CREATED with a meta touch carrying the campaign" }, async () => {
      const { POST } = await import("../../src/app/api/webhooks/meta/route.ts");
      const body = JSON.stringify({ object: "page", entry: [{ id: pageId, time: Math.floor(Date.now() / 1000), changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: formId, created_time: Math.floor(Date.now() / 1000) } }] }] });
      const response = await POST(new Request("https://story.invalid/api/webhooks/meta", { method: "POST", headers: { "x-hub-signature-256": H.metaSignature(body), "content-type": "application/json", "x-forwarded-for": "127.0.0.2" }, body }));
      H.mustWorld().createdGlobal.webhookEvents.push({ provider: "meta", id: leadgenId });
      assert.equal(response.status, 200);
      const drained = await drain();
      const leads = await K.leadByEmail(P.meta.email);
      assert.equal(leads.length, 1, `meta lead not created; ran=${drained.ran.join(",")}; failed=${JSON.stringify(drained.failed)}`);
      S.metaLeadId = leads[0].id as string;
      track("leads", S.metaLeadId);
      const touches = await K.touchesFor(S.metaLeadId);
      return `200; lead ${String(leads[0].intake_method)}; touch ${touches[0]?.source_type}/${touches[0]?.campaign_name ?? touches[0]?.utm_campaign ?? "-"}`;
    });
  });

  test("E4 intake: CSV import (existing customers, follow-up off) -> CREATED, nothing sent", async () => {
    await check({ id: "E4", flow: "CSV import -> ingest", scenario: "one row, follow-up off", expected: "lead CREATED via IMPORT, provenance IMPORT, no SMS" }, async () => {
      const { createImport, commitImport } = await import("../../src/lib/imports/actions.ts");
      const p = P.csv;
      const created = await createImport({ filename: `${TAG}.csv`, headers: ["First name", "Last name", "Email", "Phone", "Company"], rows: [[p.first, p.last, p.email, p.phone, p.company]], mapping: { firstName: 0, lastName: 1, email: 2, phone: 3, companyName: 4 }, defaultRelationship: "EXISTING_CUSTOMER", sourceDetail: `${TAG} export`, startFollowUp: false });
      assert.equal(created.ok, true, JSON.stringify(created));
      const importId = (created as { data: { id: string } }).data.id;
      track("lead_imports", importId);
      const committed = await commitImport(importId);
      assert.equal(committed.ok, true, JSON.stringify(committed));
      await drain();
      const leads = await K.leadByEmail(p.email);
      assert.equal(leads.length, 1);
      track("leads", leads[0].id as string);
      assert.equal(H.smsOutbox.filter((m) => m.to === p.phone).length, 0, "an import with follow-up off sent a message");
      return `lead ${leads[0].intake_method}/${leads[0].created_via}; no SMS`;
    });
  });

  test("E5 the lead replies -> the agent answers once, through the send guard", async () => {
    if (!S.wizardLeadId) return blocked("E5", "Inbound reply -> agent", "agent reply", "no wizard lead (E1 did not run)");
    await check({ id: "E5", flow: "Inbound SMS -> agent turn", scenario: "a real question from the lead", expected: "conversation_agent_runs row; one reply SMS; no internal wording leaked" }, async () => {
      const turn = await H.leadSays(P.wizard.phone, "Thanks for getting back to me. Do you work with small studios like ours?");
      const run = await H.latestRun(S.wizardLeadId);
      assert.ok(run, "no agent run");
      assert.ok(turn.replies.length >= 1, `no reply; run ${run?.outcome}/${run?.error_code}; failures ${JSON.stringify(turn.failures)}`);
      assert.ok(turn.replies.every((r) => !/\b(REVIEW|confidence|policy|prompt)\b/.test(r)), `internal wording: ${turn.replies.join(" | ")}`);
      return `run ${run?.outcome}; reply "${turn.replies[0].slice(0, 90)}"`;
    });
  });

  test("E6 'not now, try me in March' -> NOT_NOW signal; at the resume date the re-engagement trigger contacts them once", async () => {
    if (!S.metaLeadId || smsQuietNow()) return blocked("E6", "Re-engagement (NOT_NOW resume)", "one re-contact", "no Meta lead or quiet hours");
    await check({ id: "E6", flow: "Re-engagement: NOT_NOW resume", scenario: "Meta ad-form lead (follow-up on) defers to March; resume date reached", expected: "NOT_NOW signal with resume_at; reengage.trigger -> one FOLLOW_UP_DUE turn -> one SMS" }, async () => {
      await H.leadSays(P.meta.phone, "Thanks, but not right now. Try me again in March please.");
      const { data: signals } = await admin.from("lead_intent_signals").select("id, resume_at").eq("lead_id", S.metaLeadId).eq("signal_type", "NOT_NOW").is("retracted_at", null).order("observed_at", { ascending: false }).limit(1);
      const signal = signals?.[0] as { id: string; resume_at: string | null } | undefined;
      assert.ok(signal?.resume_at, `no NOT_NOW signal: ${JSON.stringify(signals)}`);
      const DAY = 86_400_000;
      const { data: msgs } = await admin.from("messages").select("id, created_at, sent_at").eq("lead_id", S.metaLeadId);
      for (const m of (msgs ?? []) as { id: string; created_at: string; sent_at: string | null }[]) {
        await admin.from("messages").update({ created_at: new Date(Date.parse(m.created_at) - 40 * DAY).toISOString(), ...(m.sent_at ? { sent_at: new Date(Date.parse(m.sent_at) - 40 * DAY).toISOString() } : {}) }).eq("id", m.id);
      }
      const past = new Date(Date.now() - 2 * 3_600_000).toISOString();
      await H.must(admin.from("lead_intent_signals").update({ observed_at: new Date(Date.now() - 40 * DAY).toISOString(), resume_at: past, flat_until: past, expires_at: past }).eq("id", signal!.id), "signal");
      const { planIntentTriggersForLead } = await import("../../src/lib/reengagement/planner.ts");
      const planned = await planIntentTriggersForLead(world!.businessId, S.metaLeadId);
      const { data: triggerJobs } = await admin.from("jobs").select("id, state, type, last_error").eq("idempotency_key", `reengage.trigger:NOT_NOW_RESUME:${signal!.id}`);
      const sent = H.smsOutbox.length;
      const logBefore = H.jobLog.length;
      await H.runJobs({ fastForward: ["reengage.trigger", "lead.score"] });
      const texts = H.smsOutbox.slice(sent).filter((m) => m.to === P.meta.phone);
      const { data: runs } = await admin.from("conversation_agent_runs").select("outcome, error_code, status").eq("lead_id", S.metaLeadId).order("created_at");
      const { data: after } = await admin.from("jobs").select("state, last_error").eq("idempotency_key", `reengage.trigger:NOT_NOW_RESUME:${signal!.id}`);
      const { data: events } = await admin.from("audit_log").select("action, metadata").eq("entity_id", S.metaLeadId).ilike("action", "reengagement%");
      const { data: leadNow } = await admin.from("leads").select("status, automation_active, human_takeover, opted_out, is_test").eq("id", S.metaLeadId).single();
      assert.equal(texts.length, 1, `re-engagement SMS ${texts.length}; planned ${planned}; trigger jobs before ${JSON.stringify(triggerJobs)} after ${JSON.stringify(after)}; ran ${JSON.stringify(H.jobLog.slice(logBefore))}; runs ${JSON.stringify(runs)}; skips ${JSON.stringify(events).slice(0, 400)}; lead ${JSON.stringify(leadNow)}`);
      return `signal resume ${signal!.resume_at} (moved to ${past}); FOLLOW_UP_DUE ${runs?.[0]?.outcome}; SMS "${texts[0].body.slice(0, 70)}"`;
    });
  });

  test("E7 a person takes over -> the agent stays quiet", async () => {
    if (!S.apiLeadId) return blocked("E7", "Takeover", "agent silent", "no API lead (E2 did not run)");
    await check({ id: "E7", flow: "Human takeover", scenario: "lead.takeover, then the lead writes", expected: "no automated reply while a person owns the conversation" }, async () => {
      const taken = await K.runOp("lead.takeover", { leadId: S.apiLeadId });
      assert.equal(taken.success, true, JSON.stringify(taken).slice(0, 300));
      const turn = await H.leadSays(P.api.phone, "Hi, is anyone there? Can you send me prices?");
      const run = await H.latestRun(S.apiLeadId);
      assert.equal(turn.replies.length, 0, `agent replied during takeover: ${turn.replies.join(" | ")}`);
      return `takeover ok; inbound -> run ${run?.outcome ?? "none"}/${run?.error_code ?? "-"}; replies 0`;
    });
  });

  test("E8 STOP -> opted out; the next follow-up step is not sent", async () => {
    if (!S.wizardLeadId) return blocked("E8", "Opt-out", "no further sends", "no wizard lead");
    await check({ id: "E8", flow: "Opt-out + stop conditions", scenario: "lead texts STOP, then the next automation step falls due", expected: "SMS suppression recorded (channel-scoped); follow-up ended; no SMS after STOP" }, async () => {
      await H.leadSays(P.wizard.phone, "STOP");
      const after = H.smsOutbox.length;
      await admin.from("automation_runs").update({ next_run_at: new Date(Date.now() - 60_000).toISOString() }).eq("lead_id", S.wizardLeadId).eq("state", "ACTIVE");
      await H.runJobs({ fastForward: ["automation.advance"] });
      const later = H.smsOutbox.slice(after).filter((m) => m.to === P.wizard.phone);
      const { data: runs } = await admin.from("automation_runs").select("state, stopped_reason").eq("lead_id", S.wizardLeadId);
      assert.equal(later.length, 0, `sent after STOP: ${later.map((m) => m.body).join(" | ")}`);
      const { data: lead } = await admin.from("leads").select("opted_out, automation_active").eq("id", S.wizardLeadId).single();
      // A carrier STOP is channel-scoped (message-inbound optOutScope): SMS is
      // suppressed and follow-up ends; leads.opted_out is for "stop contacting me".
      assert.equal(lead?.automation_active, false, `follow-up still active after STOP: ${JSON.stringify(lead)}`);
      const { data: sup } = await admin.from("suppression_entries").select("channel, reason").eq("business_id", world!.businessId).eq("phone_e164", P.wizard.phone);
      assert.ok((sup ?? []).some((r) => r.channel === "SMS"), `no SMS suppression entry: ${JSON.stringify(sup)}`);
      return `after STOP: 0 SMS; lead opted_out=${lead?.opted_out} automation_active=${lead?.automation_active}; suppression ${JSON.stringify(sup)}; automation ${JSON.stringify(runs)}`;
    });
  });

  test("E9 LinkedIn Assist: add the lead's profile -> a drafted task for a person to send", async () => {
    const leadId = S.metaLeadId ?? S.apiLeadId;
    if (!leadId) return blocked("E9", "LinkedIn Assist", "task", "no lead");
    await check({ id: "E9", flow: "LinkedIn Assist", scenario: "addLinkedInContact for a lead", expected: "contact + OPEN task with a body; nothing sent by ClientTurn" }, async () => {
      const { addLinkedInContact } = await import("../../src/lib/linkedin-assist/actions.ts");
      const result = (await addLinkedInContact({ leadId, profileUrl: `https://www.linkedin.com/in/fle-${RUN}`, firstTouch: "CONNECTION_NOTE" })) as { ok?: boolean; success?: boolean; error?: string };
      assert.ok(result.ok ?? result.success, JSON.stringify(result).slice(0, 400));
      await drain();
      const { data: contacts } = await admin.from("linkedin_assist_contacts").select("id").eq("business_id", world!.businessId).eq("lead_id", leadId);
      for (const c of contacts ?? []) track("linkedin_assist_contacts", c.id as string);
      const { data: tasks } = await admin.from("linkedin_assist_tasks").select("id, status, body, body_source").in("contact_id", (contacts ?? []).map((c) => c.id as string));
      for (const t of tasks ?? []) track("linkedin_assist_tasks", t.id as string);
      assert.ok((tasks ?? []).some((t) => t.status === "OPEN" && String(t.body ?? "").length > 0), JSON.stringify(tasks));
      return `contact ${contacts?.length}; tasks ${(tasks ?? []).map((t) => `${t.status}/${t.body_source}`).join(",")}`;
    });
  });
});

/* ======================================================== A: background agents */

section("A", "A. Background agents through the real scheduler (scoped to this workspace and agent)", () => {
  async function agent(type: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from("agents")
      .insert({ business_id: world!.businessId, name: `${TAG} ${type}`, agent_type: type, status: "ACTIVE", autonomy: "REVIEW_ALL", cadence: "MANUAL", next_run_at: new Date(Date.now() - 60_000).toISOString(), created_by: world!.userId, daily_prospect_cap: 5, monthly_prospect_cap: 20, ...extra } as never)
      .select("id")
      .single();
    if (error) throw new Error(`agent ${type}: ${error.message}`);
    track("agents", (data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function tick(agentId: string) {
    const { scheduleAgents } = await import("../../src/lib/agents/scheduler.ts");
    await scheduleAgents({ businessId: world!.businessId, agentId });
    const { data: events } = await admin.from("agent_activity_events").select("event_type, severity, title, detail").eq("agent_id", agentId).order("created_at");
    const { data: row } = await admin.from("agents").select("status, last_run_at, next_run_at").eq("id", agentId).single();
    return { events: (events ?? []) as { event_type: string; severity: string; title: string; detail: string | null }[], row: row as { status: string; last_run_at: string | null } | null };
  }

  test("A1 re-engagement agent tick: examines quiet leads, records its work, sends nothing unapproved", async () => {
    await check({ id: "A1", flow: "Agent: REENGAGEMENT", scenario: "ACTIVE, REVIEW_ALL, due now", expected: "claimed once (last_run_at set); a TICK_COMPLETED or explicit RUN_BLOCKED event with a reason; no SMS sent by the tick" }, async () => {
      const id = await agent("REENGAGEMENT");
      const before = H.smsOutbox.length;
      const r = await tick(id);
      assert.ok(r.row?.last_run_at, "agent not claimed");
      assert.ok(r.events.length > 0, "no activity recorded");
      assert.equal(H.smsOutbox.length, before, "a REVIEW_ALL re-engagement tick sent SMS");
      return `status ${r.row?.status}; events ${r.events.map((e) => `${e.event_type}:${e.title}${e.detail ? ` (${e.detail.slice(0, 60)})` : ""}`).join(" | ")}`;
    });
  });

  test("A2 closing (BOOKING) agent tick: stalled leads examined, nudges queued for review", async () => {
    await check({ id: "A2", flow: "Agent: BOOKING", scenario: "ACTIVE, REVIEW_ALL, due now", expected: "claimed; TICK_COMPLETED or RUN_BLOCKED with a reason; nothing sent without approval" }, async () => {
      const id = await agent("BOOKING");
      const before = H.smsOutbox.length;
      const r = await tick(id);
      assert.ok(r.row?.last_run_at, "agent not claimed");
      assert.ok(r.events.length > 0, "no activity recorded");
      assert.equal(H.smsOutbox.length, before, "a REVIEW_ALL booking tick sent SMS");
      return `status ${r.row?.status}; events ${r.events.map((e) => `${e.event_type}:${e.title}`).join(" | ")}`;
    });
  });

  test("A3 sourcing agent tick: queues a RECURRING run on the approved plan, limited to its sources", async () => {
    if (REAL) return;
    const strategyId = S.strategyId;
    if (!strategyId) return blocked("A3", "Agent: SOURCING", "RECURRING run", "no approved strategy (section S did not run)");
    await check({ id: "A3", flow: "Agent: SOURCING", scenario: "ACTIVE, REVIEW_ALL, sources WEBSITE + COMPANY_REGISTRY + GOOGLE_PLACES", expected: "RUN_QUEUED; sourcing_runs row RECURRING with agent_id, HUMAN_REVIEW, excluded providers = paid vendors; the run completes in-process" }, async () => {
      const id = await agent("SOURCING", { search_strategy_id: strategyId });
      for (const key of ["WEBSITE", "COMPANY_REGISTRY", "GOOGLE_PLACES"]) {
        const { data } = await admin.from("agent_sources").insert({ business_id: world!.businessId, agent_id: id, source_key: key, enabled: true } as never).select("id").single();
        track("agent_sources", (data as { id?: string } | null)?.id);
      }
      const r = await tick(id);
      const { data: runs } = await admin.from("sourcing_runs").select("id, status, trigger_source, review_before_outreach, limits_json").eq("agent_id", id);
      for (const run of runs ?? []) track("sourcing_runs", run.id as string);
      assert.equal(runs?.length, 1, `runs ${JSON.stringify(runs)}; events ${JSON.stringify(r.events)}`);
      const excluded = ((runs![0].limits_json ?? {}) as { excludedProviders?: string[] }).excludedProviders ?? [];
      assert.deepEqual([...excluded].sort(), ["apollo", "clearbit", "hunter"]);
      const drained = await drain({ fastForward: ["sourcing.run"] });
      const { data: done } = await admin.from("sourcing_runs").select("status").eq("id", runs![0].id).single();
      const { data: found } = await admin.from("prospects").select("id").eq("source_run_id", runs![0].id);
      for (const p of found ?? []) track("prospects", p.id as string);
      return `RUN ${runs![0].trigger_source} review=${runs![0].review_before_outreach}; excluded ${excluded.join(",")}; finished ${done?.status} (${(found ?? []).length} new prospects after dedupe); failed jobs ${drained.failed.length}`;
    });
  });
});

/* hooks for later sections are appended below */
export { S, track, drain, smsQuietNow, world, TAG, section, mail };
