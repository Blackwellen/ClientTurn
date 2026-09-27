/**
 * Illustrative example data for the revenue sections (home page, pricing).
 *
 * Every business, person, figure and time here is invented to show how the
 * product behaves. None of it is a customer, a result or a benchmark, and
 * every surface that renders it carries the "Illustrative example" label.
 *
 * The call opener and recording notice are NOT invented: they are the locked
 * OD-1 strings from `lib/voice/opener.ts`, rendered with the example business
 * name, so the site shows exactly what a real call says.
 *
 * House style: UK English, no emoji, no dashes as punctuation.
 */

import { OPENER_TEMPLATE, RECORDING_NOTICE } from "@/lib/voice/opener";
import { VOICE_MINUTE_PACKS } from "@/lib/marketing/voice-offer";

export const ILLUSTRATIVE_LABEL = "Illustrative example";

/** The example business using ClientTurn, and the lead it is talking to. */
export const EXAMPLE = {
  business: "Northfield Studio",
  lead: "Sam Carter",
  company: "Harbour Coffee Co",
  enquiry: "Website rebuild before spring",
  quoteNumber: "Q-0042",
} as const;

/** The opener exactly as a call would speak it, for the example business. */
export const EXAMPLE_OPENER = OPENER_TEMPLATE.replace("{calling_as_name}", EXAMPLE.business).replace(
  "{day}",
  "earlier today",
);

/** The opener as a template, with the customer's own name as a placeholder. */
export const OPENER_WITH_PLACEHOLDER = OPENER_TEMPLATE.replace("{calling_as_name}", "{your business}");

export { RECORDING_NOTICE };

/* ------------------------------------------------------------ the call --- */

export type TranscriptLine =
  | { kind: "agent"; text: string; tag?: string }
  | { kind: "lead"; text: string }
  | { kind: "chip"; tone: "objection" | "fact"; text: string }
  | { kind: "event"; text: string };

export const CALL_TRANSCRIPT: readonly TranscriptLine[] = [
  { kind: "agent", text: EXAMPLE_OPENER, tag: "AI disclosure" },
  { kind: "agent", text: RECORDING_NOTICE, tag: "Recording notice" },
  { kind: "lead", text: "Yes, go ahead. We need the site rebuilt before spring." },
  { kind: "agent", text: "Great. Roughly how many pages, and is a brand refresh in scope as well?" },
  { kind: "lead", text: "About ten pages. Honestly, the last quote we had felt expensive." },
  { kind: "chip", tone: "objection", text: "Objection detected: price" },
  {
    kind: "agent",
    text: "That's fair. Your quote is itemised, so you can see what each part costs and drop anything you don't need. Shall I send it now?",
  },
  { kind: "lead", text: "Please do." },
  { kind: "event", text: `Quote ${EXAMPLE.quoteNumber} sent by email and text` },
];

/** Elapsed time shown on the call, in seconds (3:24). */
export const CALL_ELAPSED_SEC = 204;

/** Qualification facts captured on the call, shown beside the transcript. */
export const CALL_FACTS = [
  { label: "Project", value: "Website rebuild, about 10 pages" },
  { label: "Timeline", value: "Live before spring" },
  { label: "Decision maker", value: "Yes, co-founder" },
  { label: "Next step", value: "Itemised quote" },
] as const;

/* ------------------------------------------------------------- the quote --- */

export type QuoteLine = { label: string; pence: number };

export const QUOTE_LINES: readonly QuoteLine[] = [
  { label: "Discovery workshop", pence: 60_000 },
  { label: "Design and build, 10 pages", pence: 480_000 },
  { label: "Launch support, 30 days", pence: 40_000 },
];

export const QUOTE_VAT_RATE = 0.2;
export const QUOTE_DEPOSIT_RATE = 0.3;

export const QUOTE_NET_PENCE = QUOTE_LINES.reduce((sum, line) => sum + line.pence, 0);
export const QUOTE_VAT_PENCE = Math.round(QUOTE_NET_PENCE * QUOTE_VAT_RATE);
export const QUOTE_GROSS_PENCE = QUOTE_NET_PENCE + QUOTE_VAT_PENCE;
export const QUOTE_DEPOSIT_PENCE = Math.round(QUOTE_GROSS_PENCE * QUOTE_DEPOSIT_RATE);

const MONEY = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const MONEY_WHOLE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function money(pence: number, whole = false): string {
  return (whole ? MONEY_WHOLE : MONEY).format(pence / 100);
}

/* ---------------------------------------------------- cross-channel log --- */

export type Channel = "call" | "email" | "sms" | "whatsapp" | "signature" | "payment" | "crm";

export type TimelineEvent = {
  channel: Channel;
  channelLabel: string;
  time: string;
  title: string;
  detail: string;
};

export const CHANNEL_TIMELINE: readonly TimelineEvent[] = [
  {
    channel: "call",
    channelLabel: "Call",
    time: "Tue 10:14",
    title: "AI call, 3 min 24 s",
    detail: "Sam asked for a call on the form. Qualified, price objection handled, quote requested.",
  },
  {
    channel: "email",
    channelLabel: "Email",
    time: "Tue 10:18",
    title: `Quote ${EXAMPLE.quoteNumber} sent`,
    detail: "From your own mailbox, with the branded quote link and PDF.",
  },
  {
    channel: "sms",
    channelLabel: "SMS",
    time: "Tue 10:18",
    title: "Quote link by text",
    detail: "To the mobile Sam gave on the form, inside quiet hours rules.",
  },
  {
    channel: "whatsapp",
    channelLabel: "WhatsApp",
    time: "Wed 09:40",
    title: "Question answered",
    detail: "Sam messaged about the launch date. The agent answered from your delivery terms.",
  },
  {
    channel: "signature",
    channelLabel: "Signed",
    time: "Wed 11:05",
    title: "Quote signed",
    detail: "Simple electronic signature, sealed with an audit trail.",
  },
  {
    channel: "payment",
    channelLabel: "Payment",
    time: "Wed 11:07",
    title: `Deposit ${money(QUOTE_DEPOSIT_PENCE)} paid`,
    detail: "Collected through your own Stripe account.",
  },
  {
    channel: "crm",
    channelLabel: "CRM",
    time: "Wed 11:07",
    title: "Deal marked won",
    detail: "Your CRM updated and the revenue attributed to the lead form that started it.",
  },
];

/* ------------------------------------------------------------- the ROI --- */

/** Voice time used across the example journey: the one call, in seconds. */
export const ROI_SECONDS_USED = CALL_ELAPSED_SEC;

/** The pack whose per-minute rate the example is costed at (250 minutes). */
export const ROI_PACK = VOICE_MINUTE_PACKS[1];

export const ROI_VOICE_COST_PENCE = Math.round(
  (ROI_PACK.priceGbp * 100 * ROI_SECONDS_USED) / (ROI_PACK.minutes * 60),
);
