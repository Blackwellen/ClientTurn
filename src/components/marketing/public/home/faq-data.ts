import {
  CreditCard,
  Headphones,
  Plug,
  Sparkles,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { TRIAL_DAYS } from "@/lib/billing/plans";

/**
 * The homepage FAQ content.
 *
 * Kept out of the client component that renders it so the page — a Server
 * Component — can read the real array when it emits FAQPage structured data.
 * Importing a plain value from a `"use client"` module gives the server a
 * client reference, not the data.
 *
 * Every answer states something the product or the Terms actually commit to,
 * and the trial length is read from the plan catalogue rather than written
 * out, so it cannot drift from what checkout grants.
 */
export type HomeFaq = { icon: LucideIcon; q: string; a: string };

export const HOME_FAQS: HomeFaq[] = [
  {
    icon: CreditCard,
    q: "Do I need a credit card to start?",
    a: `No. You can start with a ${TRIAL_DAYS}-day free trial with no card. You can connect your sources, configure your messages and questions, and watch the whole flow run before you pay anything.`,
  },
  {
    icon: Zap,
    q: "Can I scale as my business grows?",
    a: "Yes. You can move between Starter, Growth and Pro at any time from billing settings. There is no minimum term and no cancellation fee — a self-serve plan simply runs to the end of the period you have paid for.",
  },
  {
    icon: Plug,
    q: "What lead sources and integrations are supported?",
    a: "Systems like Pipedrive, Attio, folk, Clay, Zapier, Instantly and Smartlead send contacts into ClientTurn through a signed inbound endpoint we host. Ad platforms, messaging, calendar and CRM connections are provisioned per deployment — the integrations section on this page shows exactly which are live and which are still coming.",
  },
  {
    icon: Users,
    q: "Is ClientTurn suitable for multiple locations or teams?",
    a: "Pro includes up to ten users with routing and handover for a sales team. Enterprise adds custom lead, user and messaging limits, a dedicated support contact, a data processing agreement and onboarding assistance.",
  },
  {
    icon: Sparkles,
    q: "How does ClientTurn use AI?",
    a: "Qualification is deterministic: your configured questions and rules make every decision, and the same answers always produce the same outcome. AI assists by classifying what an inbound message means and extracting a candidate answer to a question you already configured. It never quotes, never promises availability and never commits you to anything — low confidence or an unmatched value goes to a person.",
  },
  {
    icon: Headphones,
    q: "What kind of support do you provide?",
    a: "Every plan includes email support. Pro adds priority support, and Enterprise adds a dedicated support contact and onboarding assistance.",
  },
];
