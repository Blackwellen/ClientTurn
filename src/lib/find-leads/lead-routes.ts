/**
 * The six routes a lead can reach ClientTurn by.
 *
 * Pure — no `server-only`, no Supabase — so the same definitions drive the
 * Discover UI, the connection checklist and the docs.
 *
 * This file exists because the routes are genuinely different and blurring them
 * causes real damage. The two distinctions that matter most:
 *
 *   **Where the record lands.** A lead-form submission is a warm, inbound
 *   enquiry from someone who asked to hear from you — that is a **Lead**, and
 *   it goes straight into the conversion engine. Everything else produces a
 *   **Prospect**: someone we found, who has not asked for anything, and who
 *   nobody may contact until a person approves it. Putting sourced prospects
 *   into Leads would make the whole Prospect/Lead boundary meaningless.
 *
 *   **What the platform actually permits.** Social routes have a gate the
 *   platform enforces — you connect or follow first, and only once that is
 *   accepted can you message. Modelling that as an ordinary send delay produces
 *   a product that reports messages as delivered which nobody can receive.
 */

export const LEAD_ROUTES = [
  "linkedin_social",
  "facebook_social",
  "instagram_social",
  "tiktok_social",
  "public_sources",
  "lead_forms",
] as const;

export type LeadRouteKey = (typeof LEAD_ROUTES)[number];

/** Where records from a route end up, and therefore which rules apply. */
export type RouteDestination = "PROSPECTS" | "LEADS";

export type RouteStage = {
  key: string;
  label: string;
  /** What actually happens. Written for a customer, not for an engineer. */
  detail: string;
  /**
   * True when the step is out of the business's hands — a platform gate or the
   * recipient's decision. These are why a social campaign cannot be scheduled
   * like an email one.
   */
  waitsOnRecipient?: boolean;
};

export type LeadRoute = {
  key: LeadRouteKey;
  name: string;
  destination: RouteDestination;
  /** One sentence: what this route is for. */
  summary: string;
  /** Integrations that must be connected before it can run at all. */
  requires: string[];
  /** The channel outreach happens on once a record exists. */
  outreachChannel: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "EMAIL" | "INBOUND";
  stages: RouteStage[];
  /**
   * The honest limitation. Every route has one, and stating it is what stops a
   * customer planning around capability the route does not have.
   */
  limitation: string;
};

/**
 * The connect-then-message flow, in full.
 *
 * Written out rather than abbreviated because the stages that get skipped in a
 * simplified version are exactly the ones that cause damage: resolving the
 * right profile, warming the account, and withdrawing stale invites. A campaign
 * built on the six-stage cartoon version gets the customer's account
 * restricted within a fortnight.
 */
const CONNECT_THEN_MESSAGE = (
  platform: string,
  gate: string,
  gateDetail: string,
): RouteStage[] => [
  {
    key: "source",
    label: "Find the person",
    detail: `Their ${platform} profile is identified from your own audience, an export you supply, or a licensed provider that holds the profile URL.`,
  },
  {
    key: "resolve",
    label: "Confirm it is the right person",
    detail:
      "The profile is matched against the company and role on the prospect before anything is sent. A near-match is sent for review rather than contacted — a connection request to the wrong person is spent and cannot be taken back.",
  },
  {
    key: "eligibility",
    label: "Check contactability",
    detail:
      "Suppression, opt-outs and consent are checked. A suppressed prospect is suppressed on every channel; social is never a route around an opt-out.",
  },
  {
    key: "account_health",
    label: "Check the sending account",
    detail: `The ${platform} account must be active, not restricted, and inside its daily and weekly limits. A new or cold account is warmed up gradually rather than starting at full volume, because a burst is what triggers a platform restriction.`,
  },
  {
    key: "approve",
    label: "Approve for outreach",
    detail:
      "A person reviews the prospect and approves it. Nothing is sent before this, on any channel.",
  },
  {
    key: "connect",
    label: gate,
    detail: gateDetail,
  },
  {
    key: "accepted",
    label: "They accept",
    detail:
      "Nothing further can happen until they do. This wait is the platform's gate, not a delay we chose, so it has no timer attached.",
    waitsOnRecipient: true,
  },
  {
    key: "withdraw",
    label: "Withdraw if ignored",
    detail:
      "A pending invite keeps counting against your limit for as long as it sits there. Ones that go unanswered are withdrawn after a set period to free that capacity, and the person is not invited again — repeatedly re-inviting someone who ignored you is what gets an account restricted.",
  },
  {
    key: "enrich_on_connect",
    label: "Read their contact details",
    detail:
      "Once connected, the details they have chosen to share on their own profile become visible and can be saved against the prospect, with the source recorded. This is the only point at which a real contact detail comes from the platform itself.",
  },
  {
    key: "message",
    label: "Message them",
    detail:
      "Now the message will actually arrive. Suppression, quiet hours and the account's daily message cap are re-checked immediately before it goes.",
  },
  {
    key: "follow_up",
    label: "Follow up, briefly",
    detail:
      "At most two further messages, spaced out, and only while they have not replied. The sequence stops the moment they do — or the moment they ask you to.",
  },
  {
    key: "reply",
    label: "They reply",
    detail:
      "The reply attaches to the prospect and is classified: interested, a question, an objection, not now, wrong person, or an opt-out.",
    waitsOnRecipient: true,
  },
  {
    key: "promote",
    label: "Promote to a Lead",
    detail:
      "A positive reply makes the prospect eligible. Promotion stays a human decision, and the whole conversation travels with it — the Lead opens on the same thread, with nothing duplicated and nothing lost.",
  },
];

export const ROUTES: Record<LeadRouteKey, LeadRoute> = {
  /* ------------------------------------------------------------ 1. LinkedIn */
  linkedin_social: {
    key: "linkedin_social",
    name: "LinkedIn",
    destination: "PROSPECTS",
    summary:
      "Reach decision makers on LinkedIn by connecting first, then messaging once they accept.",
    requires: ["A LinkedIn account connected as a sending account"],
    outreachChannel: "LINKEDIN",
    stages: CONNECT_THEN_MESSAGE(
      "LinkedIn",
      "Send a connection request",
      "Sent from your connected LinkedIn account, within its weekly invitation limit. A personalised note roughly doubles acceptance, so one is attached when the account still has notes left this month — and the invite is sent without one rather than held back when it does not.",
    ),
    limitation:
      "You cannot message a stranger on LinkedIn — the connection request is the only way in, and free accounts get very few personalised invitation notes each month. Invitations without a note still work and are not capped as tightly. LinkedIn never returns an email address through any API; an address comes from a licensed provider matched on the profile URL, or from the person's own contact info once they are a first-degree connection.",
  },

  /* ------------------------------------------------------------ 2. Facebook */
  facebook_social: {
    key: "facebook_social",
    name: "Facebook",
    destination: "PROSPECTS",
    summary:
      "Work the people who message or comment on your Page, and follow others so a message reaches them.",
    requires: ["A Facebook Page connected with messaging permissions"],
    outreachChannel: "FACEBOOK",
    stages: CONNECT_THEN_MESSAGE(
      "Facebook",
      "Follow the person or Page",
      "Following first is what gets a later message into their inbox rather than their Message Requests folder, where most people never look.",
    ),
    limitation:
      "A message to somebody who does not follow your Page lands in their Message Requests folder, which most people never open. Following first, and being followed back, is what makes it arrive. Meta returns no email or phone for a person who engaged — only a page-scoped id and a display name.",
  },

  /* ----------------------------------------------------------- 3. Instagram */
  instagram_social: {
    key: "instagram_social",
    name: "Instagram",
    destination: "PROSPECTS",
    summary:
      "Turn people who comment on or mention your account into prospects, and reach new ones by following first.",
    requires: ["An Instagram professional account linked to your Facebook Page"],
    outreachChannel: "INSTAGRAM",
    stages: CONNECT_THEN_MESSAGE(
      "Instagram",
      "Follow the account",
      "Paced deliberately slowly. Instagram action-blocks accounts that follow in bursts, and a block costs days of every campaign rather than one prospect.",
    ),
    limitation:
      "Same Message Requests problem as Facebook, and Instagram throttles follows harder — a burst gets the account action-blocked for days. Instagram exposes a username, not a name, and no contact details at all.",
  },

  /* -------------------------------------------------------------- 4. TikTok */
  tiktok_social: {
    key: "tiktok_social",
    name: "TikTok",
    destination: "PROSPECTS",
    summary:
      "Follow business accounts and message them once they follow back or reply.",
    requires: ["A TikTok Business account connected"],
    outreachChannel: "TIKTOK",
    stages: CONNECT_THEN_MESSAGE(
      "TikTok",
      "Follow the account",
      "TikTok only permits a direct message once the account follows you back, so the follow is a hard prerequisite rather than a courtesy.",
    ),
    limitation:
      "TikTok's direct messaging is the most restricted of the four: messages are limited to accounts that follow you back, and business messaging is only available in some regions. Coverage also skews consumer — it will find a firm marketing to homeowners far more reliably than a commercial property manager.",
  },

  /* ------------------------------------------------- 5. Public web sources */
  public_sources: {
    key: "public_sources",
    name: "Public sources",
    destination: "PROSPECTS",
    summary:
      "Find businesses from maps, registries, tenders, planning data, news and advertiser libraries, then reach them by email.",
    requires: ["At least one sourcing provider configured"],
    outreachChannel: "EMAIL",
    stages: [
      {
        key: "search",
        label: "Find companies",
        detail:
          "Google Places for geography, official registers, tender and planning feeds, licensed news, and the Meta and TikTok advertiser libraries — which show who is currently paying for reach, and therefore has budget.",
      },
      {
        key: "resolve_domain",
        label: "Resolve the company",
        detail:
          "Several sources return a trading name with no website. The domain is resolved before anything is spent on the record, because an unresolved company cannot be deduplicated and cannot have a contact found for it.",
      },
      {
        key: "dedupe",
        label: "Remove who you already know",
        detail:
          "Matched against your existing leads, customers and suppression list. Cold-emailing an existing customer is worse than not finding them at all, and paying to enrich a duplicate is money spent twice.",
      },
      {
        key: "prefilter",
        label: "Filter before spending",
        detail:
          "A cheap first pass drops obvious misfits before any paid enrichment runs. This is what keeps a run inside its budget rather than enriching everything it found.",
      },
      {
        key: "enrich",
        label: "Find the decision maker",
        detail:
          "A licensed provider finds the right person and their work email. Personal addresses are not sought — this is business contact only.",
      },
      {
        key: "verify",
        label: "Verify the address",
        detail:
          "Checked with a verification provider before it is ever used. An unverified address that hard-bounces damages the domain every later campaign sends from, so this is not optional.",
      },
      {
        key: "score",
        label: "Score against your profile",
        detail:
          "A deterministic 0-100 score across six weighted factors, each with its evidence. The number is arithmetic, not a model's opinion, and the breakdown is on the prospect.",
      },
      {
        key: "approve",
        label: "Approve for outreach",
        detail:
          "A person reviews and approves. Contactability is confirmed here — being findable is not the same as being contactable.",
      },
      {
        key: "sender_health",
        label: "Check the sending domain",
        detail:
          "SPF, DKIM and DMARC must pass, the mailbox must be inside its daily cap, and bounce and complaint rates must be under threshold. A new domain is warmed up rather than started at volume.",
      },
      {
        key: "email",
        label: "Email them",
        detail:
          "A permitted cold sequence with an unsubscribe link and a postal address. Suppression, quiet hours and caps are re-checked immediately before every single send.",
      },
      {
        key: "bounce",
        label: "Handle what comes back",
        detail:
          "A hard bounce suppresses the address immediately and stops the sequence. A complaint suppresses it permanently and is never reversible from the product.",
      },
      {
        key: "follow_up",
        label: "Follow up, briefly",
        detail:
          "At most two further emails, and the sequence stops the moment they reply or opt out.",
      },
      {
        key: "reply",
        label: "They reply",
        detail:
          "The reply attaches to the prospect and is classified. An unsubscribe request suppresses them globally, whatever it is worded like.",
        waitsOnRecipient: true,
      },
      {
        key: "promote",
        label: "Promote to a Lead",
        detail:
          "A positive reply makes the prospect eligible. The conversation and all its provenance travel with it.",
      },
    ],
    limitation:
      "Everything here is a licensed feed, an official register, a public page fetched respecting robots.txt, or data you supplied. There is no general web scraper, and there never will be — a source whose terms do not permit the use cannot have its provenance recorded, and unprovenanced data is what makes a campaign indefensible.",
  },

  /* -------------------------------------------------------- 6. Lead forms */
  lead_forms: {
    key: "lead_forms",
    name: "Lead forms",
    destination: "LEADS",
    summary:
      "Instant delivery of people who filled in your lead form on Meta, LinkedIn or TikTok.",
    requires: ["The relevant ad account connected"],
    outreachChannel: "INBOUND",
    stages: [
      {
        key: "submit",
        label: "They submit the form",
        detail:
          "On Facebook, Instagram, LinkedIn or TikTok. They gave you their details and asked to be contacted.",
      },
      {
        key: "deliver",
        label: "Delivered within seconds",
        detail:
          "A webhook or a short poll brings the submission in. Speed is the entire advantage of this route — a reply inside five minutes converts several times better than one an hour later.",
      },
      {
        key: "consent",
        label: "Record what they agreed to",
        detail:
          "The consent wording shown on the form, and when they accepted it, are stored with the lead. This is what makes contacting them defensible later, and it cannot be reconstructed after the fact.",
      },
      {
        key: "dedupe",
        label: "Match to anyone you already know",
        detail:
          "Deduplicated on the platform's own lead id so a webhook retry never creates a second record, and matched against existing leads so a repeat enquiry continues the same conversation rather than starting a rival one.",
      },
      {
        key: "attribute",
        label: "Attribute it",
        detail:
          "The ad, ad set and campaign are recorded against the lead, so spend can later be measured against bookings rather than against form fills.",
      },
      {
        key: "lead",
        label: "Created as a Lead",
        detail:
          "Not a Prospect. This person asked to hear from you, so they go straight into the conversion engine — no approval step, because they already gave permission.",
      },
      {
        key: "respond",
        label: "Respond immediately",
        detail:
          "The first follow-up goes out at once, on the channel they gave you, subject to quiet hours and their consent.",
      },
      {
        key: "qualify",
        label: "Qualify",
        detail:
          "The deterministic qualification engine works them through your configured questions. Anything it cannot answer confidently goes to a person rather than being guessed.",
      },
      {
        key: "book",
        label: "Book the job",
        detail:
          "A booking link or a handover to a person, against the conversion goal set for the campaign.",
      },
    ],
    limitation:
      "This is the only route that produces Leads rather than Prospects, and the only one where instant follow-up is appropriate — the speed advantage exists precisely because they just asked. It depends entirely on you running ads with a form attached; it finds nobody on its own.",
  },
};

export function routesTo(destination: RouteDestination): LeadRoute[] {
  return LEAD_ROUTES.map((key) => ROUTES[key]).filter(
    (route) => route.destination === destination,
  );
}

/** The social routes, which all share the connect-then-message gate. */
export function socialRoutes(): LeadRoute[] {
  return LEAD_ROUTES.map((key) => ROUTES[key]).filter(
    (route) =>
      route.outreachChannel !== "EMAIL" && route.outreachChannel !== "INBOUND",
  );
}
