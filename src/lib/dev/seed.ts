import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Builds a realistic UK home-services workspace so every surface can be
 * reviewed with data that behaves like production. Never runs in production and
 * only ever touches the workspace it is given.
 */

const FIRST_NAMES = [
  "Sarah", "James", "Priya", "Daniel", "Chloe", "Mohammed", "Emma", "Liam",
  "Grace", "Oliver", "Aisha", "Thomas", "Megan", "Ryan", "Sophie", "Callum",
  "Hannah", "George", "Leah", "Nathan", "Ruth", "Owen", "Isla", "Marcus",
];

const LAST_NAMES = [
  "Morgan", "Whitfield", "Patel", "Okafor", "Bennett", "Hughes", "Doyle",
  "Fletcher", "Reid", "Marsh", "Chowdhury", "Ellis", "Sinclair", "Bright",
  "Nolan", "Hargreaves", "Adeyemi", "Kerr", "Wallace", "Quinn",
];

const POSTCODES = [
  "BH14 9XY", "SO15 2AB", "PO6 3TD", "BH12 1QR", "SO40 8GH", "PO16 7RL",
  "BH23 4NN", "SO18 5PT", "BH8 8EF", "SO53 2GA", "PO9 1LD", "BH15 2BU",
];

const SERVICES = [
  { name: "Roof replacement", average_value: 6800, position: 0 },
  { name: "Roof repair", average_value: 950, position: 1 },
  { name: "Flat roof / GRP", average_value: 3200, position: 2 },
  { name: "Guttering & fascias", average_value: 1400, position: 3 },
  { name: "Chimney works", average_value: 1750, position: 4 },
];

const SOURCES = [
  {
    provider: "meta",
    page_name: "Southcoast Roofing",
    form_name: "Free roof survey — Sept",
    campaign_id: "23851234567890111",
    campaign_name: "Roof Replacement — Dorset",
    adset_name: "Homeowners 35-65",
    ad_name: "Storm damage — video",
    source_name: "Meta Lead Ads",
  },
  {
    provider: "meta",
    page_name: "Southcoast Roofing",
    form_name: "Roof repair enquiry",
    campaign_id: "23851234567890222",
    campaign_name: "Repairs — Hampshire",
    adset_name: "Retargeting — site visitors",
    ad_name: "Before & after carousel",
    source_name: "Meta Lead Ads",
  },
  {
    provider: "meta",
    page_name: "Southcoast Roofing",
    form_name: "Gutter clean & check",
    campaign_id: "23851234567890333",
    campaign_name: "Guttering — Autumn",
    adset_name: "Broad — 40+",
    ad_name: "Autumn gutter reel",
    source_name: "Meta Lead Ads",
  },
];

const QUESTIONS = [
  {
    question_text: "Are you the homeowner?",
    response_type: "yes_no",
    required: true,
    position: 0,
  },
  {
    question_text: "What is the property postcode?",
    response_type: "postcode",
    required: true,
    position: 1,
  },
  {
    question_text: "How soon do you need the work done?",
    response_type: "timing",
    required: true,
    position: 2,
  },
  {
    question_text: "Roughly what budget do you have in mind?",
    response_type: "single_choice",
    required: false,
    position: 3,
  },
];

const TIMING_ANSWERS = [
  "As soon as possible",
  "Within 30 days",
  "In the next 3 months",
  "Just researching",
];

const BUDGET_ANSWERS = ["Under £2,000", "£2,000–£5,000", "£5,000–£10,000", "Over £10,000"];

/** Deterministic PRNG so a reseed produces the same reviewable workspace. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

type StatusPlan = {
  status: string;
  qualification_state: string;
  contacted: boolean;
  replied: boolean;
  qualified: boolean;
  booked: boolean;
  won: boolean;
  lost: boolean;
  count: number;
};

const PLAN: StatusPlan[] = [
  { status: "NEW", qualification_state: "PENDING", contacted: false, replied: false, qualified: false, booked: false, won: false, lost: false, count: 5 },
  { status: "CONTACTED", qualification_state: "PENDING", contacted: true, replied: false, qualified: false, booked: false, won: false, lost: false, count: 7 },
  { status: "RESPONDED", qualification_state: "PENDING", contacted: true, replied: true, qualified: false, booked: false, won: false, lost: false, count: 6 },
  { status: "QUALIFIED", qualification_state: "QUALIFIED", contacted: true, replied: true, qualified: true, booked: false, won: false, lost: false, count: 6 },
  { status: "BOOKED", qualification_state: "QUALIFIED", contacted: true, replied: true, qualified: true, booked: true, won: false, lost: false, count: 6 },
  { status: "WON", qualification_state: "QUALIFIED", contacted: true, replied: true, qualified: true, booked: true, won: true, lost: false, count: 5 },
  { status: "LOST", qualification_state: "NOT_QUALIFIED", contacted: true, replied: true, qualified: false, booked: false, won: false, lost: true, count: 5 },
];

const OPENERS = [
  (name: string, service: string) =>
    `Hi ${name}, thanks for your enquiry about ${service.toLowerCase()} — this is Dave at Southcoast Roofing. Are you the homeowner?`,
  (name: string, service: string) =>
    `Hello ${name}, Dave here from Southcoast Roofing about your ${service.toLowerCase()} enquiry. Quick question first — are you the homeowner?`,
];

const REPLIES = [
  "Yes that's right, it's my house.",
  "Yes I am. Roof started leaking after the storm last week.",
  "Yep homeowner. Looking to get it sorted fairly soon.",
  "Yes. Can you give me a rough idea on price?",
];

export type SeedResult = {
  services: number;
  sources: number;
  questions: number;
  leads: number;
  messages: number;
  bookings: number;
};

export async function seedWorkspace(
  businessId: string,
  options: { reset?: boolean } = {},
): Promise<SeedResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seeding is disabled in production.");
  }

  const admin = createAdminClient();
  const random = makeRandom(20260905);
  const now = Date.now();

  if (options.reset) {
    // Messages, answers and bookings cascade from leads.
    await admin.from("leads").delete().eq("business_id", businessId);
    await admin.from("lead_sources").delete().eq("business_id", businessId);
    await admin.from("qualification_questions").delete().eq("business_id", businessId);
    await admin.from("services").delete().eq("business_id", businessId);
  }

  const { data: services, error: serviceError } = await admin
    .from("services")
    .insert(SERVICES.map((service) => ({ ...service, business_id: businessId })))
    .select("id, name, average_value");
  if (serviceError) throw serviceError;

  const { data: sources, error: sourceError } = await admin
    .from("lead_sources")
    .insert(SOURCES.map((source) => ({ ...source, business_id: businessId })))
    .select("id");
  if (sourceError) throw sourceError;

  const { data: questions, error: questionError } = await admin
    .from("qualification_questions")
    .insert(QUESTIONS.map((question) => ({ ...question, business_id: businessId })))
    .select("id, position");
  if (questionError) throw questionError;

  const questionByPosition = new Map(
    (questions ?? []).map((question) => [question.position, question.id]),
  );

  let messageCount = 0;
  let bookingCount = 0;
  let leadCount = 0;
  let nameIndex = 0;

  for (const plan of PLAN) {
    for (let i = 0; i < plan.count; i++) {
      const first = FIRST_NAMES[nameIndex % FIRST_NAMES.length];
      const last = LAST_NAMES[(nameIndex * 7) % LAST_NAMES.length];
      nameIndex++;

      const service = services![Math.floor(random() * services!.length)];
      const source = sources![Math.floor(random() * sources!.length)];
      const postcode = POSTCODES[Math.floor(random() * POSTCODES.length)];

      // Spread across the last 60 days so range filters and deltas are meaningful.
      const ageDays = random() * 60;
      const createdAt = new Date(now - ageDays * 864e5);
      const phone = `+4477${String(Math.floor(random() * 90000000) + 10000000)}`;

      const contactedAt = plan.contacted
        ? new Date(createdAt.getTime() + (20 + random() * 100) * 1000)
        : null;
      const repliedAt = plan.replied
        ? new Date(contactedAt!.getTime() + (2 + random() * 40) * 6e4)
        : null;
      const qualifiedAt = plan.qualified
        ? new Date(repliedAt!.getTime() + (5 + random() * 30) * 6e4)
        : null;
      const bookedAt = plan.booked
        ? new Date(qualifiedAt!.getTime() + (10 + random() * 120) * 6e4)
        : null;
      const wonAt = plan.won ? new Date(bookedAt!.getTime() + 5 * 864e5) : null;
      const lostAt = plan.lost ? new Date(repliedAt!.getTime() + 2 * 864e5) : null;

      const needsAttention = plan.status === "RESPONDED" && i === 0;

      const { data: lead, error: leadError } = await admin
        .from("leads")
        .insert({
          business_id: businessId,
          external_id: `seed-${plan.status}-${i}`,
          first_name: first,
          last_name: last,
          phone,
          phone_normalized: phone,
          email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
          postcode,
          service_id: service.id,
          source_id: source.id,
          status: plan.status,
          qualification_state: plan.qualification_state,
          needs_attention: needsAttention,
          attention_reason: needsAttention ? "human_requested" : null,
          human_takeover: needsAttention,
          automation_active: !needsAttention && !plan.lost,
          opted_out: plan.lost && i === 0,
          created_at: createdAt.toISOString(),
          first_contacted_at: contactedAt?.toISOString() ?? null,
          first_replied_at: repliedAt?.toISOString() ?? null,
          qualified_at: qualifiedAt?.toISOString() ?? null,
          booked_at: bookedAt?.toISOString() ?? null,
          won_at: wonAt?.toISOString() ?? null,
          lost_at: lostAt?.toISOString() ?? null,
          last_contact_at: (
            repliedAt ??
            contactedAt ??
            createdAt
          ).toISOString(),
        })
        .select("id")
        .single();
      if (leadError) throw leadError;
      leadCount++;

      if (!plan.contacted) continue;

      const { data: conversation, error: conversationError } = await admin
        .from("conversations")
        .insert({
          business_id: businessId,
          lead_id: lead.id,
          channel: "sms",
          state: plan.lost ? "closed" : "active",
          last_message_at: (repliedAt ?? contactedAt!).toISOString(),
          last_outbound_at: contactedAt!.toISOString(),
          last_inbound_at: repliedAt?.toISOString() ?? null,
        })
        .select("id")
        .single();
      if (conversationError) throw conversationError;

      const thread: {
        direction: "outbound" | "inbound";
        body: string;
        at: Date;
        status: string;
        origin: string;
      }[] = [
        {
          direction: "outbound",
          body: OPENERS[Math.floor(random() * OPENERS.length)](first, service.name),
          at: contactedAt!,
          status: "DELIVERED",
          origin: "automation",
        },
      ];

      if (plan.replied) {
        thread.push({
          direction: "inbound",
          body: REPLIES[Math.floor(random() * REPLIES.length)],
          at: repliedAt!,
          status: "RECEIVED",
          origin: "automation",
        });
        thread.push({
          direction: "outbound",
          body: "Great, thanks. How soon are you looking to get the work done?",
          at: new Date(repliedAt!.getTime() + 3e4),
          status: "DELIVERED",
          origin: "automation",
        });
        thread.push({
          direction: "inbound",
          body: TIMING_ANSWERS[Math.floor(random() * 2)],
          at: new Date(repliedAt!.getTime() + 6e5),
          status: "RECEIVED",
          origin: "automation",
        });
      }

      if (plan.booked) {
        thread.push({
          direction: "outbound",
          body: "Perfect — you can pick a survey slot that suits you here: https://calendly.com/southcoast-roofing/survey",
          at: qualifiedAt!,
          status: "DELIVERED",
          origin: "automation",
        });
      }

      if (plan.status === "CONTACTED") {
        thread.push({
          direction: "outbound",
          body: "Just following up on your roofing enquiry — are you still looking to get this sorted?",
          at: new Date(contactedAt!.getTime() + 864e5),
          status: i === 1 ? "FAILED" : "DELIVERED",
          origin: "automation",
        });
      }

      const { error: messageError } = await admin.from("messages").insert(
        thread.map((entry) => ({
          business_id: businessId,
          conversation_id: conversation.id,
          lead_id: lead.id,
          direction: entry.direction,
          channel: "sms",
          body: entry.body,
          status: entry.status,
          origin: entry.origin,
          provider: "twilio",
          error_message:
            entry.status === "FAILED"
              ? "Carrier rejected the message (unreachable handset)."
              : null,
          created_at: entry.at.toISOString(),
          sent_at: entry.direction === "outbound" ? entry.at.toISOString() : null,
          delivered_at:
            entry.status === "DELIVERED" ? entry.at.toISOString() : null,
          failed_at: entry.status === "FAILED" ? entry.at.toISOString() : null,
          received_at:
            entry.direction === "inbound" ? entry.at.toISOString() : null,
        })),
      );
      if (messageError) throw messageError;
      messageCount += thread.length;

      if (plan.replied) {
        const answers = [
          {
            question_id: questionByPosition.get(0)!,
            answer_text: "Yes",
            answer_value: "true",
            evaluation: "meets",
          },
          {
            question_id: questionByPosition.get(1)!,
            answer_text: postcode,
            answer_value: postcode,
            evaluation: "meets",
          },
          {
            question_id: questionByPosition.get(2)!,
            answer_text: plan.qualified
              ? TIMING_ANSWERS[Math.floor(random() * 2)]
              : TIMING_ANSWERS[3],
            answer_value: plan.qualified ? "asap" : "researching",
            evaluation: plan.qualified ? "meets" : "does_not_meet",
          },
          {
            question_id: questionByPosition.get(3)!,
            answer_text: BUDGET_ANSWERS[Math.floor(random() * BUDGET_ANSWERS.length)],
            answer_value: "band",
            evaluation: plan.qualified ? "meets" : "review",
          },
        ];

        const { error: answerError } = await admin.from("qualification_answers").insert(
          answers.map((answer) => ({
            ...answer,
            business_id: businessId,
            lead_id: lead.id,
            answered_at: repliedAt!.toISOString(),
          })),
        );
        if (answerError) throw answerError;
      }

      if (plan.booked) {
        const startsAt = new Date(bookedAt!.getTime() + 3 * 864e5);
        const { error: bookingError } = await admin.from("bookings").insert({
          business_id: businessId,
          lead_id: lead.id,
          service_id: service.id,
          provider: "calendly",
          // The unique index on (provider, external_event_id) is global, so the
          // workspace must be part of the id or a second seed collides.
          external_event_id: `evt_seed_${businessId.slice(0, 8)}_${plan.status}_${i}`,
          booking_url: "https://calendly.com/southcoast-roofing/survey",
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + 45 * 6e4).toISOString(),
          location: `${postcode} — customer address`,
          status: plan.won ? "completed" : "scheduled",
          created_at: bookedAt!.toISOString(),
        });
        if (bookingError) throw bookingError;
        bookingCount++;
      }
    }
  }

  return {
    services: services!.length,
    sources: sources!.length,
    questions: questions!.length,
    leads: leadCount,
    messages: messageCount,
    bookings: bookingCount,
  };
}
