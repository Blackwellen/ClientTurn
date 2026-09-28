/**
 * Seeds (or refreshes) the help-centre DEMO workspace, "Blackwellen Ltd"
 * (slug `blackwellen-demo`), used to capture the help-centre screenshots
 * (content/help/SCREENSHOTS.md) and for product demos.
 *
 *   node --experimental-transform-types --env-file=.env --env-file=.env.local \
 *     --import ./scripts/e2e-resolver.mjs --import ./scripts/lib/egress-guard.mjs \
 *     scripts/seed-help-demo.mjs [--with-simulated-connections] [--reset-password]
 *
 * (`npm`-free on purpose: run it exactly as above.)
 *
 * ## What it is
 *
 * A DEMO workspace in the live ClientTurn Supabase project, clearly labelled:
 * slug `blackwellen-demo`, every demo login on the reserved `.example` domain
 * (RFC 2606: it can never resolve, so nothing can ever be emailed), every lead
 * and client company fictional (each company name checked against the
 * Companies House register, every domain `.example`), every phone number in
 * Ofcom's drama range (07700 900000-900999). The workspace name is the owner's
 * own company, at the owner's request; nothing in it is a real customer.
 *
 * ## Why nothing can send
 *
 *   1. The business is inserted with `job_claims_paused = true` (migration
 *      0137) before any lead, message or job exists, so the worker never claims
 *      a job for it. The flag is re-asserted on every run.
 *   2. Every job the seed's own writes queue (lead events, message events) is
 *      deleted at the end, and the final check fails the run if the workspace
 *      has any pending or running job.
 *   3. No agent is ACTIVE (the agent scheduler runs ACTIVE agents inline, not
 *      through a job), no reactivation campaign is RUNNING or SCHEDULED, no
 *      outreach recipient is due, no voice number is provisioned.
 *   4. This process runs under scripts/lib/egress-guard.mjs: the only host it
 *      can reach is the Supabase project.
 *   5. Integration rows exist only with `--with-simulated-connections`, carry
 *      fictional names and ids, and hold no token at all (null secrets, or an
 *      obviously fake `DEMO-NOT-A-TOKEN-...` value where the schema needs a
 *      string). They are marked `config.help_demo_simulated = true` and
 *      scripts/capture-help-screenshots.mjs deletes them when it finishes.
 *
 * ## Idempotent
 *
 * Re-running finds the workspace by slug and fills in whatever is missing; it
 * never touches any other workspace. The owner's password is generated once and
 * printed once (pass --reset-password to issue a new one). Teardown:
 * scripts/teardown-help-demo.mjs.
 */
import { register } from "node:module";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

register(new URL("../tests/stories/story-hooks.mjs", import.meta.url));

/* ------------------------------------------------------------ constants */

export const DEMO = {
  slug: "blackwellen-demo",
  name: "Blackwellen Ltd",
  website: "https://www.blackwellen-demo.example",
  domain: "blackwellen-demo.example",
  timezone: "Europe/London",
};

export const DEMO_USERS = [
  { key: "owner", email: `alex.morgan@${DEMO.domain}`, first: "Alex", last: "Morgan", role: "owner" },
  { key: "admin", email: `priya.nandra@${DEMO.domain}`, first: "Priya", last: "Nandra", role: "admin" },
  { key: "member", email: `tom.ashby@${DEMO.domain}`, first: "Tom", last: "Ashby", role: "member" },
  // An invitation that lapsed: an unconfirmed account, never emailed.
  { key: "invitee", email: `sam.okafor@${DEMO.domain}`, first: "Sam", last: "Okafor", role: "member", invited: true },
];

const args = new Set(process.argv.slice(2));
const WITH_SIMULATED = args.has("--with-simulated-connections");
const RESET_PASSWORD = args.has("--reset-password");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (load .env and .env.local).");
if (!/losieaikadkadtmezini/.test(url)) throw new Error(`Refusing: ${url} is not the ClientTurn project.`);

export const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const DAY = 86_400_000;
const now = Date.now();
const ago = (days, hours = 0) => new Date(now - days * DAY - hours * 3_600_000).toISOString();
const ahead = (days, hour = 10) => {
  const d = new Date(now + days * DAY);
  d.setUTCHours(hour - 1, 0, 0, 0); // UK summer time
  return d.toISOString();
};

async function must(promise, what) {
  const result = await promise;
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result;
}

const counts = {};
const bump = (key, n = 1) => {
  counts[key] = (counts[key] ?? 0) + n;
};

/* ------------------------------------------------------------ 1. people */

async function findUserByEmail(email) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

function strongPassword() {
  return `Demo-${randomBytes(18).toString("base64url")}!9`;
}

async function ensureUsers() {
  const users = {};
  let ownerPassword = null;
  for (const person of DEMO_USERS) {
    let user = await findUserByEmail(person.email);
    const password = strongPassword();
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: person.email,
        password,
        // The invitee never confirmed: the lapsed-invitation state.
        email_confirm: !person.invited,
        user_metadata: { help_demo: true, first_name: person.first, last_name: person.last },
      });
      if (error || !data.user) throw new Error(`createUser ${person.email}: ${error?.message}`);
      user = data.user;
      if (person.key === "owner") ownerPassword = password;
      bump("auth_users");
    } else if (person.key === "owner" && RESET_PASSWORD) {
      await must(admin.auth.admin.updateUserById(user.id, { password }), "reset password");
      ownerPassword = password;
    }
    users[person.key] = user.id;
    // Section tours already seen (their server copy is app_metadata), so no
    // tour opens over a screenshot.
    const seen = { version: 99, outcome: "skipped", at: ago(20) };
    const sections = ["dashboard", "leads", "follow-up", "reactivation", "settings", "find-leads", "agents", "analytics", "inbox"];
    await must(
      admin.auth.admin.updateUserById(user.id, {
        app_metadata: { ...(user.app_metadata ?? {}), help_demo: true, ct_section_tours: Object.fromEntries(sections.map((k) => [k, seen])) },
      }),
      `tours ${person.email}`,
    );
    await must(
      admin.from("profiles").upsert(
        {
          id: user.id,
          email: person.email,
          first_name: person.first,
          last_name: person.last,
          // Tour already seen, so it never opens over a screenshot.
          product_tour_version: 1,
          product_tour_outcome: "skipped",
          product_tour_completed_at: ago(20),
        },
        { onConflict: "id" },
      ),
      `profile ${person.email}`,
    );
  }
  return { users, ownerPassword };
}

/* ------------------------------------------------------------ 2. workspace */

async function ensureBusiness(ownerId) {
  const { data: existing, error } = await admin
    .from("businesses")
    .select("id, name, slug, job_claims_paused")
    .eq("slug", DEMO.slug)
    .maybeSingle();
  if (error) throw new Error(`business lookup: ${error.message}`);
  if (existing) {
    if (existing.name !== DEMO.name) throw new Error(`Refusing: slug ${DEMO.slug} belongs to "${existing.name}".`);
    // Re-asserted every run, before anything else is written.
    await must(admin.from("businesses").update({ job_claims_paused: true }).eq("id", existing.id), "re-pause");
    return existing.id;
  }
  // job_claims_paused is set in the INSERT itself: there is never a moment
  // when this workspace exists and the worker may claim its jobs.
  const { data, error: insertError } = await admin
    .from("businesses")
    .insert({
      name: DEMO.name,
      slug: DEMO.slug,
      job_claims_paused: true,
      status: "active",
      industry: "Web design and development agency",
      website: DEMO.website,
      phone: "+447700900100",
      timezone: DEMO.timezone,
      onboarding_step: "complete",
      onboarding_state: { help_demo: true },
      activated_at: ago(45),
      created_by: ownerId,
      created_at: ago(46),
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`business insert: ${insertError.message}`);
  bump("businesses");
  return data.id;
}

async function ensureMembers(businessId, users) {
  for (const person of DEMO_USERS) {
    const row = person.invited
      ? {
          business_id: businessId,
          user_id: users[person.key],
          role: person.role,
          status: "invited",
          invited_email: person.email,
          invited_at: ago(16),
          accepted_at: null,
        }
      : {
          business_id: businessId,
          user_id: users[person.key],
          role: person.role,
          status: "active",
          invited_at: person.key === "owner" ? null : ago(40),
          accepted_at: person.key === "owner" ? ago(46) : ago(39),
        };
    await must(admin.from("business_members").upsert(row, { onConflict: "business_id,user_id" }), `member ${person.key}`);
  }
}

async function ensureSubscription(businessId) {
  const { entitlementSnapshot } = await import("../src/lib/billing/lifecycle.ts");
  const { data: existing } = await admin.from("subscriptions").select("id").eq("business_id", businessId).maybeSingle();
  const row = {
    business_id: businessId,
    plan: "pro",
    status: "ACTIVE",
    billing_interval: "month",
    current_period_start: ago(12),
    current_period_end: ahead(18),
    trial_ends_at: null,
    cancel_at_period_end: false,
    // No Stripe objects: this workspace is never billed. mrr_minor = 0 makes
    // Admin -> Billing count it at £0 a month (billing/revenue.ts reads the
    // real amount before the list price), since businesses has no demo flag.
    stripe_customer_id: null,
    stripe_subscription_id: null,
    mrr_minor: 0,
    mrr_currency: "GBP",
    mrr_updated_at: new Date().toISOString(),
    ...entitlementSnapshot("pro", false),
  };
  if (existing) await must(admin.from("subscriptions").update(row).eq("id", existing.id), "subscription");
  else await must(admin.from("subscriptions").insert(row), "subscription");
}

function weekHours() {
  const open = { open: true, start: "09:00", end: "17:30" };
  const closed = { open: false, start: "09:00", end: "17:30" };
  return { mon: open, tue: open, wed: open, thu: open, fri: open, sat: closed, sun: closed };
}

async function ensureSettings(businessId, users) {
  await must(
    admin.from("business_settings").upsert(
      {
        business_id: businessId,
        service_area_description: "UK-wide, working remotely with clients across England, Scotland and Wales.",
        business_hours: weekHours(),
        quiet_hours_enabled: true,
        message_signature: "Alex at Blackwellen",
        default_channel: "sms",
        booking_mode: "handover",
        appointment_duration_minutes: 30,
        booking_buffer_minutes: 15,
        ai_assist_enabled: true,
        notify_daily_summary: true,
      },
      { onConflict: "business_id" },
    ),
    "business_settings",
  );
  await must(
    admin.from("business_ai_settings").upsert(
      {
        business_id: businessId,
        tone: "friendly",
        reply_length: "short",
        business_description:
          "Blackwellen is a UK web design and development studio. We design and build websites, Shopify stores and web apps for B2B companies, and run conversion and SEO retainers after launch.",
        handover_instruction: "Hand over to Alex for anything about contracts, pricing exceptions or projects over £25,000.",
        allow_ai_reply: true,
        allow_ai_interpretation: true,
        agent_mode: "SUGGEST_ONLY",
        agent_channels: ["sms", "email"],
        agent_handover_on_review: false,
        agent_answer_service_questions: true,
      },
      { onConflict: "business_id" },
    ),
    "business_ai_settings",
  );
  await must(
    admin.from("business_profiles").upsert(
      {
        business_id: businessId,
        website_url: DEMO.website,
        business_type: "Web design and development agency",
        sales_model: "AGENCY",
        summary:
          "Blackwellen designs and builds websites, Shopify stores and web applications for UK B2B companies, then keeps improving them on conversion and SEO retainers.",
        outreach_tone: "Warm, plain-spoken and specific. No hype.",
        outreach_value_proposition: "A site that turns visitors into enquiries, built in weeks rather than months.",
        outreach_key_messages: "Fixed-price builds; a named developer for every project; conversion reporting every month.",
        outreach_proof_points: "Every build ships with a performance and accessibility report.",
        outreach_avoid: "Guarantees of rankings or revenue.",
        outreach_call_to_action: "Book a 30-minute discovery call.",
        outreach_claim_restrictions: "Never promise search rankings, revenue or delivery dates before a scoping call.",
        outreach_guidance_updated_at: ago(30),
        sales_motions: ["BOOK_MEETING_B2B"],
        analysis_status: "NOT_STARTED",
      },
      { onConflict: "business_id" },
    ),
    "business_profiles",
  );
  await must(
    admin.from("business_data_controls").upsert(
      {
        business_id: businessId,
        legal_name: "Blackwellen Ltd",
        registered_country: "GB",
        privacy_policy_url: `${DEMO.website}/privacy`,
        privacy_contact_email: `privacy@${DEMO.domain}`,
        prospect_countries: ["GB"],
        prospect_type: "B2B",
        allowed_sources: ["BUSINESS_WEBSITE", "COMPANIES_HOUSE", "CUSTOMER_CRM"],
        marketing_lawful_basis: "LEGITIMATE_INTERESTS",
        lawful_basis_note: "B2B outreach to incorporated companies about web design services relevant to their role.",
        basis_reviewed_at: ago(30),
        updated_by: users.owner,
      },
      { onConflict: "business_id" },
    ),
    "business_data_controls",
  );
  await must(
    admin.from("voice_settings").upsert(
      {
        business_id: businessId,
        // Configured, switched off, and no number: the voice agent cannot call.
        voice_enabled: false,
        calling_as_name: "Blackwellen",
        legal_entity_name: "Blackwellen Ltd",
        identification_contact: `hello@${DEMO.domain}`,
        assistant_persona_name: "Ellie",
        recording_enabled: false,
        voicemail_enabled: false,
        max_attempts: 2,
      },
      { onConflict: "business_id" },
    ),
    "voice_settings",
  );
}

/* ------------------------------------------------------------ 3. services */

const SERVICES = [
  {
    key: "website",
    name: "Website design and build",
    description: "A fixed-price marketing website: discovery, design, build and launch.",
    average_value: 12000,
    pricing_visibility: "PUBLIC_FROM",
    public_price_text: "from £6,500",
  },
  {
    key: "shopify",
    name: "Shopify store build",
    description: "A Shopify or Shopify Plus store, themed and integrated with your stock and fulfilment.",
    average_value: 18000,
    pricing_visibility: "QUOTE_REQUIRED",
  },
  {
    key: "cro",
    name: "Conversion and SEO retainer",
    description: "Monthly conversion testing, technical SEO and content after launch.",
    average_value: 2400,
    pricing_visibility: "PUBLIC_FROM",
    public_price_text: "from £1,200 a month",
  },
];

async function ensureServices(businessId) {
  const out = {};
  for (const [i, service] of SERVICES.entries()) {
    const { key, ...row } = service;
    const { data: existing } = await admin
      .from("services")
      .select("id")
      .eq("business_id", businessId)
      .eq("name", row.name)
      .maybeSingle();
    if (existing) {
      out[key] = existing.id;
      continue;
    }
    const { data } = await must(
      admin.from("services").insert({ business_id: businessId, position: i, active: true, ...row }).select("id").single(),
      `service ${key}`,
    );
    out[key] = data.id;
    bump("services");
  }
  return out;
}

/* ------------------------------------------------------------ 4. leads */

/**
 * Every company here is fictional: its distinctive name returned zero results
 * from the Companies House search (2026-09-28), and its domain is `.example`.
 */
export const LEADS = [
  // key, first, last, company, role, source, status, qualification, service, days ago, phone?
  { key: "harriet", first: "Harriet", last: "Quayle", company: "Quillfield Analytics Ltd", role: "Head of Marketing", source: "meta", status: "QUALIFIED", q: "QUALIFIED", service: "website", days: 3, phone: "+447700900311", intent: "BOOKING_READY", value: 14500 },
  { key: "daniel", first: "Daniel", last: "Price", company: "Brindlecourt Commerce Ltd", role: "Ecommerce Director", source: "google_ads", status: "BOOKED", q: "QUALIFIED", service: "shopify", days: 6, phone: "+447700900312", intent: "HIGH", value: 22000 },
  { key: "fiona", first: "Fiona", last: "Marsh", company: "Saltmere Outfitters Ltd", role: "Founder", source: "meta", status: "WON", q: "QUALIFIED", service: "shopify", days: 19, phone: "+447700900313", intent: "PURCHASE_READY", value: 18500 },
  { key: "oliver", first: "Oliver", last: "Hext", company: "Wrenhollow Legal LLP", role: "Practice Manager", source: "webform", status: "RESPONDED", q: "REVIEW", service: "website", days: 2, phone: "+447700900314", intent: "MEDIUM", value: 9000 },
  { key: "grace", first: "Grace", last: "Tennant", company: "Copperstile Interiors Ltd", role: "Managing Director", source: "linkedin_ads", status: "QUALIFIED", q: "QUALIFIED", service: "website", days: 4, phone: "+447700900315", intent: "HIGH", value: 11000 },
  { key: "marcus", first: "Marcus", last: "Bellamy", company: "Orrinbury Growth Ltd", role: "Operations Director", source: "api", status: "CONTACTED", q: "PENDING", service: "cro", days: 1, phone: null, intent: "EXPLORATORY", value: 2400 },
  { key: "aisha", first: "Aisha", last: "Rahman", company: "Thornloft Software Ltd", role: "Chief Product Officer", source: "mcp", status: "NEW", q: "PENDING", service: "website", days: 0, phone: null, intent: null, value: null },
  { key: "ben", first: "Ben", last: "Carrow", company: "Merrowgate Accountancy Ltd", role: "Partner", source: "csv", status: "CONTACTED", q: "PENDING", service: "website", days: 9, phone: null, intent: "LOW", value: null },
  { key: "chloe", first: "Chloe", last: "Winters", company: "Farrowdene Logistics Ltd", role: "Marketing Manager", source: "manual", status: "QUALIFIED", q: "QUALIFIED", service: "cro", days: 5, phone: "+447700900316", intent: "HIGH", value: 2400 },
  { key: "ethan", first: "Ethan", last: "Doyle", company: "Calderwyck Recruitment Ltd", role: "Director", source: "meta", status: "LOST", q: "NOT_QUALIFIED", service: "website", days: 14, phone: "+447700900317", intent: "NEGATIVE", value: 7000 },
  { key: "isla", first: "Isla", last: "Fenwick", company: "Lindenhythe Health Ltd", role: "Head of Digital", source: "google_ads", status: "RESPONDED", q: "PENDING", service: "website", days: 1, phone: "+447700900318", intent: "MEDIUM", value: 16000 },
  { key: "james", first: "James", last: "Okoro", company: "Mossgarth Brewing Co Ltd", role: "Commercial Director", source: "webform", status: "BOOKED", q: "QUALIFIED", service: "shopify", days: 8, phone: "+447700900319", intent: "BOOKING_READY", value: 19500 },
  { key: "lucy", first: "Lucy", last: "Brennan", company: "Tallowmere Property Ltd", role: "Marketing Lead", source: "meta", status: "CONTACTED", q: "PENDING", service: "website", days: 2, phone: "+447700900320", intent: "EXPLORATORY", value: null },
  { key: "noah", first: "Noah", last: "Whitlock", company: "Harlowmere Studio Ltd", role: "Studio Director", source: "csv", status: "NEW", q: "PENDING", service: "cro", days: 12, phone: null, intent: null, value: null },
  { key: "sophie", first: "Sophie", last: "Lang", company: "Pennigrove Consulting Ltd", role: "Managing Partner", source: "webform", status: "QUALIFIED", q: "QUALIFIED", service: "cro", days: 7, phone: "+447700900321", intent: "HIGH", value: 3600 },
  { key: "tom", first: "Tomasz", last: "Wilk", company: "Stravenholt Engineering Ltd", role: "Head of Sales", source: "linkedin_ads", status: "RESPONDED", q: "REVIEW", service: "website", days: 3, phone: "+447700900322", intent: "MEDIUM", value: 13000 },
  { key: "zara", first: "Zara", last: "Hewitt", company: "Tamberlow Events Ltd", role: "Founder", source: "manual", status: "WON", q: "QUALIFIED", service: "website", days: 26, phone: "+447700900323", intent: "PURCHASE_READY", value: 8500 },
  { key: "rory", first: "Rory", last: "McCall", company: "Quillfield Analytics Ltd", role: "CTO", source: "api", status: "NEW", q: "PENDING", service: "website", days: 0, phone: null, intent: null, value: null },
  { key: "hannah", first: "Hannah", last: "Pryce", company: "Brindlecourt Commerce Ltd", role: "Marketing Manager", source: "csv", status: "CONTACTED", q: "PENDING", service: "shopify", days: 32, phone: null, intent: "NOT_NOW", value: null },
  { key: "kieran", first: "Kieran", last: "Sale", company: "Saltmere Outfitters Ltd", role: "Operations Manager", source: "google_ads", status: "CONTACTED", q: "PENDING", service: "shopify", days: 40, phone: "+447700900324", intent: "LOW", value: null },
  { key: "megan", first: "Megan", last: "Ashworth", company: "Farrowdene Logistics Ltd", role: "Director", source: "meta", status: "RESPONDED", q: "PENDING", service: "website", days: 38, phone: "+447700900325", intent: "NOT_NOW", value: null },
  { key: "pete", first: "Peter", last: "Voss", company: "Merrowgate Accountancy Ltd", role: "Office Manager", source: "manual", status: "NEW", q: "PENDING", service: "website", days: 1, phone: "+447700900326", intent: null, value: null },
  // A throwaway lead kept for the "erase" help screenshot.
  { key: "erase", first: "Dominic", last: "Hale", company: "Harlowmere Studio Ltd", role: "Producer", source: "webform", status: "LOST", q: "NOT_QUALIFIED", service: "website", days: 50, phone: "+447700900327", intent: "NEGATIVE", value: null },
];

const SOURCE_SHAPES = {
  meta: (l) => ({ type: "AD_FORM", provider: "meta", pageId: "demo-page-1001", pageName: "Blackwellen", formId: "demo-form-2001", formName: "Website project enquiry", campaignId: "demo-camp-3001", campaignName: "Autumn website builds", adName: "Carousel - recent builds", caller: { type: "CONNECTOR" } }),
  google_ads: () => ({ type: "AD_FORM", provider: "google_ads", formId: "demo-gform-11", formName: "Get a quote", campaignId: "demo-gcamp-21", campaignName: "Shopify build - search", gclid: `demo-gclid-${randomUUID().slice(0, 8)}`, caller: { type: "CONNECTOR" } }),
  linkedin_ads: () => ({ type: "AD_FORM", provider: "linkedin_ads", formId: "demo-li-form-7", formName: "Discovery call request", campaignName: "Director-level website refresh", caller: { type: "CONNECTOR" } }),
  webform: () => ({ type: "WEB_FORM", provider: "webform", formName: "Contact form", landingUrl: `${DEMO.website}/contact`, referrer: "https://www.search.example/", utm: { source: "google", medium: "organic" }, caller: { type: "SYSTEM" } }),
  api: () => ({ type: "API", provider: "api", formName: "Partner referral form", utm: { source: "partner-site", medium: "referral", campaign: "q4-referrals" }, caller: { type: "API_KEY" } }),
  mcp: () => ({ type: "MCP", provider: "mcp", caller: { type: "MCP_CLIENT" } }),
  csv: () => ({ type: "CSV", provider: "csv", formName: "Networking event list (September)", caller: { type: "USER" } }),
  manual: () => ({ type: "MANUAL", provider: "manual", caller: { type: "USER" } }),
};

const RELATIONSHIP = { csv: "EXISTING_BUSINESS_RELATIONSHIP", manual: "REFERRAL", mcp: "REQUESTED_INFORMATION", api: "THEY_CONTACTED_US" };

function emailFor(lead) {
  const core = lead.company.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "");
  return `${lead.first.toLowerCase()}.${lead.last.toLowerCase().replace(/[^a-z]/g, "")}@${core}.example`;
}

async function ensureLeads(businessId, users, services) {
  const { ingestLead } = await import("../src/lib/ingest/service.ts");
  const ids = {};
  for (const lead of LEADS) {
    const email = emailFor(lead);
    const { data: existing } = await admin
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .eq("email_normalized", email)
      .maybeSingle();
    if (existing) {
      ids[lead.key] = existing.id;
      continue;
    }
    const source = SOURCE_SHAPES[lead.source](lead);
    source.caller = { ...source.caller, id: users.owner };
    source.submittedAt = ago(lead.days, 2);
    const result = await ingestLead(
      {
        businessId,
        idempotencyKey: `help-demo:${lead.key}`,
        source,
        person: {
          firstName: lead.first,
          lastName: lead.last,
          email,
          phone: lead.phone ?? undefined,
          companyName: lead.company,
          roleTitle: lead.role,
        },
        answers:
          source.type === "AD_FORM" || source.type === "WEB_FORM"
            ? { "What do you need help with?": lead.service === "shopify" ? "A new Shopify store" : lead.service === "cro" ? "Improving conversion on our current site" : "A new website", "When are you hoping to start?": lead.days < 7 ? "Within a month" : "This quarter" }
            : undefined,
        relationship: RELATIONSHIP[lead.source],
        consent:
          lead.source === "manual"
            ? { evidence: "Introduced by email by a mutual client on 12 September; they asked us to get in touch about a website refresh." }
            : undefined,
        serviceId: services[lead.service],
      },
      {
        // No lead.process job: the seed shapes each lead's state itself, and
        // nothing may start a follow-up sequence.
        process: false,
        insertExtras: { automation_active: false, created_by_user_id: users.owner },
        permission: { recordedBy: users.owner, source: `help-demo:${lead.source}` },
      },
    );
    if (!result.leadId && result.outcome === "DUPLICATE") {
      // Created on an earlier run and since erased (the data-rights screenshot
      // erases the throwaway lead). An erased person is never recreated.
      console.log(`  ${lead.key}: erased earlier, not recreated`);
      continue;
    }
    if (!result.leadId) throw new Error(`lead ${lead.key}: ${result.outcome} ${result.reasons.join(",")}`);
    ids[lead.key] = result.leadId;
    bump("leads");
  }
  return ids;
}

/** The state each lead has reached, set directly (the engines are not run). */
async function shapeLeads(businessId, users, leadIds) {
  for (const lead of LEADS) {
    const id = leadIds[lead.key];
    if (!id) continue;
    const created = ago(lead.days, 2);
    const t = (hoursAfter) => new Date(Date.parse(created) + hoursAfter * 3_600_000).toISOString();
    const contacted = lead.status !== "NEW";
    const replied = ["RESPONDED", "QUALIFIED", "BOOKED", "WON", "LOST"].includes(lead.status) && lead.key !== "erase";
    const patch = {
      created_at: created,
      status: lead.status,
      qualification_state: lead.q,
      first_contacted_at: contacted ? t(0.02) : null,
      first_replied_at: replied ? t(0.4) : null,
      last_contact_at: contacted ? t(lead.days > 1 ? 20 : 1) : null,
      qualified_at: ["QUALIFIED", "BOOKED", "WON"].includes(lead.status) ? t(2) : null,
      booked_at: ["BOOKED", "WON"].includes(lead.status) ? t(5) : null,
      won_at: lead.status === "WON" ? t(24 * 6) : null,
      lost_at: lead.status === "LOST" ? t(24 * 3) : null,
      intent_state: lead.intent,
      intent_score:
        lead.intent == null ? null : { BOOKING_READY: 86, PURCHASE_READY: 92, HIGH: 74, MEDIUM: 55, EXPLORATORY: 38, LOW: 22, NOT_NOW: 30, NEGATIVE: 5 }[lead.intent],
      estimated_value: lead.value,
      assigned_user_id: ["daniel", "james", "fiona"].includes(lead.key) ? users.admin : ["chloe", "sophie", "isla"].includes(lead.key) ? users.member : users.owner,
      needs_attention: lead.key === "oliver" || lead.key === "tom",
      attention_reason: lead.key === "oliver" ? "Answer needs review: budget given as a range" : lead.key === "tom" ? "Asked to speak to a person" : null,
      automation_active: false,
      uk_region: "ENGLAND_AND_WALES",
    };
    await must(admin.from("leads").update(patch).eq("id", id).eq("business_id", businessId), `shape ${lead.key}`);
  }
}

/* ------------------------------------------------------------ run */

async function main() {
  console.log(`Seeding the help-centre DEMO workspace "${DEMO.name}" (${DEMO.slug})`);
  const { users, ownerPassword } = await ensureUsers();
  const businessId = await ensureBusiness(users.owner);
  console.log(`  business ${businessId} (job_claims_paused = true)`);
  await ensureMembers(businessId, users);
  await ensureSubscription(businessId);
  await ensureSettings(businessId, users);
  const services = await ensureServices(businessId);
  const leadIds = await ensureLeads(businessId, users, services);
  await shapeLeads(businessId, users, leadIds);

  const { seedPart2 } = await import("./lib/help-demo-part2.mjs");
  await seedPart2({ admin, businessId, users, services, leadIds, LEADS, counts, bump, must, ago, ahead, WITH_SIMULATED, DEMO });

  const { finalSafetyCheck } = await import("./lib/help-demo-safety.mjs");
  const safety = await finalSafetyCheck(admin, businessId, { allowSimulated: WITH_SIMULATED });

  console.log("\nCreated this run:", JSON.stringify(counts));
  console.log("Safety:", JSON.stringify(safety));
  console.log(`\nDemo owner login: ${DEMO_USERS[0].email}`);
  if (ownerPassword) console.log(`Password (shown once, not stored anywhere): ${ownerPassword}`);
  else console.log("Password unchanged (pass --reset-password to issue a new one).");
  process.exit(0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
