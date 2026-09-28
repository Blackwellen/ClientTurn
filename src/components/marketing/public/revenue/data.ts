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

/**
 * The call as live captions: one line at a time, each at the call time it is
 * spoken. The first caption is always the locked AI-disclosure opener. The
 * recording notice is shown as a chip, not a caption. `event` lights one of
 * the in-call event chips when the caption is reached.
 */
export type CallEvent = "objection" | "quote" | "booked";

export type Caption = {
  speaker: "agent" | "lead";
  text: string;
  /** Call time when the line is spoken, in seconds. */
  at: number;
  event?: CallEvent;
};

export const CALL_CAPTIONS: readonly Caption[] = [
  { speaker: "agent", text: EXAMPLE_OPENER, at: 4 },
  { speaker: "lead", text: "Yes, go ahead. We need the site rebuilt before spring.", at: 21 },
  { speaker: "agent", text: "Roughly how many pages, and is a brand refresh in scope?", at: 48 },
  { speaker: "lead", text: "About ten. Honestly, the last quote felt expensive.", at: 92, event: "objection" },
  { speaker: "agent", text: "Fair. Yours is itemised, so you can drop anything you don't need.", at: 125 },
  { speaker: "agent", text: `I've sent quote ${EXAMPLE.quoteNumber} by email and text.`, at: 161, event: "quote" },
  { speaker: "lead", text: "Great. Can we talk it through on Tuesday?", at: 182 },
  { speaker: "agent", text: "Booked: Tuesday at 10:00 with the team.", at: 204, event: "booked" },
];

export const CALL_EVENTS: readonly { key: CallEvent; label: string; tone: "amber" | "lime" }[] = [
  { key: "objection", label: "Objection: price", tone: "amber" },
  { key: "quote", label: `Quote ${EXAMPLE.quoteNumber} sent`, tone: "lime" },
  { key: "booked", label: "Meeting booked Tue 10:00", tone: "lime" },
];

/** Elapsed time shown on the call, in seconds (3:24): the last caption. */
export const CALL_ELAPSED_SEC = CALL_CAPTIONS[CALL_CAPTIONS.length - 1].at;

/** Qualification facts captured on the call. */
export const CALL_FACTS = [
  { label: "Project", value: "Site rebuild, ~10 pages" },
  { label: "Timeline", value: "Before spring" },
  { label: "Decision maker", value: "Yes, co-founder" },
  { label: "Next step", value: "Call Tue 10:00" },
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
    detail: "Requested on the form. Qualified, quote requested.",
  },
  {
    channel: "email",
    channelLabel: "Email",
    time: "Tue 10:18",
    title: `Quote ${EXAMPLE.quoteNumber} sent`,
    detail: "From your mailbox, with link and PDF.",
  },
  {
    channel: "sms",
    channelLabel: "SMS",
    time: "Tue 10:18",
    title: "Quote link by text",
    detail: "To the mobile Sam gave on the form.",
  },
  {
    channel: "whatsapp",
    channelLabel: "WhatsApp",
    time: "Wed 09:40",
    title: "Question answered",
    detail: "Launch date, answered from your terms.",
  },
  {
    channel: "signature",
    channelLabel: "Signed",
    time: "Wed 11:05",
    title: "Quote signed",
    detail: "Simple electronic signature, audit trail.",
  },
  {
    channel: "payment",
    channelLabel: "Payment",
    time: "Wed 11:07",
    title: `Deposit ${money(QUOTE_DEPOSIT_PENCE)} paid`,
    detail: "Through your own Stripe account.",
  },
  {
    channel: "crm",
    channelLabel: "CRM",
    time: "Wed 11:07",
    title: "Deal marked won",
    detail: "CRM updated, revenue attributed.",
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
