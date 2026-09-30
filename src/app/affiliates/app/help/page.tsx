import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CircleHelp, Mail } from "lucide-react";
import { getAffiliateAccount } from "@/lib/affiliates/portal";
import { COMPANY } from "@/lib/marketing/company";
import {
  describeAttribution,
  describeCommission,
  describePayout,
} from "@/lib/affiliates/programme";
import { Panel, PortalHeader } from "@/components/affiliates/portal-ui";

export const metadata: Metadata = { title: "Affiliate Help" };
export const dynamic = "force-dynamic";

/**
 * Partner help.
 *
 * The programme answers are generated from the live policy rather than typed
 * out, so changing the rate or the attribution window in the database changes
 * what this page says. Hard-coding a rate here is how a help page ends up
 * contradicting the ledger.
 */
export default async function AffiliateHelpPage() {
  const affiliate = await getAffiliateAccount();
  if (!affiliate) return null;

  const answers = [
    { question: "How much do I earn?", answer: describeCommission(affiliate.policy) },
    { question: "How does tracking work?", answer: describeAttribution(affiliate.policy) },
    { question: "When do I get paid?", answer: describePayout(affiliate.policy) },
    {
      question: "What happens if a customer refunds?",
      answer:
        "Commission is one-off, on the customer's first payment. If that first payment is refunded or charged back, its commission is reversed. If it had not been paid out yet, your balance simply drops. If it had already been paid, a matching adjustment is applied against future earnings; we never edit a payout you have already received. If the partnership ends before a negative balance is recovered, we write it off: you are never invoiced for it. A customer cancelling later does not reverse anything.",
    },
    {
      question: "Do I earn on renewals?",
      answer:
        "No. You earn once per referred customer, on their first paid subscription invoice: the full amount, excluding VAT, so an annual plan pays on the whole annual invoice. Renewals, add-ons and top-ups do not earn commission.",
    },
    {
      question: "Do I need to send you an invoice?",
      answer:
        "Only if you are VAT registered. Your payout statements are remittance advice, not VAT invoices, and we do not self-bill, so a VAT-registered partner sends us a VAT invoice for each payout.",
    },
    {
      question: "Are there promo codes?",
      answer:
        "No. Your referral link is how a customer is credited to you. If a visitor accepts cookies it is remembered for your referral window; if not, it is carried to sign-up during that visit.",
    },
    {
      question: "Can I refer my own business?",
      answer:
        "No. Self-referrals are detected and do not earn commission. That includes the same billing entity or payment method under a different name.",
    },
    {
      question: "Why has my payout not arrived?",
      answer:
        "Payouts need four things: a connected Stripe account, completed identity checks, submitted tax information, and an approved balance at or above the minimum. Your Settings page shows which of those is outstanding.",
    },
  ];

  return (
    <>
      <PortalHeader
        title="Help"
        description="How the ClientTurn affiliate programme works, and how to reach us."
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)]">
        <Panel icon={CircleHelp} title="Common questions">
          <dl className="divide-y divide-line-subtle border-t border-line-subtle">
            {answers.map((entry) => (
              <div key={entry.question} className="px-4 py-3.5">
                <dt className="text-[13.5px] font-semibold text-content">
                  {entry.question}
                </dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-content-secondary">
                  {entry.answer}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <div className="min-w-0 space-y-3">
          <Panel icon={Mail} title="Get in touch">
            <div className="px-4 pb-4">
              <p className="text-[13px] leading-relaxed text-content-secondary">
                Quote your affiliate reference{" "}
                <span className="font-medium text-content">
                  {affiliate.reference}
                </span>{" "}
                and we can find your account straight away.
              </p>
              <a
                // One of the two monitored mailboxes (company.ts); there is no
                // separate partners@ inbox.
                href={`mailto:${COMPANY.supportEmail}?subject=${encodeURIComponent(`Partner ${affiliate.reference}`)}`}
                className="mt-3 inline-flex h-10 items-center rounded-[9px] bg-accent-500 px-4 text-[13.5px] font-semibold text-brand-midnight hover:bg-[#a6e238]"
              >
                Email the partner team
              </a>
            </div>
          </Panel>

          <Panel icon={CircleHelp} title="Useful pages">
            <ul className="divide-y divide-line-subtle border-t border-line-subtle">
              {[
                { href: "/affiliates/app/settings?section=payments", label: "Payout setup" },
                { href: "/affiliates/app/resources", label: "Brand and campaign assets" },
                { href: "/affiliates/terms", label: "Programme terms" },
              ].map((entry) => (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    className="block px-4 py-2.5 text-[13px] font-medium text-content hover:bg-surface-hover"
                  >
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
