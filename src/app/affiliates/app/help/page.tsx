import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CircleHelp, Mail } from "lucide-react";
import { getAffiliateAccount } from "@/lib/affiliates/portal";
import {
  describeAttribution,
  describeCommission,
  describePayout,
} from "@/lib/affiliates/programme";
import { Panel, PortalHeader } from "@/components/affiliates/portal-ui";

export const metadata: Metadata = { title: "Help | ClientTurn Affiliate Portal" };
export const dynamic = "force-dynamic";

/**
 * Partner help.
 *
 * The programme answers are generated from the live policy rather than typed
 * out, so changing the rate or the attribution window in the database changes
 * what this page says. Hard-coding "20%" here is how a help page ends up
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
        "The commission for that payment is reversed. If it had not been paid out yet, your balance simply drops. If it had already been paid, a matching adjustment is applied against future earnings — we never edit a payout you have already received.",
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
                href="mailto:partners@clientturn.com"
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
                { href: "/affiliates", label: "Programme terms" },
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
