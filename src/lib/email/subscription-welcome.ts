/**
 * The subscription welcome email: sent once to the owner when a subscription
 * becomes active on a paid plan (trial conversion or a direct subscribe).
 * See docs/upsell-plan.md.
 *
 * Pure: no `server-only`, no I/O, relative `.ts` imports, so the tests render
 * exactly what is sent. Every number and price is read from the catalogue
 * (plans.ts, tokens.ts, whatsapp-tokens.ts); nothing is written into the copy.
 *
 * House rules for this email: plain words, no emojis, no dashes as
 * punctuation, a text version alongside the HTML, and nothing promised that a
 * customer cannot buy today (voice is deliberately absent until it is live).
 */

import { PLANS, planThatUnlocks, type PlanDefinition, type PlanId } from "../billing/plans.ts";
import { TOKEN_PACK_LIST, formatTokens } from "../billing/tokens.ts";
import {
  WHATSAPP_TOKEN_PACKS,
  WHATSAPP_TOKENS_PER_MESSAGE,
  whatsappCoverageText,
} from "../billing/whatsapp-tokens.ts";
import { brandedEmailHtml, escapeHtml } from "./branded-email.ts";

export const SUBSCRIPTION_WELCOME_KIND = "subscription_welcome";

/**
 * Whether a mirrored subscription should get the welcome email now: active on
 * a paid plan, and not already welcomed (the marker row, 0149). A renewal, a
 * plan change or a recovered payment on the same subscription is "already".
 */
export function shouldQueueWelcome(input: { status: string; plan: string; alreadySent: boolean }): boolean {
  return input.status === "ACTIVE" && input.plan in PLANS && !input.alreadySent;
}

/** One job per Stripe subscription: the webhook and the return page cannot both send. */
export function welcomeJobKey(subscriptionId: string): string {
  return `notification.send:subscription-welcome:${subscriptionId}`;
}

/** Settings, Billing: where every pack and plan is bought. */
export const BILLING_PATH = "/app/settings?section=billing";

const NUMBER = new Intl.NumberFormat("en-GB");
const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2, minimumFractionDigits: 0 });

function gbp(amount: number): string {
  return GBP.format(amount);
}

export type WelcomeSection = { heading: string; paragraphs: string[]; bullets: string[] };

export type SubscriptionWelcomeEmail = {
  subject: string;
  /** Short line for the in-app notification row. */
  summary: string;
  sections: WelcomeSection[];
  text: string;
  html: string;
};

function planIncludes(plan: PlanDefinition): string[] {
  const users = plan.userLimit === 1 ? "1 user" : `${NUMBER.format(plan.userLimit)} users`;
  return [
    `${NUMBER.format(plan.leadLimit)} new leads a month`,
    `${NUMBER.format(plan.smsSegmentAllowance)} UK SMS segments a month, enough for an instant first text to every lead`,
    "Unlimited follow up email from your own mailbox",
    `${formatTokens(plan.aiTokenAllowance)} AI tokens a month for the assistant`,
    users,
  ];
}

export function welcomeSections(planId: string): WelcomeSection[] {
  const plan = PLANS[(planId in PLANS ? planId : "starter") as Exclude<PlanId, "trial">];
  const unlock = planThatUnlocks("whatsapp");

  const sections: WelcomeSection[] = [
    {
      heading: `What ${plan.name} includes`,
      paragraphs: [],
      bullets: planIncludes(plan),
    },
    {
      heading: "AI token packs",
      paragraphs: [
        "If the assistant uses its monthly AI tokens, it pauses until the allowance resets. Follow up and qualification rules keep running. A pack tops it up straight away, and bought tokens never expire.",
      ],
      bullets: TOKEN_PACK_LIST.map((pack) => `${formatTokens(pack.tokens)} AI tokens for ${gbp(pack.amountMinor / 100)}`),
    },
  ];

  const rate = `A conversation reply or utility template uses ${WHATSAPP_TOKENS_PER_MESSAGE.SERVICE} WhatsApp tokens, and a marketing template uses ${WHATSAPP_TOKENS_PER_MESSAGE.MARKETING}.`;
  if (plan.whatsappEnabled) {
    sections.push({
      heading: "WhatsApp",
      paragraphs: [
        `WhatsApp is an optional extra on ${plan.name}, bought as WhatsApp tokens. Nothing is included, so you only pay for what you send. ${rate}`,
      ],
      bullets: WHATSAPP_TOKEN_PACKS.map(
        (pack) => `${NUMBER.format(pack.tokens)} WhatsApp tokens for ${gbp(pack.priceGbp)}, ${whatsappCoverageText(pack.tokens)}`,
      ),
    });
  } else {
    sections.push({
      heading: "WhatsApp",
      paragraphs: [
        `WhatsApp is available on ${unlock?.name ?? "Growth"} and above, bought as WhatsApp tokens. ${rate} You can move up a plan at any time from Billing.`,
      ],
      bullets: [],
    });
  }

  sections.push({
    heading: "How to buy",
    paragraphs: [
      "Open Settings, then Billing, in ClientTurn. Packs are paid by card through Stripe and added as soon as the payment clears. There is no overage: nothing is charged beyond your plan and the packs you choose to buy.",
      "Packs never expire. A pack cannot be refunded once any of its tokens are used.",
    ],
    bullets: [],
  });

  return sections;
}

export function subscriptionWelcomeEmail(input: {
  plan: string;
  siteUrl: string;
  firstName?: string | null;
}): SubscriptionWelcomeEmail {
  const plan = PLANS[(input.plan in PLANS ? input.plan : "starter") as Exclude<PlanId, "trial">];
  const sections = welcomeSections(plan.id);
  const billingUrl = `${input.siteUrl}${BILLING_PATH}`;
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const intro = `Your ${plan.name} plan is active. Here is what it includes, and the extras you can add whenever you need them.`;

  const textParts: string[] = [greeting, "", intro];
  for (const section of sections) {
    textParts.push("", section.heading.toUpperCase());
    for (const paragraph of section.paragraphs) textParts.push(paragraph);
    for (const bullet of section.bullets) textParts.push(`* ${bullet}`);
  }
  textParts.push("", `Billing: ${billingUrl}`, "", "The ClientTurn team");

  const html = brandedEmailHtml({
    siteUrl: input.siteUrl,
    heading: `Welcome to ClientTurn ${plan.name}`,
    paragraphs: [escapeHtml(greeting), escapeHtml(intro)],
    sections: sections.map((section) => ({
      heading: escapeHtml(section.heading),
      paragraphs: section.paragraphs.map(escapeHtml),
      bullets: section.bullets.map(escapeHtml),
    })),
    ctaLabel: "Open Billing",
    ctaUrl: billingUrl,
  });

  return {
    subject: `Your ClientTurn ${plan.name} plan is active`,
    summary: `Your ${plan.name} plan is active. AI token packs${plan.whatsappEnabled ? " and WhatsApp tokens" : ""} are in Settings, Billing whenever you need more.`,
    sections,
    text: textParts.join("\n"),
    html,
  };
}
