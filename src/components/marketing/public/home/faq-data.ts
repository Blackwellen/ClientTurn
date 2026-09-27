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
    a: `An AI sales agent that phones leads who asked for a call or agreed to one on your form. It opens by saying it is an AI assistant calling from your business, qualifies the enquiry, handles objections and sends a quote or books a meeting, then carries on the conversation by email, SMS and WhatsApp. Pro with Voice is ${gbp(PRO_WITH_VOICE_MONTHLY_GBP)} a month with ${VOICE_ADDON.includedMinutes} minutes and a dedicated number (Pro without voice is ${gbp(PRO_MONTHLY_GBP)}); on Starter and Growth, minute packs start at ${gbp(VOICE_PACKS_FROM_GBP)} plus ${gbp(VOICE_NUMBER_MONTHLY_GBP)} a month for the number. ${VOICE_TRIAL_NOTE}`,
  },
  {
    icon: CreditCard,
    q: "Can ClientTurn send quotes and take payment?",
    a: "Yes, on every paid plan. The agent collects the details your pricing needs, your catalogue and rules price the job, and a branded quote goes out for approval if your thresholds require it. The lead signs with a simple electronic signature, and deposit or balance invoices are paid through your own Stripe account. Your CRM is updated and the revenue is attributed to the source that produced it.",
  },
  {
    icon: CreditCard,
    q: "Do I need a credit card to start?",
    a: `Yes, but nothing is charged for ${TRIAL_DAYS} days. Stripe checks the card when you start the trial; the first payment is taken when it ends, and you can cancel before then. You can connect your sources, configure your messages and questions, and watch the whole flow run before you pay anything.`,
  },
  {
    icon: Zap,
    q: "Can I scale as my business grows?",
    a: "Yes. You can move between Starter, Growth and Pro at any time from billing settings. There is no minimum term and no cancellation fee — a self-serve plan simply runs to the end of the period you have paid for.",
  },
  {
    icon: Plug,
    q: "What lead sources and integrations are supported?",
    a: "Ad platforms, messaging, calendar and CRM connections cover the tools most teams already run — Meta and Google lead forms, Twilio SMS and WhatsApp, Google Calendar and Calendly, HubSpot, Zoho and Salesforce. Alongside those, systems like Pipedrive and Zapier send contacts in through a signed inbound endpoint we host. The integrations section on this page lists every one with its current state.",
  },
  {
    icon: Users,
    q: "Is ClientTurn suitable for multiple locations or teams?",
    a: "Pro includes up to ten users with routing and handover for a sales team. Enterprise adds custom lead, user and messaging limits, a dedicated support contact, a data processing agreement and onboarding assistance.",
  },
  {
    icon: Sparkles,
    q: "How does ClientTurn use AI?",
    a: "Qualification is deterministic: your configured questions and rules make every decision, and the same answers always produce the same outcome. The AI sales agent holds the conversation, understands what a lead means and extracts answers to the questions you configured. It never sets a price or invents availability: quotes are calculated from your catalogue and rules, discounts beyond your limits wait for a person's approval, and bookings only go into real calendar slots. Low confidence or an unmatched answer is marked for review, not guessed.",
  },
  {
    icon: MessageSquareText,
    q: "What happens when someone replies?",
    a: "The follow-up sequence stops immediately and the conversation moves into qualification. Their answers are recorded against the lead, and anything the rules cannot match confidently is flagged for a person rather than guessed at.",
  },
  {
    icon: Phone,
    q: "Can I send from my own number?",
    a: "In most cases, yes. You can send from a number you already control through a supported messaging provider, or use a new dedicated number. Which options are open to you depends on your provider and on UK numbering rules, so we confirm it during setup.",
  },
  {
    icon: BadgeCheck,
    q: "Can people opt out, and is that enforced?",
    a: "Yes, and it is enforced rather than just recorded. Every outbound message carries an opt-out instruction, opt-out replies are honoured immediately, and the opt-out is re-checked right before every single send — including reactivation campaigns. Quiet hours and per-contact attempt limits apply as well.",
  },
  {
    icon: RefreshCw,
    q: "Can I reactivate old leads?",
    a: "Yes, on the Growth plan and above. You can import or select past enquiries, filter out opt-outs and closed work, and run them through the same follow-up and qualification as new leads. You remain responsible for having a lawful basis to contact them.",
  },
  {
    icon: CalendarClock,
    q: "Does it replace my sales team?",
    a: "No. It removes the delay and the admin so your team spends its time on people who are actually ready to talk. The agent quotes only from your catalogue and rules, books only into your real availability, and hands anything outside them to a person with the full context.",
  },
  {
    icon: ShieldCheck,
    q: "Where is my data stored, and who can see it?",
    a: "Data is held in the EU/UK region and every tenant table is isolated at the database level, so one workspace can never read another's records. Every third party in the chain is named on our sub-processors page, and a data processing agreement is available on Enterprise.",
  },
  {
    icon: Headphones,
    q: "What kind of support do you provide?",
    a: "Every plan includes email support. Pro adds priority support, and Enterprise adds a dedicated support contact and onboarding assistance.",
  },
];
