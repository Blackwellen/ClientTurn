/**
 * The bulk of the help-centre demo seed (scripts/seed-help-demo.mjs part 2):
 * qualification, conversations, scores, deals, bookings, quotes and invoices,
 * reactivation, agents, Find Leads, LinkedIn Assist, competitors, catalogue,
 * meeting types, the developer platform and (optionally) simulated
 * connections. Every section is idempotent: it looks for its own rows first.
 *
 * Product service operations (`runOperation`) are used where one exists, so
 * the rows have exactly the shape the product writes; direct inserts are used
 * for history the product only ever writes as a side effect of real traffic
 * (messages, bookings, run stages).
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";

let ctx;

async function op(name, args, { role = "owner", confirmed = false } = {}) {
  const { runOperation } = await import("../../src/lib/services/index.ts");
  const result = await runOperation(name, args, {
    businessId: ctx.businessId,
    userId: ctx.users[role === "owner" ? "owner" : role],
    role,
    caller: "UI",
    confirmed,
    correlationId: randomUUID(),
  });
  if (!result.success) throw new Error(`${name}: ${result.code} ${result.message}`);
  return result.data;
}

async function first(table, filters) {
  let q = ctx.admin.from(table).select("*").eq("business_id", ctx.businessId);
  for (const [k, v] of Object.entries(filters)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(`${table} lookup: ${error.message}`);
  return data;
}

async function insert(table, row, what = table) {
  const { data } = await ctx.must(ctx.admin.from(table).insert({ business_id: ctx.businessId, ...row }).select("*").single(), what);
  ctx.bump(table);
  return data;
}

async function ensureRow(table, match, row) {
  return (await first(table, match)) ?? (await insert(table, { ...match, ...row }));
}

const lead = (key) => ctx.LEADS.find((l) => l.key === key);

/* ------------------------------------------------ A. qualification */

const QUESTIONS = [
  {
    key: "need",
    question_text: "What do you need help with?",
    response_type: "single_choice",
    dimension_key: "SERVICE_NEEDED",
    options: [
      ["A new website", "new_website"],
      ["A Shopify store", "shopify_store"],
      ["Improving our current site", "improve_site"],
    ],
  },
  {
    key: "budget",
    question_text: "Roughly what budget have you set aside for this?",
    help_text: "A range is fine. It helps us suggest the right scope.",
    response_type: "single_choice",
    dimension_key: "BUDGET",
    options: [
      ["Under £5,000", "under_5k"],
      ["£5,000 to £15,000", "5k_15k"],
      ["£15,000 to £30,000", "15k_30k"],
      ["Over £30,000", "over_30k"],
    ],
  },
  { key: "timing", question_text: "When would you like the project to start?", response_type: "timing", dimension_key: "TIMING" },
  {
    key: "authority",
    question_text: "Who else will be involved in choosing an agency?",
    response_type: "text",
    dimension_key: "AUTHORITY",
    required: false,
  },
];

async function ensureQualification() {
  const out = {};
  for (const [i, q] of QUESTIONS.entries()) {
    const { key, options = [], ...row } = q;
    const question = await ensureRow(
      "qualification_questions",
      { question_text: row.question_text },
      { ...row, position: i, required: row.required ?? true, active: true },
    );
    out[key] = question.id;
    for (const [j, [label, value]] of options.entries()) {
      await ensureRow("qualification_options", { question_id: question.id, value }, { label, position: j });
    }
  }
  // Budget under £5,000 goes to a person to review; the rest continue.
  await ensureRow(
    "qualification_rules",
    { question_id: out.budget, operator: "in", result: "review" },
    { rule_type: "answer", comparison_value: ["under_5k"], priority: 10, active: true },
  );
  await ensureRow(
    "qualification_rules",
    { question_id: out.need, operator: "is_present", result: "pass" },
    { rule_type: "answer", comparison_value: [], priority: 20, active: true },
  );
  return out;
}

const ANSWERS = {
  harriet: { need: ["A new website", "new_website"], budget: ["£15,000 to £30,000", "15k_30k"], timing: ["Within the next month", "within_month"], authority: ["Me and our CEO, Amir"] },
  daniel: { need: ["A Shopify store", "shopify_store"], budget: ["£15,000 to £30,000", "15k_30k"], timing: ["Next month", "within_month"] },
  fiona: { need: ["A Shopify store", "shopify_store"], budget: ["£15,000 to £30,000", "15k_30k"], timing: ["As soon as possible", "asap"], authority: ["Just me"] },
  oliver: { need: ["A new website", "new_website"], budget: ["Somewhere between 4 and 6k", "under_5k", "review"] },
  grace: { need: ["A new website", "new_website"], budget: ["£5,000 to £15,000", "5k_15k"], timing: ["This quarter", "this_quarter"] },
  chloe: { need: ["Improving our current site", "improve_site"], budget: ["£5,000 to £15,000", "5k_15k"], timing: ["Within the next month", "within_month"] },
  james: { need: ["A Shopify store", "shopify_store"], budget: ["£15,000 to £30,000", "15k_30k"], timing: ["In about six weeks", "this_quarter"], authority: ["Our finance director signs off"] },
  sophie: { need: ["Improving our current site", "improve_site"], budget: ["£5,000 to £15,000", "5k_15k"] },
  zara: { need: ["A new website", "new_website"], budget: ["£5,000 to £15,000", "5k_15k"], timing: ["As soon as possible", "asap"] },
  isla: { need: ["A new website", "new_website"] },
  tom: { need: ["A new website", "new_website"], timing: ["Not sure yet", "unknown", "review"] },
  ethan: { need: ["A new website", "new_website"], budget: ["Under £5,000", "under_5k", "review"] },
};

async function ensureAnswers(questionIds) {
  for (const [key, answers] of Object.entries(ANSWERS)) {
    const leadId = ctx.leadIds[key];
    const base = Date.parse(ctx.ago(lead(key).days, 1));
    let n = 0;
    for (const [q, [text, value, evaluation]] of Object.entries(answers)) {
      n += 1;
      await ctx.must(
        ctx.admin.from("qualification_answers").upsert(
          {
            business_id: ctx.businessId,
            lead_id: leadId,
            question_id: questionIds[q],
            answer_text: text,
            answer_value: value ?? text,
            evaluation: evaluation ?? "meets",
            source: n === 1 && ["meta", "google_ads", "webform", "linkedin_ads"].includes(lead(key).source) ? "form" : "reply",
            confidence: 1,
            answered_at: new Date(base + n * 900_000).toISOString(),
          },
          { onConflict: "lead_id,question_id" },
        ),
        `answer ${key}.${q}`,
      );
    }
  }
}

/* ------------------------------------------------ B. conversations */

const THREADS = {
  harriet: [
    ["out", "Hi Harriet, it's Alex at Blackwellen. Thanks for your enquiry about a new website for Quillfield Analytics. Is it a full rebuild you have in mind, or a refresh of the current site?"],
    ["in", "Full rebuild really. The current site is five years old and doesn't explain the product well."],
    ["out", "That makes sense. Roughly what budget have you set aside, so we can suggest the right scope?"],
    ["in", "Somewhere in the 15 to 30k range."],
    ["out", "Thanks. Would a 30-minute discovery call next week work? I can send a few times."],
    ["in", "Yes please, Tuesday or Wednesday afternoon is best."],
  ],
  daniel: [
    ["out", "Hi Daniel, Alex from Blackwellen here. Thanks for asking about a Shopify build for Brindlecourt. Are you moving from another platform?"],
    ["in", "Yes, from WooCommerce. About 1,200 products."],
    ["out", "Great, that's a migration we do often. I've booked you in for Thursday at 10:00 with Priya, who leads our Shopify work."],
    ["in", "Perfect, see you then."],
  ],
  fiona: [
    ["out", "Hi Fiona, thanks for getting in touch about a new store for Saltmere Outfitters. When were you hoping to launch?"],
    ["in", "Before the spring collection ideally, so as soon as possible."],
    ["out", "Understood. I've sent the proposal over by email. Let me know if anything needs changing."],
    ["in", "Signed and paid the deposit this morning. Looking forward to it!"],
  ],
  oliver: [
    ["out", "Hi Oliver, Alex at Blackwellen here. Thanks for your message about a new site for Wrenhollow Legal. What budget are you working with?"],
    ["in", "Somewhere between 4 and 6k I think, but I'd need to check with the partners."],
  ],
  grace: [
    ["out", "Hi Grace, thanks for requesting a discovery call. What's prompting the website refresh?"],
    ["in", "We've grown into commercial interiors and the site still reads like we only do homes."],
    ["out", "That's a common one. When would you like to start?"],
    ["in", "This quarter if we can."],
  ],
  marcus: [["out", "Hi Marcus, it's Alex from Blackwellen. You asked about a conversion and SEO retainer for Orrinbury Growth. Is there a particular part of the site that isn't performing?"]],
  isla: [
    ["out", "Hi Isla, thanks for your enquiry about a new website for Lindenhythe Health. Is this for the clinics or the group site?"],
    ["in", "The group site first, then the clinic pages. Can you work with our booking system?"],
  ],
  james: [
    ["out", "Hi James, thanks for getting in touch about a Shopify store for Mossgarth Brewing. Are you selling direct to consumers, trade, or both?"],
    ["in", "Both. Trade accounts are the tricky part."],
    ["out", "We can handle trade pricing with Shopify B2B. I've booked a call with Priya for next Monday at 14:00."],
  ],
  tom: [
    ["out", "Hi Tomasz, thanks for requesting a call about a new website for Stravenholt Engineering. When would you like to start?"],
    ["in", "Not sure yet. Can I speak to someone about how you price engineering sites?"],
  ],
  chloe: [
    ["out", "Hi Chloe, great to hear from you via Jess. What would you most like to improve on the Farrowdene site?"],
    ["in", "Quote requests. Lots of traffic, very few enquiries."],
  ],
  sophie: [
    ["out", "Hi Sophie, thanks for your message. Is it the whole site you'd like us to look at, or specific pages?"],
    ["in", "Mainly the services pages. Our budget is around 5 to 15k over the year."],
  ],
  lucy: [["out", "Hi Lucy, Alex at Blackwellen here. Thanks for your enquiry about a new site for Tallowmere Property. Is now a good time to ask a couple of quick questions?"]],
  megan: [
    ["out", "Hi Megan, thanks for your enquiry. What's the main thing you'd like the new website to do?"],
    ["in", "Honestly we've paused this until the new year. Can you get back in touch in January?"],
  ],
  ethan: [
    ["out", "Hi Ethan, thanks for your enquiry. Roughly what budget have you set aside?"],
    ["in", "Under 5k really, we're a small team."],
  ],
};

async function ensureConversations() {
  for (const [key, turns] of Object.entries(THREADS)) {
    const l = lead(key);
    const leadId = ctx.leadIds[key];
    const existing = await first("conversations", { lead_id: leadId });
    if (existing) continue;
    const channel = l.phone ? "sms" : "email";
    const start = Date.parse(ctx.ago(l.days, 2)) + 60_000;
    const at = (i) => new Date(start + i * 47 * 60_000).toISOString();
    const last = turns.length - 1;
    const conversation = await insert("conversations", {
      lead_id: leadId,
      channel,
      state: key === "tom" ? "handover" : l.status === "LOST" || l.status === "WON" ? "closed" : "active",
      owner: key === "tom" ? "HANDED_OVER" : ["daniel", "james", "fiona"].includes(key) ? "HUMAN_ACTIVE" : "AI_ACTIVE",
      subject: channel === "email" ? "Your enquiry with Blackwellen" : null,
      last_message_at: at(last),
      last_inbound_at: turns.some((t) => t[0] === "in") ? at(turns.map((t) => t[0]).lastIndexOf("in")) : null,
      last_outbound_at: at(turns.map((t) => t[0]).lastIndexOf("out")),
      unread_count: turns[last][0] === "in" && ["oliver", "isla", "tom", "sophie", "megan"].includes(key) ? 1 : 0,
      interest: key === "megan" ? "NOT_NOW" : key === "ethan" ? "OBJECTION" : key === "tom" ? "QUESTION" : turns.some((t) => t[0] === "in") ? "INTERESTED" : null,
    });
    for (const [i, [dir, body]] of turns.entries()) {
      const inbound = dir === "in";
      await insert("messages", {
        conversation_id: conversation.id,
        lead_id: leadId,
        direction: inbound ? "inbound" : "outbound",
        channel,
        body,
        subject: channel === "email" && i === 0 ? "Your enquiry with Blackwellen" : null,
        status: inbound ? "RECEIVED" : "DELIVERED",
        provider: null,
        origin: inbound ? "system" : i === 0 ? "automation" : ["daniel", "james", "fiona"].includes(key) ? "manual" : "agent",
        sent_at: inbound ? null : at(i),
        delivered_at: inbound ? null : at(i),
        received_at: inbound ? at(i) : null,
        created_at: at(i),
        message_class: "TRANSACTIONAL",
      });
    }
  }
}

/* ------------------------------------------------ C. deals, bookings, notes */

const DEALS = {
  harriet: { stage: "QUALIFIED", outcome: "OPEN", target: "BOOK", probability: 0.4 },
  daniel: { stage: "MEETING_BOOKED", outcome: "OPEN", target: "PROPOSAL", probability: 0.5 },
  fiona: { stage: "CLOSED", outcome: "WON", target: "PROPOSAL", probability: 1 },
  grace: { stage: "QUALIFIED", outcome: "OPEN", target: "BOOK", probability: 0.35 },
  chloe: { stage: "PROPOSAL", outcome: "OPEN", target: "QUOTE", probability: 0.6 },
  james: { stage: "MEETING_BOOKED", outcome: "OPEN", target: "PROPOSAL", probability: 0.5 },
  sophie: { stage: "PROPOSAL", outcome: "OPEN", target: "QUOTE", probability: 0.55 },
  zara: { stage: "CLOSED", outcome: "WON", target: "QUOTE", probability: 1 },
  ethan: { stage: "CLOSED", outcome: "LOST", target: "BOOK", probability: 0, reason: "Budget below our minimum project size" },
  oliver: { stage: "QUALIFYING", outcome: "OPEN", target: "BOOK", probability: 0.2 },
  isla: { stage: "QUALIFYING", outcome: "OPEN", target: "BOOK", probability: 0.25 },
};

async function ensureDeals() {
  const out = {};
  for (const [key, d] of Object.entries(DEALS)) {
    const l = lead(key);
    const existing = await first("opportunities", { lead_id: ctx.leadIds[key] });
    if (existing) {
      out[key] = existing.id;
      continue;
    }
    const serviceName = { website: "Website design and build", shopify: "Shopify store build", cro: "Conversion and SEO retainer" }[l.service];
    const row = await insert("opportunities", {
      lead_id: ctx.leadIds[key],
      name: `${l.company.replace(/ (Ltd|LLP|Co Ltd)$/, "")}: ${serviceName}`,
      stage: d.stage,
      outcome: d.outcome,
      outcome_reason: d.reason ?? null,
      closed_at: d.outcome === "OPEN" ? null : ctx.ago(Math.max(0, l.days - 6)),
      value: l.value,
      currency: "GBP",
      probability: d.probability,
      close_target: d.target,
      motion: "BOOK_MEETING_B2B",
      expected_close_date: d.outcome === "OPEN" ? ctx.ahead(21).slice(0, 10) : null,
      service_id: ctx.services[l.service],
      goal: "B_BOOK_MEETING",
      qualification_state: l.q,
      interest_source: "LEAD_SERVICE",
      created_by: ctx.users.owner,
      created_at: ctx.ago(l.days, 1),
      stage_changed_at: ctx.ago(Math.max(0, l.days - 1)),
    });
    out[key] = row.id;
  }
  return out;
}

async function ensureBookings() {
  const plan = [
    { key: "daniel", starts: ctx.ahead(2, 10), status: "scheduled", user: "admin", notes: "Shopify migration scoping with Priya." },
    { key: "james", starts: ctx.ahead(4, 14), status: "scheduled", user: "admin", notes: "Trade accounts and B2B pricing walkthrough." },
    { key: "harriet", starts: ctx.ahead(1, 15), status: "pending", user: "owner", notes: "Harriet asked for Tuesday or Wednesday afternoon." },
    { key: "fiona", starts: ctx.ago(15, 0), status: "completed", user: "admin", notes: "Discovery call. Proposal agreed on the call." },
    { key: "zara", starts: ctx.ago(22, 0), status: "completed", user: "owner", notes: null },
    { key: "grace", starts: ctx.ago(1, 3), status: "scheduled", user: "owner", notes: "Discovery call (outcome not recorded yet)." },
  ];
  for (const b of plan) {
    if (await first("bookings", { lead_id: ctx.leadIds[b.key] })) continue;
    const starts = new Date(b.starts);
    await insert("bookings", {
      lead_id: ctx.leadIds[b.key],
      service_id: ctx.services[lead(b.key).service],
      provider: "manual",
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 30 * 60_000).toISOString(),
      location: "Video call",
      assigned_user_id: ctx.users[b.user],
      status: b.status,
      notes: b.notes,
    });
  }
}

async function ensureNotes() {
  const notes = [
    ["harriet", "Keen on a Webflow-style editing experience for the marketing team. Mentioned their CEO wants to see two design routes."],
    ["daniel", "1,200 SKUs on WooCommerce. Needs product data migration and redirects."],
    ["fiona", "Deposit paid. Kick-off booked for the first week of next month."],
    ["oliver", "Budget sits on our review line. Worth a call before ruling it out."],
  ];
  for (const [key, body] of notes) {
    if (await first("lead_notes", { lead_id: ctx.leadIds[key] })) continue;
    await insert("lead_notes", { lead_id: ctx.leadIds[key], body, author_user_id: ctx.users.owner });
  }
}

async function ensureScores() {
  const { scoreLead } = await import("../../src/lib/scoring/service.ts");
  let scored = 0;
  for (const l of ctx.LEADS) {
    if (!ctx.leadIds[l.key]) continue;
    if (await first("lead_scores", { lead_id: ctx.leadIds[l.key], is_current: true })) continue;
    try {
      await scoreLead(ctx.businessId, ctx.leadIds[l.key], "help-demo:seed");
      scored += 1;
    } catch (error) {
      console.warn(`  score ${l.key}: ${error.message}`);
    }
  }
  ctx.bump("scored_leads", scored);
}

/* ------------------------------------------------ run */

export async function seedPart2(context) {
  ctx = context;
  const questionIds = await ensureQualification();
  await ensureAnswers(questionIds);
  await ensureConversations();
  ctx.dealIds = await ensureDeals();
  await ensureBookings();
  await ensureNotes().catch((e) => console.warn(`  notes: ${e.message}`));
  await ensureScores();
  const { seedPart3 } = await import("./help-demo-part3.mjs");
  await seedPart3(ctx, { op, first, insert, ensureRow });
}
