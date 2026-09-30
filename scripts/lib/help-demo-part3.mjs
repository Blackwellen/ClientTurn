/**
 * Help-centre demo seed, part 3: selling documents, reactivation, agents,
 * Find Leads, LinkedIn, competitors, meeting types, the developer platform,
 * sending-domain health, business facts and lead sources. Idempotent; each
 * section is wrapped so one refusal is reported rather than stopping the run.
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";

let ctx;
let h;

const lead = (key) => ctx.LEADS.find((l) => l.key === key);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function section(name, fn) {
  try {
    await fn();
  } catch (error) {
    console.warn(`  ! ${name}: ${error.message}`);
    ctx.warnings = [...(ctx.warnings ?? []), `${name}: ${error.message}`];
  }
}

/* ------------------------------------------------ lead sources */

const SOURCE_ROWS = {
  meta: { provider: "meta", page_name: "Blackwellen", form_name: "Website project enquiry", campaign_name: "Autumn website builds", source_name: "Meta Lead Ads" },
  google_ads: { provider: "google_ads", form_name: "Get a quote", campaign_name: "Shopify build - search", source_name: "Google Ads" },
  linkedin_ads: { provider: "linkedin_ads", form_name: "Discovery call request", campaign_name: "Director-level website refresh", source_name: "LinkedIn Lead Gen" },
  webform: { provider: "webform", form_name: "Contact form", source_name: "Website contact form" },
  api: { provider: "api", form_name: "Partner referral form", source_name: "API" },
  mcp: { provider: "other", source_name: "AI assistant (MCP)" },
  csv: { provider: "csv", form_name: "Networking event list (September)", source_name: "CSV import" },
  manual: { provider: "manual", source_name: "Added by hand" },
};

async function ensureLeadSources() {
  const ids = {};
  for (const [key, row] of Object.entries(SOURCE_ROWS)) {
    const existing = await h.first("lead_sources", { source_name: row.source_name });
    ids[key] = existing?.id ?? (await h.insert("lead_sources", { ...row, raw_metadata: { help_demo: true } })).id;
  }
  for (const l of ctx.LEADS) {
    if (!ctx.leadIds[l.key]) continue;
    await ctx.must(
      ctx.admin.from("leads").update({ source_id: ids[l.source] }).eq("id", ctx.leadIds[l.key]).is("source_id", null),
      `source ${l.key}`,
    );
    await ctx.must(
      ctx.admin.from("lead_touches").update({ lead_source_id: ids[l.source], occurred_at: ctx.ago(l.days, 2) }).eq("lead_id", ctx.leadIds[l.key]).is("lead_source_id", null),
      `touch ${l.key}`,
    );
  }
}

/* ------------------------------------------------ catalogue, quotes, invoices */

const ITEMS = [
  { id: "discovery-design", name: "Discovery and design", serviceKey: "website", chargeType: "ONE_OFF", unit: "project", unitPriceMinor: 350000, description: "Workshops, sitemap, wireframes and two design routes." },
  { id: "website-build", name: "Website build", serviceKey: "website", chargeType: "ONE_OFF", unit: "project", unitPriceMinor: 650000, description: "Responsive build on your chosen CMS, up to 15 page templates." },
  { id: "shopify-build", name: "Shopify store build", serviceKey: "shopify", chargeType: "ONE_OFF", unit: "project", unitPriceMinor: 1250000, description: "Theme, product data migration and payment set-up." },
  { id: "product-migration", name: "Product data migration", serviceKey: "shopify", chargeType: "ONE_OFF", unit: "100 products", unitPriceMinor: 25000, description: "Products, variants and redirects moved from your current platform." },
  { id: "cro-retainer", name: "Conversion and SEO retainer", serviceKey: "cro", chargeType: "RECURRING", interval: { unit: "MONTH", count: 1 }, unit: "month", unitPriceMinor: 120000, description: "Monthly testing, technical SEO and a written report." },
  { id: "support-hours", name: "Support hours", serviceKey: null, chargeType: "ONE_OFF", unit: "hour", unitPriceMinor: 9500, description: "Ad hoc changes after launch." },
];

async function ensureCatalogue() {
  await ctx.must(
    ctx.admin.from("quote_settings").upsert(
      {
        business_id: ctx.businessId,
        currency: "GBP",
        vat_registered: false,
        legal_name: "Blackwellen Ltd",
        validity_days: 30,
        payment_terms_days: 14,
        default_deposit_bps: 3000,
        terms_text: "DEMO WORKSPACE. Illustrative terms only: 30% deposit on acceptance, balance on launch.",
      },
      { onConflict: "business_id" },
    ),
    "quote_settings",
  );
  for (const item of ITEMS) {
    const exists = await h.first("catalogue_items", { key: item.id });
    if (exists) continue;
    const { serviceKey, ...rest } = item;
    await h.op("catalogue.upsert_item", {
      item: { ...rest, currency: "GBP", vatRate: "STANDARD", serviceId: serviceKey ? ctx.services[serviceKey] : null },
    });
    ctx.bump("catalogue_items");
  }
}

async function quoteFor(key, title, lines, { send }) {
  const oppId = ctx.dealIds[key];
  const existing = await h.first("quotes", { opportunity_id: oppId });
  if (existing) return existing;
  const created = await h.op("quote.create", { opportunityId: oppId, title, lines, requestId: `help-demo-quote-${key}`, ...(lines.some((l) => ["cro-retainer"].includes(l.itemId)) ? {} : { payment: { deposit: { type: "PERCENT", bps: 3000 } } }) });
  const quoteId = created.quoteId ?? created.id ?? created.quote?.id;
  ctx.bump("quotes");
  if (send && quoteId) {
    // `link`: no email is sent; the result carries the public link.
    const sent = await h.op("quote.send", { quoteId, channel: "link" }, { confirmed: true });
    ctx.quoteLinks = { ...(ctx.quoteLinks ?? {}), [key]: sent.link ?? sent.url ?? sent.publicUrl ?? null };
  }
  return h.first("quotes", { opportunity_id: oppId });
}

async function ensureQuotes() {
  // Draft: Harriet (website).
  await quoteFor("harriet", "Quillfield Analytics website rebuild", [
    { lineId: "l1", kind: "ITEM", itemId: "discovery-design", quantity: 1 },
    { lineId: "l2", kind: "ITEM", itemId: "website-build", quantity: 1 },
  ], { send: false });
  // Sent: Sophie (retainer) and Chloe (retainer).
  await quoteFor("sophie", "Pennigrove conversion retainer", [
    { lineId: "l1", kind: "ITEM", itemId: "cro-retainer", quantity: 3 },
  ], { send: true });
  await quoteFor("chloe", "Farrowdene quote-request optimisation", [
    { lineId: "l1", kind: "ITEM", itemId: "cro-retainer", quantity: 6 },
    { lineId: "l2", kind: "ITEM", itemId: "support-hours", quantity: 10 },
  ], { send: true });
  // Signed by the customer, invoiced and paid: Fiona (deposit paid) and Zara
  // (paid in full). Their deals are won, so each is reopened for the quote,
  // signed through the public-page handler, invoiced, then closed again.
  await signedAndInvoiced("fiona", "Saltmere Outfitters Shopify store", [
    { lineId: "l1", kind: "ITEM", itemId: "shopify-build", quantity: 1 },
    { lineId: "l2", kind: "ITEM", itemId: "product-migration", quantity: 4 },
  ], "deposit");
  await signedAndInvoiced("zara", "Tamberlow Events website", [
    { lineId: "l1", kind: "ITEM", itemId: "website-build", quantity: 1 },
  ], "all");
}

async function signQuote(key, link) {
  const token = new URL(link).pathname.split("/").pop();
  const { handleQuoteSignRequest, issueFormNonce, CLIENT_HEADER } = await import("../../src/lib/quotes/public-sign.ts");
  const { livePublicDeps } = await import("../../src/lib/quotes/public-server.ts");
  const deps = livePublicDeps();
  const l = lead(key);
  const headers = new Headers({ [CLIENT_HEADER]: "1", origin: deps.allowedOrigins[0], "sec-fetch-site": "same-origin", "x-forwarded-for": "127.0.0.1", "user-agent": "help-demo-seed" });
  const result = await handleQuoteSignRequest(deps, token, headers, {
    nonce: issueFormNonce(deps.secret, token, new Date()),
    idempotencyKey: randomUUID(),
    signerName: `${l.first} ${l.last}`,
    signerEmail: `${l.first.toLowerCase()}.${l.last.toLowerCase()}@${l.company.split(" ")[0].toLowerCase()}.example`,
    signerTitle: l.role,
    typedName: `${l.first} ${l.last}`,
    consent: true,
    consentVersion: "consent/1",
  });
  if (result.status !== 200) throw new Error(`sign ${key}: ${result.status} ${JSON.stringify(result.body)}`);
}

async function signedAndInvoiced(key, title, lines, pay) {
  const oppId = ctx.dealIds[key];
  if (await h.first("quotes", { opportunity_id: oppId })) return;
  const { data: opp } = await ctx.admin.from("opportunities").select("stage, outcome, closed_at").eq("id", oppId).single();
  await ctx.must(ctx.admin.from("opportunities").update({ stage: "PROPOSAL", outcome: "OPEN", closed_at: null }).eq("id", oppId), "reopen");
  try {
    await quoteFor(key, title, lines, { send: true });
    const link = ctx.quoteLinks?.[key];
    if (!link) throw new Error(`no link for ${key}`);
    await signQuote(key, link);
    const quote = await h.first("quotes", { opportunity_id: oppId });
    await h.op("invoice.create_from_quote", { quoteId: quote.id, autoIssue: true }, { confirmed: true });
    const { data: invoices } = await ctx.admin.from("invoices").select("id, kind, status, total_minor, paid_minor").eq("opportunity_id", oppId).order("created_at");
    for (const inv of invoices ?? []) {
      if (inv.status === "DRAFT") await h.op("invoice.issue", { invoiceId: inv.id, send: false }, { confirmed: true });
    }
    const { data: issued } = await ctx.admin.from("invoices").select("id, kind, status, total_minor, paid_minor").eq("opportunity_id", oppId).order("created_at");
    const toPay = pay === "all" ? issued : issued.filter((i) => i.kind === "DEPOSIT" || issued.length === 1);
    for (const inv of toPay ?? []) {
      if (inv.status === "OPEN") {
        await h.op("invoice.record_payment", { invoiceId: inv.id, amountMinor: Number(inv.total_minor), receivedAt: new Date().toISOString(), reference: `DEMO-BACS-${inv.id.slice(0, 6)}`, provider: "bank_transfer" }, { confirmed: true });
      }
    }
  } finally {
    await ctx.must(ctx.admin.from("opportunities").update({ stage: opp.stage, outcome: opp.outcome, closed_at: opp.closed_at }).eq("id", oppId), "re-close");
  }
}

/* ------------------------------------------------ reactivation */

async function ensureReactivation() {
  const draft = await h.first("campaigns", { name: "Spring website refresh check-in" });
  if (!draft) {
    await h.insert("campaigns", {
      name: "Spring website refresh check-in",
      status: "DRAFT",
      channel: "sms",
      description: "Leads who asked about a website over six months ago and never booked.",
      audience_label: "Enquiries older than 6 months, not booked",
      message_template: "Hi {{first_name}}, it's Alex at Blackwellen. You asked about a new website a while ago. Is it still on the cards this year? Reply STOP to opt out.",
      filter_config: { olderThanDays: 180, noReply: true, notBooked: true },
      estimated_audience_size: 14,
      created_by: ctx.users.owner,
    });
  }
  const done = await h.first("campaigns", { name: "Summer Shopify win-back" });
  if (!done) {
    const c = await h.insert("campaigns", {
      name: "Summer Shopify win-back",
      status: "COMPLETED",
      channel: "email",
      subject_template: "Still thinking about Shopify?",
      message_template: "Hi {{first_name}}, we spoke earlier in the year about moving your store to Shopify. We have availability in October if the timing now works. Alex",
      description: "Past Shopify enquiries that went quiet.",
      audience_label: "Shopify enquiries, no reply in 60 days",
      estimated_audience_size: 3,
      launched_at: ctx.ago(34),
      launched_by: ctx.users.owner,
      started_at: ctx.ago(34),
      completed_at: ctx.ago(31),
      created_by: ctx.users.owner,
      send_timing: "immediate",
    });
    for (const [key, state] of [["hannah", "replied"], ["kieran", "delivered"], ["megan", "replied"]]) {
      await h.insert("campaign_contacts", {
        campaign_id: c.id,
        lead_id: ctx.leadIds[key],
        state,
        channel: "email",
        sent_at: ctx.ago(34),
        delivered_at: ctx.ago(34),
        replied_at: state === "replied" ? ctx.ago(33) : null,
      });
    }
  }
}

/* ------------------------------------------------ Find Leads */

const PROSPECTS = [
  { first: "Rowan", last: "Ellery", company: "Ashbrindle Software Ltd", role: "Head of Marketing", grade: "A", score: 88, status: "READY", linkedin: true, website: "https://www.ashbrindle.example" },
  { first: "Meera", last: "Kapoor", company: "Kelvermoor Retail Ltd", role: "Ecommerce Manager", grade: "A", score: 84, status: "READY", linkedin: true, website: "https://www.kelvermoor.example" },
  { first: "Callum", last: "Stroud", company: "Oxenhythe Analytics Ltd", role: "Founder", grade: "B", score: 76, status: "APPROVED", linkedin: true, website: "https://www.oxenhythe.example", invited: true },
  { first: "Niamh", last: "Doherty", company: "Pellowmarsh Consulting Ltd", role: "Managing Director", grade: "B", score: 71, status: "APPROVED", linkedin: true, website: "https://www.pellowmarsh.example", accepted: true },
  { first: "Owen", last: "Blakely", company: "Hollinbrook Foods Ltd", role: "Marketing Director", grade: "A", score: 90, status: "APPROVED", linkedin: true, website: "https://www.hollinbrook.example", accepted: true },
  { first: "Freya", last: "Lindqvist", company: "Vardenhall Studio Ltd", role: "Creative Director", grade: "B", score: 69, status: "VERIFIED", linkedin: false, website: "https://www.vardenhall.example" },
  { first: "Hugo", last: "Barraclough", company: "Quarrywick Engineering Ltd", role: "Commercial Director", grade: "B", score: 66, status: "REVIEW", linkedin: true, website: null },
  { first: "Amara", last: "Osei", company: "Wickenmoor Health Ltd", role: "Head of Digital", grade: "A", score: 82, status: "VERIFIED", linkedin: false, website: "https://www.wickenmoor.example" },
  { first: "Lewis", last: "Tranter", company: "Brackwater Logistics Ltd", role: "Operations Director", grade: "C", score: 54, status: "DISCOVERED", linkedin: false, website: "https://www.brackwater.example" },
  { first: "Priyanka", last: "Menon", company: "Lumbercote Interiors Ltd", role: "Founder", grade: "B", score: 73, status: "READY", linkedin: true, website: "https://www.lumbercote.example" },
];

function manchesterPlan(SEGMENT_PRESETS) {
  return {
    version: 1,
    industries: ["Software development", "Online retail", "Management consultancy"],
    locations: [{ country: "GB", region: "North West", city: "Manchester", radiusKm: 40, lat: 53.4808, lon: -2.2426, resolved: true }],
    company: { minEmployees: 10, maxEmployees: 50, revenueMinMinor: null, revenueMaxMinor: null, organizationTypes: ["COMMERCIAL"] },
    decisionMakerRoles: ["Head of Marketing", "Marketing Director", "Founder", "Managing Director"],
    intent: { categories: [], freshnessDays: 90, required: false },
    signals: {
      hiringRoles: ["Marketing Manager"],
      technologies: [],
      fundingFilings: true,
      leadershipChanges: false,
      recentlyIncorporated: false,
      officeMoves: false,
      intentTypes: ["WEBSITE_RELAUNCH", "REBRAND", "HIRING_ROLE", "CAPITAL_RAISED"],
      roleFunctions: ["MARKETING"],
    },
    segment: SEGMENT_PRESETS.find((p) => p.name === "Raised funds and hiring marketing")?.segment ?? null,
    linkedin: {
      geography: ["Greater Manchester, England, United Kingdom"],
      industries: ["Software Development", "Retail"],
      headcountBands: [],
      headcountGrowth: { minPct: null, maxPct: null },
      companyTypes: [],
      seniorities: [],
      functions: [],
      titlesInclude: ["Head of Marketing", "Marketing Director"],
      titlesExclude: ["Assistant"],
      yearsInCurrentPosition: [],
      yearsAtCurrentCompany: [],
      changedJobsPast90Days: false,
      postedOnLinkedinPast30Days: false,
      keywords: "website",
    },
    minimumGrade: "B",
    targetVerifiedProspects: 50,
    reviewMode: "HUMAN_REVIEW",
    conversionGoal: "BOOK_APPOINTMENT",
    maxProviderCostMinor: 2000,
  };
}

async function ensureFindLeads() {
  const { parsePlan } = await import("../../src/lib/find-leads/plan.ts");
  const { SEGMENT_PRESETS } = await import("../../src/lib/find-leads/intent-segments.ts");
  const { LINKEDIN_HEADCOUNT_BANDS, LINKEDIN_SENIORITIES, LINKEDIN_FUNCTIONS } = await import("../../src/lib/find-leads/linkedin-filters.ts");
  const raw = manchesterPlan(SEGMENT_PRESETS);
  raw.linkedin.headcountBands = LINKEDIN_HEADCOUNT_BANDS.filter((b) => /11|51/.test(String(b))).slice(0, 2);
  raw.linkedin.seniorities = LINKEDIN_SENIORITIES.filter((s) => /DIRECTOR|OWNER|VP|CXO|HEAD/i.test(String(s))).slice(0, 3);
  raw.linkedin.functions = LINKEDIN_FUNCTIONS.filter((f) => /MARKETING/i.test(String(f))).slice(0, 1);
  const plan = parsePlan(raw);
  if (!plan) throw new Error("the demo search plan does not validate");

  let session = await h.first("search_sessions", { title: "SaaS and ecommerce in Manchester, 10 to 50 staff" });
  if (!session) {
    session = await h.insert("search_sessions", { user_id: ctx.users.owner, title: "SaaS and ecommerce in Manchester, 10 to 50 staff", status: "ACTIVE", created_at: ctx.ago(9) });
    await h.insert("search_messages", {
      session_id: session.id,
      role: "USER",
      content: "SaaS and ecommerce companies around Manchester with 10 to 50 staff that have raised money recently and are hiring in marketing. Heads of marketing or founders.",
      created_at: ctx.ago(9),
    });
    const strategy = await h.insert("search_strategies", {
      session_id: session.id,
      version: 1,
      strategy_json: plan,
      estimated_cost_minor: 1200,
      status: "APPROVED",
      approved_by: ctx.users.owner,
      approved_at: ctx.ago(9),
    });
    await h.insert("search_strategy_versions", { strategy_id: strategy.id, version: 1, changed_by: "USER", changed_by_user_id: ctx.users.owner, snapshot_json: plan });
    await ctx.must(ctx.admin.from("search_sessions").update({ latest_strategy_id: strategy.id, message_count: 1, prospects_found: PROSPECTS.length }).eq("id", session.id), "session link");
    session.latest_strategy_id = strategy.id;
  }
  ctx.sessionId = session.id;
  ctx.strategyId = session.latest_strategy_id;

  // A second session with an unapproved (draft) plan, as a person left it.
  let draft = await h.first("search_sessions", { title: "Professional services in Leeds" });
  if (!draft) {
    draft = await h.insert("search_sessions", { user_id: ctx.users.owner, title: "Professional services in Leeds", status: "ACTIVE", created_at: ctx.ago(2) });
    await h.insert("search_messages", { session_id: draft.id, role: "USER", content: "Law firms and accountants in Leeds, 20 to 100 staff, partners or practice managers.", created_at: ctx.ago(2) });
    const draftPlan = parsePlan({
      ...raw,
      industries: ["Legal services", "Accounting"],
      locations: [{ country: "GB", region: "Yorkshire and the Humber", city: "Leeds", radiusKm: 25, lat: 53.8008, lon: -1.5491, resolved: true }],
      company: { minEmployees: 20, maxEmployees: 100, revenueMinMinor: null, revenueMaxMinor: null, organizationTypes: ["COMMERCIAL"] },
      decisionMakerRoles: ["Partner", "Practice Manager"],
      segment: null,
      signals: { ...raw.signals, intentTypes: ["WEBSITE_RELAUNCH", "NEW_OFFICE"], fundingFilings: false, hiringRoles: [] },
    });
    const s = await h.insert("search_strategies", { session_id: draft.id, version: 1, strategy_json: draftPlan, estimated_cost_minor: 900, status: "DRAFT" });
    await ctx.must(ctx.admin.from("search_sessions").update({ latest_strategy_id: s.id, message_count: 1 }).eq("id", draft.id), "draft session link");
  }
  ctx.draftSessionId = draft.id;

  // The completed run and its stages.
  let run = await h.first("sourcing_runs", { session_id: session.id });
  if (!run) {
    const started = Date.parse(ctx.ago(9)) + 600_000;
    run = await h.insert("sourcing_runs", {
      search_strategy_id: session.latest_strategy_id,
      session_id: session.id,
      started_by: ctx.users.owner,
      trigger_source: "MANUAL",
      status: "COMPLETED",
      current_stage: "DONE",
      title: "SaaS and ecommerce in Manchester",
      target_verified: 50,
      progress_percent: 100,
      max_provider_cost_minor: 2000,
      spent_cost_minor: 640,
      counts_json: { companies_found: 64, contacts_found: 31, verified: PROSPECTS.length, ready: 3 },
      started_at: new Date(started).toISOString(),
      completed_at: new Date(started + 19 * 60_000).toISOString(),
    });
    const stages = [
      ["UNDERSTANDING_TARGET", "Read the approved plan.", 1],
      ["PLANNING_SEARCH", "Planned 6 searches across 2 sources.", 6],
      ["FINDING_COMPANIES", "Found 64 companies in and around Manchester.", 64],
      ["FINDING_CONTACTS", "Found 31 named decision makers on company websites.", 31],
      ["PRE_FILTERING", "Removed 12 outside 10 to 50 staff.", 19],
      ["ENRICHING", "Read team and contact pages.", 19],
      ["VERIFYING", "Checked work email addresses.", 14],
      ["DEDUPLICATING", "Removed 2 already in your leads.", 12],
      ["CLASSIFYING", "Matched companies to industries.", 12],
      ["SCORING", "Scored against your plan.", 10],
      ["INTENT_MATCHING", "Matched recorded signals to your combination.", 3],
      ["PREPARING_OUTREACH", "Nothing contacted: review before outreach is on.", 10],
    ];
    for (const [i, [stage, summary, count]] of stages.entries()) {
      await h.insert("sourcing_run_stages", {
        run_id: run.id,
        stage_number: i + 1,
        stage_key: stage,
        status: "COMPLETED",
        safe_summary: summary,
        record_count: count,
        started_at: new Date(started + i * 90_000).toISOString(),
        completed_at: new Date(started + i * 90_000 + 80_000).toISOString(),
        duration_ms: 80_000,
      });
    }
    await ctx.must(ctx.admin.from("search_sessions").update({ last_run_id: run.id }).eq("id", session.id), "last run");
  }
  ctx.runId = run.id;

  // A LinkedIn sending account (ASSISTED: a person sends; nothing automatic).
  let account = await h.first("social_sending_accounts", { platform: "LINKEDIN", external_handle: "alex-morgan-demo" });
  if (!account) {
    account = await h.insert("social_sending_accounts", {
      platform: "LINKEDIN",
      account_tier: "SALES_NAVIGATOR",
      display_name: "Alex Morgan (demo)",
      external_handle: "alex-morgan-demo",
      status: "ACTIVE",
      send_mode: "ASSISTED",
      daily_connect_cap: 15,
      monthly_note_cap: 5,
      weekly_connect_cap: 80,
      daily_message_cap: 30,
      created_by: ctx.users.owner,
    });
  }

  ctx.prospectIds = {};
  for (const [i, p] of PROSPECTS.entries()) {
    const core = p.company.split(" ")[0].toLowerCase();
    let company = await h.first("prospect_companies", { name: p.company });
    if (!company) {
      company = await h.insert("prospect_companies", {
        name: p.company,
        domain: p.website ? `${core}.example` : null,
        website_url: p.website,
        industry: /Software|Analytics/.test(p.company) ? "Software development" : /Retail|Foods/.test(p.company) ? "Online retail" : "Professional services",
        company_size: "11-50",
        employee_count: 14 + i * 3,
        location_json: { city: "Manchester", country: "GB" },
        dedupe_key: `help-demo:${core}`,
        subscriber_type: "CORPORATE",
      });
    }
    let prospect = await h.first("prospects", { company_id: company.id });
    if (!prospect) {
      prospect = await h.insert("prospects", {
        company_id: company.id,
        first_name: p.first,
        last_name: p.last,
        role_title: p.role,
        role_classification: "DECISION_MAKER",
        email: p.website ? `${p.first.toLowerCase()}@${core}.example` : null,
        email_origin: p.website ? "FOUND_PUBLICLY" : null,
        linkedin_url: p.linkedin ? `https://www.linkedin.com/in/help-demo-${p.first.toLowerCase()}-${core}-x7/` : null,
        location_json: { city: "Manchester", country: "GB" },
        status: p.status,
        grade: p.grade,
        score: p.score,
        verification_status: p.website ? "VALID" : "UNKNOWN",
        subscriber_type: "CORPORATE",
        outreach_eligibility: p.status === "REVIEW" || p.status === "DISCOVERED" ? "REVIEW" : "ELIGIBLE",
        source_run_id: run.id,
        source_provider: p.website ? "company_website" : "linkedin_import",
        approved_by: p.status === "APPROVED" ? ctx.users.owner : null,
        approved_at: p.status === "APPROVED" ? ctx.ago(8) : null,
        created_at: ctx.ago(9),
      });
    }
    ctx.prospectIds[p.first] = prospect.id;
    if (p.linkedin && (p.invited || p.accepted)) {
      const existing = await h.first("social_connection_states", { prospect_id: prospect.id });
      if (!existing) {
        await h.insert("social_connection_states", {
          prospect_id: prospect.id,
          account_id: account.id,
          platform: "LINKEDIN",
          state: p.accepted ? "ACCEPTED" : "INVITE_SENT",
          profile_url: prospect.linkedin_url,
          note_attached: true,
          invite_sent_at: ctx.ago(p.accepted ? 6 : 3),
          accepted_at: p.accepted ? ctx.ago(4) : null,
          next_action: null,
          next_action_at: null,
        });
      }
    }
  }

  // InMails recorded by hand (the credit balance is computed from these).
  if (!(await h.first("inmail_sends", { prospect_id: ctx.prospectIds.Owen }))) {
    await h.insert("inmail_sends", { prospect_id: ctx.prospectIds.Owen, sent_by: ctx.users.owner, sent_at: ctx.ago(12), replied_at: ctx.ago(11), note: "Asked about their Shopify replatform." });
    await h.insert("inmail_sends", { prospect_id: ctx.prospectIds.Niamh, sent_by: ctx.users.owner, sent_at: ctx.ago(5), note: "Intro after their rebrand announcement." });
    await h.insert("inmail_sends", { prospect_id: ctx.prospectIds.Rowan, sent_by: ctx.users.owner, sent_at: ctx.ago(2), note: "Congratulated them on the new Head of Growth hire." });
  }
}

/* ------------------------------------------------ agents */

async function ensureAgents() {
  const existing = await ctx.admin.from("agents").select("id, name").eq("business_id", ctx.businessId);
  const names = new Set((existing.data ?? []).map((a) => a.name));
  if (!names.has("Manchester SaaS sourcing")) {
    await h.op("agent.create", {
      name: "Manchester SaaS sourcing",
      description: "Finds SaaS and ecommerce companies around Manchester from the approved search plan.",
      type: "SOURCING",
      cadence: "DAILY",
      dailyCap: 10,
      monthlyCap: 150,
      searchPlanId: ctx.strategyId,
    });
  }
  if (!names.has("Shopify closer")) {
    await h.op("agent.create", {
      name: "Shopify closer",
      description: "Books qualified Shopify enquiries into a discovery call and proposes the Shopify build.",
      type: "BOOKING",
      cadence: "HOURLY",
      dailyCap: 20,
      monthlyCap: 300,
    });
  }
  if (!names.has("Quiet leads check-in")) {
    await h.op("agent.create", { name: "Quiet leads check-in", description: "Re-engages leads who went quiet after asking for a quote.", type: "REENGAGEMENT", cadence: "WEEKLY", dailyCap: 10, monthlyCap: 100 });
  }
  const { data: agents } = await ctx.admin.from("agents").select("id, name, status, offer_scope").eq("business_id", ctx.businessId);
  const byName = Object.fromEntries((agents ?? []).map((a) => [a.name, a]));
  const closer = byName["Shopify closer"];
  if (closer && closer.offer_scope !== "SELECTED") {
    const { data: items } = await ctx.admin.from("catalogue_items").select("id").eq("business_id", ctx.businessId).in("key", ["shopify-build", "product-migration"]);
    await h.op("agent.set_offer_target", { agentId: closer.id, scope: "SELECTED", serviceIds: [ctx.services.shopify], catalogueItemIds: (items ?? []).map((i) => i.id) });
  }
  // Paused (never ACTIVE: the scheduler runs ACTIVE agents inline). The
  // sourcing agent carries a history of overnight scheduled runs.
  const sourcing = byName["Manchester SaaS sourcing"];
  if (sourcing) {
    await ctx.must(
      ctx.admin
        .from("agents")
        .update({ status: "PAUSED", paused_at: ctx.ago(0, 3), activated_at: ctx.ago(8), last_run_at: ctx.ago(0, 11), last_run_status: "COMPLETED", total_prospects: 10, total_leads: 1, next_run_at: null })
        .eq("id", sourcing.id),
      "pause sourcing agent",
    );
    const { count } = await ctx.admin.from("agent_activity_events").select("id", { count: "exact", head: true }).eq("agent_id", sourcing.id).eq("event_type", "RUN_QUEUED");
    if (!count) {
      for (let d = 7; d >= 1; d -= 1) {
        const at = new Date(Date.parse(ctx.ago(d)));
        at.setUTCHours(1, 7 + d, 0, 0); // 02:xx UK time, nobody signed in
        await h.insert("agent_activity_events", {
          agent_id: sourcing.id,
          event_type: "RUN_QUEUED",
          severity: "INFO",
          title: "Sourcing run queued",
          detail: "Searching for up to 10 prospects. New prospects wait for your review before any outreach.",
          subject_type: "sourcing_run",
          metadata: { trigger: "SCHEDULE", help_demo: true },
          created_at: at.toISOString(),
        });
      }
    }
  }
}

/* ------------------------------------------------ LinkedIn Assist */

async function ensureLinkedInAssist() {
  await h.op("linkedin_assist.update_settings", {
    accountTier: "SALES_NAVIGATOR",
    dailyConnectionNotes: 10,
    weeklyConnectionRequests: 60,
    dailyMessages: 20,
    monthlyInMailCredits: 50,
    followUpAfterDays: 4,
    maxFollowUps: 2,
    paused: false,
  }).catch((e) => console.warn(`  linkedin settings: ${e.message}`));
  for (const key of ["grace", "isla", "tom"]) {
    if (await h.first("linkedin_assist_contacts", { lead_id: ctx.leadIds[key] })) continue;
    const l = lead(key);
    const core = l.company.split(" ")[0].toLowerCase();
    await h.op("linkedin_assist.add_contact", {
      leadId: ctx.leadIds[key],
      profileUrl: `https://www.linkedin.com/in/help-demo-${l.first.toLowerCase()}-${core}-x7/`,
      firstTouch: "CONNECTION_NOTE",
    });
  }
}

/* ------------------------------------------------ commercial rules */

async function ensureCompetitors() {
  const list = [
    { id: "rookhaven-digital", name: "Rookhaven Digital", aliases: ["Rookhaven"], approvedPoints: ["We quote a fixed price after a paid discovery, not a day rate."], neverSay: ["Anything about their clients or pricing"] },
    { id: "marlowgate-studio", name: "Marlowgate Studio", aliases: ["Marlowgate"], approvedPoints: ["Every build ships with an accessibility report."], neverSay: [] },
    { id: "corrowick-creative", name: "Corrowick Creative", aliases: [], approvedPoints: ["A named developer stays with the project after launch."], neverSay: [] },
  ];
  for (const c of list) {
    if (await h.first("workspace_competitors", { slug: c.id })) continue;
    await h.op("competitor.save", { competitor: { ...c, enabled: true } });
  }
}

async function ensureMeetingTypes() {
  const { data } = await ctx.admin.from("meeting_types").select("name").eq("business_id", ctx.businessId);
  const have = new Set((data ?? []).map((m) => m.name));
  if (!have.has("Discovery call")) {
    await h.op("meeting_type.save", { name: "Discovery call", durationMinutes: 30, bufferMinutes: 15, assigneeRule: "ROUND_ROBIN", eligibleUserIds: [ctx.users.owner, ctx.users.admin], serviceIds: [ctx.services.website, ctx.services.cro], isDefault: true });
  }
  if (!have.has("Shopify scoping session")) {
    await h.op("meeting_type.save", { name: "Shopify scoping session", durationMinutes: 60, bufferMinutes: 15, assigneeRule: "OWNER", eligibleUserIds: [ctx.users.admin], serviceIds: [ctx.services.shopify], isDefault: false });
  }
}

/* ------------------------------------------------ developer platform */

async function ensureDeveloper() {
  // Keys and client secrets are hashes of random values nobody holds: the rows
  // can never authenticate anything.
  if (!(await h.first("api_keys", { name: "Website form (Zapier)" }))) {
    const secret = randomBytes(32).toString("hex");
    await h.insert("api_keys", {
      name: "Website form (Zapier)",
      key_prefix: "ct_live",
      key_last_four: secret.slice(-4),
      key_hash: sha256(`unusable:${secret}`),
      environment: "live",
      scopes: ["business:read", "leads:read", "leads:write"],
      user_id: ctx.users.owner,
      created_by: ctx.users.owner,
      last_used_at: ctx.ago(0, 5),
      request_count: 184,
      created_at: ctx.ago(30),
    });
  }
  let endpoint = await h.first("webhook_endpoints", { url: `https://hooks.${ctx.DEMO.domain}/clientturn` });
  if (!endpoint) {
    endpoint = await h.insert("webhook_endpoints", {
      url: `https://hooks.${ctx.DEMO.domain}/clientturn`,
      description: "CRM sync",
      secret_sealed: "DEMO-NOT-A-SECRET",
      secret_hint: "whsec_…9f3a",
      events: ["lead.created", "lead.qualified", "booking.created"],
      status: "ACTIVE",
      last_success_at: ctx.ago(0, 4),
      last_failure_at: ctx.ago(0, 2),
      last_error: "Connection timed out",
      consecutive_failures: 1,
      created_by: ctx.users.owner,
      created_at: ctx.ago(20),
    });
    const rows = [
      ["lead.created", "SUCCEEDED", 1, 200, null, ctx.ago(0, 6)],
      ["lead.qualified", "SUCCEEDED", 1, 200, null, ctx.ago(0, 5)],
      ["booking.created", "SUCCEEDED", 2, 204, null, ctx.ago(0, 4)],
      ["lead.created", "PENDING", 2, 504, "Gateway timeout", ctx.ago(0, 2)],
      ["lead.qualified", "EXHAUSTED", 6, null, "Connection timed out", ctx.ago(2)],
    ];
    for (const [type, status, attempts, code, error, at] of rows) {
      await h.insert("webhook_deliveries", {
        endpoint_id: endpoint.id,
        event_id: randomUUID(),
        event_type: type,
        payload: { help_demo: true },
        status,
        attempts,
        response_status: code,
        error,
        // Retrying: a next attempt far in the future, and the dispatch job
        // that would make it is never queued (jobs are paused and purged).
        next_attempt_at: status === "PENDING" ? ctx.ahead(365) : null,
        delivered_at: status === "SUCCEEDED" ? at : null,
        created_at: at,
      });
    }
  }
  let client = await h.first("mcp_clients", { name: "Claude (Alex's laptop)" });
  if (!client) {
    client = await h.insert("mcp_clients", {
      name: "Claude (Alex's laptop)",
      description: "Assistant connection for pipeline questions.",
      oauth_client_id: `help-demo-${randomUUID()}`,
      client_secret_hash: sha256(`unusable:${randomBytes(32).toString("hex")}`),
      status: "ACTIVE",
      created_by: ctx.users.owner,
      last_used_at: ctx.ago(0, 1),
      created_at: ctx.ago(14),
    });
    for (const scope of ["business:read", "leads:read", "leads:write", "agents:read"]) {
      await h.insert("mcp_scopes", { client_id: client.id, scope, granted_by: ctx.users.owner });
    }
    // An access token whose hash matches no value anyone holds.
    await h.insert("mcp_tokens", {
      client_id: client.id,
      user_id: ctx.users.owner,
      token_hash: sha256(`unusable:${randomBytes(32).toString("hex")}`),
      token_type: "ACCESS",
      scopes: ["business:read", "leads:read", "leads:write", "agents:read"],
      expires_at: ctx.ahead(3650),
    });
  }
  if (!(await h.first("mcp_approvals", { client_id: client.id, status: "PENDING" }))) {
    await h.insert("mcp_approvals", {
      client_id: client.id,
      requested_by_user_id: ctx.users.owner,
      tool_name: "agent.start",
      arguments_json: { agent: "Manchester SaaS sourcing" },
      summary: "Start the agent \"Manchester SaaS sourcing\"",
      status: "PENDING",
      expires_at: ctx.ahead(3650),
    });
  }
}

/* ------------------------------------------------ sending domain, facts */

async function ensureEmailHealth() {
  if (!(await h.first("sender_identities", { email: `alex@${ctx.DEMO.domain}` }))) {
    await h.insert("sender_identities", {
      display_name: "Alex at Blackwellen",
      email: `alex@${ctx.DEMO.domain}`,
      domain: ctx.DEMO.domain,
      signature_text: "Alex Morgan\nBlackwellen",
      cold_enabled: false,
      warm_enabled: true,
      status: "VERIFIED",
      verified_at: ctx.ago(30),
      is_default: true,
      dkim_selector: "demo",
      health_state: "HEALTHY",
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  await ctx.must(
    ctx.admin.from("domain_health_snapshots").upsert(
      {
        business_id: ctx.businessId,
        domain: ctx.DEMO.domain,
        snapshot_date: today,
        spf_state: "PASS",
        dkim_state: "PASS",
        dmarc_state: "PASS",
        dmarc_policy: "quarantine",
        sent_count: 42,
        bounce_count: 0,
        health_state: "HEALTHY",
      },
      { onConflict: "business_id,domain,snapshot_date" },
    ),
    "domain health",
  );
}

async function ensureFacts() {
  // Business facts: four read from the (demo) website, one inferred.
  const memory = [
    ["services.primary", "Website design and build, Shopify stores, conversion retainers", "WEBSITE", 0.95, true, false],
    ["pricing.minimum_project_gbp", 6500, "WEBSITE", 0.9, true, true],
    ["coverage.region", "UK-wide, remote", "WEBSITE", 0.85, false, false],
    ["team.size", "8 people", "WEBSITE", 0.8, false, false],
    ["sales.typical_cycle_days", 21, "AI", 0.6, false, false],
  ];
  for (const [key, value, source, confidence, verified, locked] of memory) {
    await ctx.must(
      ctx.admin.from("business_memory_facts").upsert(
        { business_id: ctx.businessId, fact_key: key, value_json: { value }, source_type: source, confidence, verified_by_user: verified, locked, last_verified_at: verified ? ctx.ago(20) : null },
        { onConflict: "business_id,fact_key", ignoreDuplicates: true },
      ),
      `fact ${key}`,
    );
  }
  await ctx.must(
    ctx.admin.from("business_profiles").update({ analysis_status: "READY", pages_analysed: 5, last_analysed_at: ctx.ago(20) }).eq("business_id", ctx.businessId).eq("analysis_status", "NOT_STARTED"),
    "profile analysed",
  );
  const { data: jobs } = await ctx.admin.from("business_analysis_jobs").select("id").eq("business_id", ctx.businessId).limit(1);
  if (jobs?.length) return;
  const { data: job, error } = await ctx.admin
    .from("business_analysis_jobs")
    .insert({ business_id: ctx.businessId, status: "READY", website_url: ctx.DEMO.website, pages_targeted: 6, pages_analysed: 5, facts_found: 5, requested_by: ctx.users.owner, started_at: ctx.ago(30), completed_at: ctx.ago(30) })
    .select("id")
    .single();
  if (error) throw new Error(`analysis job: ${error.message}`);
  const facts = [
    ["BUSINESS_TYPE", { value: "Web design and development agency" }, "/", 0.95, "VERIFIED", true],
    ["SERVICES", { value: ["Website design and build", "Shopify store build", "Conversion and SEO retainers"] }, "/services", 0.92, "VERIFIED", true],
    ["TARGET_CUSTOMERS", { value: "UK B2B companies: SaaS, ecommerce and professional services" }, "/about", 0.81, "PARTIALLY_VERIFIED", false],
    ["PRICE_BAND", { value: "Projects from £6,500" }, "/pricing", 0.74, "PARTIALLY_VERIFIED", false],
    ["TERRITORIES", { value: "UK-wide, remote" }, null, 0.52, "UNVERIFIED", false],
  ];
  for (const [category, value, path, confidence, state, accepted] of facts) {
    await h.insert("business_analysis_facts", {
      analysis_id: job.id,
      category,
      value_json: value,
      source_url: path ? `${ctx.DEMO.website}${path}` : null,
      confidence,
      verification_state: state,
      accepted,
    });
  }
}

/* ------------------------------------------------ follow-up sequence */

async function ensureFollowUp() {
  let def = await h.first("automation_definitions", { type: "new_lead" });
  if (def) return;
  def = await h.insert("automation_definitions", { type: "new_lead", name: "New lead follow-up", enabled: true });
  const version = await h.insert("automation_versions", {
    automation_id: def.id,
    version_number: 1,
    status: "PUBLISHED",
    published_at: ctx.ago(40),
    published_by: ctx.users.owner,
  });
  const steps = [
    [0, "sms", null, "Hi {{first_name}}, it's Alex at Blackwellen. Thanks for your enquiry about {{service_name}}. Is now a good time for a couple of quick questions?"],
    [86400, "email", "Your enquiry with Blackwellen", "Hi {{first_name}},\n\nThanks again for getting in touch about {{service_name}}. If it's easier, you can pick a time for a 30-minute discovery call here: {{booking_link}}\n\nAlex"],
    [259200, "whatsapp", null, "Hi {{first_name}}, just checking in on your {{service_name}} enquiry. Would a quick call this week help?"],
  ];
  for (const [i, [delay, channel, subject, template]] of steps.entries()) {
    await h.insert("automation_steps", { version_id: version.id, position: i + 1, delay_seconds: delay, channel, subject, template, enabled: true });
  }
}

/* ------------------------------------------------ run */

export async function seedPart3(context, helpers) {
  ctx = context;
  h = helpers;
  await section("lead sources", ensureLeadSources);
  await section("catalogue", ensureCatalogue);
  await section("quotes", ensureQuotes);
  await section("reactivation", ensureReactivation);
  await section("find leads", ensureFindLeads);
  await section("agents", ensureAgents);
  await section("linkedin assist", ensureLinkedInAssist);
  await section("competitors", ensureCompetitors);
  await section("meeting types", ensureMeetingTypes);
  await section("developer platform", ensureDeveloper);
  await section("email health", ensureEmailHealth);
  await section("follow-up sequence", ensureFollowUp);
  await section("suppression", async () => {
    // Ethan asked not to be contacted again: an opt-out on every channel.
    const { data } = await ctx.admin.from("leads").select("opted_out").eq("id", ctx.leadIds.ethan).single();
    if (!data.opted_out) {
      await h.op("lead.suppress", { leadId: ctx.leadIds.ethan, channel: "ALL", reason: "OPT_OUT", note: "Replied asking not to be contacted again." }, { confirmed: true });
    }
  });
  await section("business facts", ensureFacts);
  if (ctx.WITH_SIMULATED) {
    const { seedSimulatedConnections } = await import("./help-demo-simulated.mjs");
    await section("simulated connections", () => seedSimulatedConnections(ctx));
  }
  if (ctx.quoteLinks) console.log("  quote links:", JSON.stringify(ctx.quoteLinks));
}
