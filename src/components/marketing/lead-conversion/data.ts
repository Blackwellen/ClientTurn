/**
 * Sample content for the Lead Conversion product demos.
 *
 * Everything here is invented so the interfaces read as interfaces — names,
 * postcodes, counts and percentages. None of it is customer data and none of
 * it is presented as a result ClientTurn has produced for anyone. It lives in
 * one module so the hero dashboard and the capture panel cannot drift into
 * showing the same person two different ways, which is the fastest way to make
 * a product screenshot look fake.
 */

export type Tone =
  | "new"
  | "followup"
  | "qualified"
  | "booked"
  | "sent"
  | "scheduled"
  | "eligible"
  | "suppressed"
  | "unsubscribed";

export type Lead = {
  initials: string;
  name: string;
  email: string;
  source: string;
  status: string;
  tone: Tone;
  activity: string;
  activityDetail: string;
  /** Avatar fill / text, chosen per person so rows stay distinguishable. */
  avatar: [string, string];
};

export const LEADS: Lead[] = [
  {
    initials: "JC",
    name: "James Carter",
    email: "james@carterbuild.co.uk",
    source: "Website",
    status: "New",
    tone: "new",
    activity: "2 minutes ago",
    activityDetail: "Form submission",
    avatar: ["#dbe6f5", "#2d4a75"],
  },
  {
    initials: "SW",
    name: "Sophie Williams",
    email: "sophie@gmail.com",
    source: "Facebook Ads",
    status: "In follow-up",
    tone: "followup",
    activity: "12 minutes ago",
    activityDetail: "Replied to email",
    avatar: ["#e6dcf7", "#553d86"],
  },
  {
    initials: "DB",
    name: "Daniel Brooks",
    email: "daniel@brookshomes.co.uk",
    source: "Google Ads",
    status: "Qualified",
    tone: "qualified",
    activity: "1 hour ago",
    activityDetail: "Answered questions",
    avatar: ["#d6f0de", "#1f5c39"],
  },
  {
    initials: "EC",
    name: "Emily Clarke",
    email: "emily.clarke@hotmail.com",
    source: "Website",
    status: "New",
    tone: "new",
    activity: "2 hours ago",
    activityDetail: "Form submission",
    avatar: ["#fbe6cf", "#8a5410"],
  },
  {
    initials: "MR",
    name: "Michael Reed",
    email: "michael@reedproperty.co.uk",
    source: "Instagram",
    status: "In follow-up",
    tone: "followup",
    activity: "3 hours ago",
    activityDetail: "Replied to SMS",
    avatar: ["#fadcd6", "#8c3a26"],
  },
];

export const LEAD_TABS = [
  { label: "All Leads", count: "124", active: true },
  { label: "New", count: "18", active: false },
  { label: "In Follow-up", count: "36", active: false },
  { label: "Qualified", count: "28", active: false },
  { label: "Booked", count: "12", active: false },
] as const;

/** The lead expanded under the capture table. */
export const SELECTED_LEAD = {
  initials: "DB",
  name: "Daniel Brooks",
  email: "daniel@brookshomes.co.uk",
  phone: "07812 345 678",
  avatar: ["#d6f0de", "#1f5c39"] as [string, string],
  facts: [
    { label: "Source", value: "Google Ads" },
    { label: "Enquiry type", value: "New build" },
    { label: "Location", value: "Bournemouth, UK" },
    { label: "Budget", value: "£50k – £100k" },
  ],
};

export type SequenceStep = {
  channel: "email" | "sms" | "whatsapp";
  title: string;
  preview: string;
  when: string;
  time?: string;
};

export const SEQUENCE: SequenceStep[] = [
  {
    channel: "email",
    title: "Email — Initial response",
    preview: "Thanks for your enquiry",
    when: "Send immediately",
  },
  {
    channel: "sms",
    title: "SMS — Friendly follow-up",
    preview: "Just checking you received this",
    when: "Send in 2 days",
    time: "(9:00 AM)",
  },
  {
    channel: "whatsapp",
    title: "WhatsApp — Additional info",
    preview: "Share brochure and next steps",
    when: "Send in 5 days",
    time: "(10:00 AM)",
  },
  {
    channel: "email",
    title: "Email — Final follow-up",
    preview: "Should we keep this open?",
    when: "Send in 10 days",
    time: "(9:00 AM)",
  },
];

export const QUESTIONS = [
  { label: "What type of project is this?", type: "Single select" },
  { label: "What is your budget?", type: "Single select" },
  { label: "When are you looking to start?", type: "Single select" },
  { label: "Property location", type: "Text input" },
  { label: "Any additional information?", type: "Long text" },
] as const;

export const SAMPLE_RESPONSE = [
  { label: "Project type", value: "New build" },
  { label: "Budget", value: "£50k - £100k" },
  { label: "Timescale", value: "Within 3 months" },
  { label: "Location", value: "Bournemouth, UK" },
] as const;

export const ROUTING = [
  { from: "Qualified", tone: "qualified", to: "Send to Sales + create booking task" },
  { from: "Needs Review", tone: "review", to: "Assign to team member" },
  { from: "Not a Fit", tone: "no", to: "Send nurture sequence" },
] as const;

export type ReactivationRow = {
  initials: string;
  name: string;
  last: string;
  status: string;
  tone: Tone;
  /** Suppressed and unsubscribed rows cannot be added to a campaign. */
  actionable: boolean;
  avatar: [string, string];
};

export const REACTIVATION: ReactivationRow[] = [
  { initials: "SM", name: "Sarah Mitchell", last: "6 months ago", status: "Eligible", tone: "eligible", actionable: true, avatar: ["#dbe6f5", "#2d4a75"] },
  { initials: "TR", name: "Tom Richards", last: "8 months ago", status: "Suppressed", tone: "suppressed", actionable: false, avatar: ["#e2e6ec", "#4a5568"] },
  { initials: "LA", name: "Lucy Adams", last: "5 months ago", status: "Eligible", tone: "eligible", actionable: true, avatar: ["#e6dcf7", "#553d86"] },
  { initials: "MW", name: "Mark Wilson", last: "11 months ago", status: "Eligible", tone: "eligible", actionable: true, avatar: ["#d6f0de", "#1f5c39"] },
  { initials: "DE", name: "Daniel Evans", last: "9 months ago", status: "Unsubscribed", tone: "unsubscribed", actionable: false, avatar: ["#fadcd6", "#8c3a26"] },
  { initials: "EC", name: "Emma Clarke", last: "7 months ago", status: "Eligible", tone: "eligible", actionable: true, avatar: ["#fbe6cf", "#8a5410"] },
];

/**
 * Reactivation counters. 532 eligible − 218 suppressed = 314 ready to contact,
 * so the numbers on screen actually add up when someone checks them.
 */
export const REACTIVATION_COUNTS = [
  { value: "532", label: "Eligible", chevron: true },
  { value: "218", label: "Suppressed", chevron: false },
  { value: "0", label: "Unsubscribed", chevron: false },
  { value: "314", label: "Ready to contact", chevron: true },
] as const;

/**
 * The conversion funnel. Each percentage is the stage divided by new leads, so
 * the bar heights, the counts and the ratios all describe the same set.
 */
export const FUNNEL = [
  { value: 1248, label: "New leads", pct: 100, colour: "#2f7df7" },
  { value: 892, label: "Contacted", pct: 71, colour: "#38a3f0" },
  { value: 604, label: "Replied", pct: 48, colour: "#8b7bf0" },
  { value: 428, label: "Qualified", pct: 34, colour: "#63c96b" },
  { value: 312, label: "Booked", pct: 25, colour: "#b7f34a" },
  { value: 186, label: "Won", pct: 15, colour: "#4ec97e" },
] as const;

export const LEAD_SOURCES = [
  { label: "Website", pct: 38, colour: "#2f7df7" },
  { label: "Facebook Ads", pct: 24, colour: "#38a3f0" },
  { label: "Google Ads", pct: 18, colour: "#8b7bf0" },
  { label: "Manual Entry", pct: 12, colour: "#63c96b" },
  { label: "Other", pct: 8, colour: "#b7f34a" },
] as const;
