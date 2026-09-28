import {
  BadgeCheck,
  CalendarClock,
  CreditCard,
  Headphones,
  MessageSquareText,
  Phone,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import {
  PRO_MONTHLY_GBP,
  PRO_WITH_VOICE_MONTHLY_GBP,
  VOICE_ADDON,
  VOICE_NUMBER_MONTHLY_GBP,
  VOICE_PACKS_FROM_GBP,
  VOICE_TRIAL_NOTE,
  gbp,
} from "@/lib/marketing/voice-offer";

/**
 * The homepage FAQ content.
 *
 * Kept out of the client component that renders it so the page — a Server
 * Component — can read the real array when it emits FAQPage structured data.
 * Importing a plain value from a `"use client"` module gives the server a
 * client reference, not the data.
 *
 * Fourteen questions, which is the range where the block still reads as a
 * genuine pre-purchase FAQ rather than a keyword dump, and every answer
 * states something the product or the Terms actually commit to. The trial
 * length is read from the plan catalogue rather than written out, so it
 * cannot drift from what checkout grants.
 */
export type HomeFaq = { icon: LucideIcon; q: string; a: string };

export const HOME_FAQS: HomeFaq[] = [
  {
    icon: Phone,
    q: "What is the AI Voice Sales Agent?",
    a: `An AI agent that phones leads who asked for a call or agreed to one on your form, says it is an AI assistant calling from your business, then qualifies, quotes or books a meeting and follows up by email, SMS and WhatsApp. Pro with Voice is ${gbp(PRO_WITH_VOICE_MONTHLY_GBP)} a month with ${VOICE_ADDON.includedMinutes} minutes and a dedicated number (Pro alone is ${gbp(PRO_MONTHLY_GBP)}); on Starter and Growth, minute packs start at ${gbp(VOICE_PACKS_FROM_GBP)} plus ${gbp(VOICE_NUMBER_MONTHLY_GBP)} a month for the number. ${VOICE_TRIAL_NOTE}`,
  },
  {
    icon: CreditCard,
    q: "Can ClientTurn send quotes and take payment?",
    a: "Yes, on every paid plan. Your catalogue and rules price each quote, with approval when your thresholds require it. Leads sign with a simple electronic signature and pay deposit or balance invoices through your own Stripe account.",
  },
  {
    icon: CreditCard,
    q: "Do I need a credit card to start?",
    a: `Yes, but nothing is charged for ${TRIAL_DAYS} days. Stripe checks the card when you start; the first payment is taken when the trial ends, and you can cancel before then.`,
  },
  {
    icon: Zap,
    q: "Can I scale as my business grows?",
    a: "Yes. Move between Starter, Growth and Pro at any time from billing settings. There is no minimum term or cancellation fee: a self-serve plan runs to the end of the period you have paid for.",
  },
  {
    icon: Plug,
    q: "What lead sources and integrations are supported?",
    a: "Meta and Google lead forms, Twilio SMS and WhatsApp, Google Calendar, Calendly, HubSpot, Zoho and Salesforce. Tools like Pipedrive and Zapier send contacts in through a signed inbound endpoint we host. The integrations section on this page lists each one with its current state.",
  },
  {
    icon: Users,
    q: "Is ClientTurn suitable for multiple locations or teams?",
    a: "Pro includes up to ten users with routing and handover for a sales team. Enterprise adds custom lead, user and messaging limits, a dedicated support contact, a data processing agreement and onboarding assistance.",
  },
  {
    icon: Sparkles,
    q: "How does ClientTurn use AI?",
    a: "Qualification is deterministic: your questions and rules make every decision, and the same answers always give the same outcome. The AI agent holds the conversation and extracts answers, but never sets a price or invents availability: quotes come from your catalogue and rules, and discounts beyond your limits need a person's approval. Low-confidence or unmatched answers are marked for review, not guessed.",
  },
  {
    icon: MessageSquareText,
    q: "What happens when someone replies?",
    a: "The follow-up sequence stops immediately and qualification begins. Answers are recorded against the lead, and anything the rules cannot match confidently is flagged for a person.",
  },
  {
    icon: Phone,
    q: "Can I send from my own number?",
    a: "In most cases, yes: use a number you already control through a supported provider, or a new dedicated number. What is possible depends on your provider and UK numbering rules, so we confirm it during setup.",
  },
  {
    icon: BadgeCheck,
    q: "Can people opt out, and is that enforced?",
    a: "Yes, and it is enforced. Every message carries an opt-out instruction, and opt-outs are honoured immediately and re-checked before every send, including reactivation campaigns. Quiet hours and per-contact attempt limits apply too.",
  },
  {
    icon: RefreshCw,
    q: "Can I reactivate old leads?",
    a: "Yes, on Growth and above. Import or select past enquiries, filter out opt-outs and closed work, and run them through the same follow-up and qualification. You remain responsible for having a lawful basis to contact them.",
  },
  {
    icon: CalendarClock,
    q: "Does it replace my sales team?",
    a: "No. It removes the delay and admin so your team talks to people who are ready. Anything outside your catalogue, rules or availability goes to a person with the full context.",
  },
  {
    icon: ShieldCheck,
    q: "Where is my data stored, and who can see it?",
    a: "Data is held in the EU/UK region and every tenant table is isolated at the database level. Every third party is named on our sub-processors page, and a data processing agreement is available on Enterprise.",
  },
  {
    icon: Headphones,
    q: "What kind of support do you provide?",
    a: "Every plan includes email support. Pro adds priority support, and Enterprise adds a dedicated support contact and onboarding assistance.",
  },
];
