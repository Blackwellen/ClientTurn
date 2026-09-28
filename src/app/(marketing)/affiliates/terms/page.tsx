import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { getPublicPolicy } from "@/lib/affiliates/portal";
import {
  describeAttribution,
  describeCommission,
  describePayout,
  type ProgrammePolicy,
} from "@/lib/affiliates/programme";
import { COMPANY } from "@/lib/marketing/company";
import { loadTiers } from "@/lib/affiliates/programme-settings";
import { tierRateLabel, type TierDefinition } from "@/lib/affiliates/tier-rules";

/**
 * The public affiliate programme terms (affiliate audit 17 §7).
 *
 * DRAFT FOR OWNER REVIEW. Every number on this page is read live: the
 * window, base rate, hold and threshold from the default commission plan
 * (`getPublicPolicy`), and the tier names, rates and thresholds from
 * `affiliate_tiers` (`loadTiers`). The prose describes the behaviour in code
 * as of 2026-09-28, including the owner decisions of that day: one-off
 * commission on the first payment (the full amount, annual plans included),
 * tiers of 6/8/10% by paid referred customers in the last 12 months, the
 * referral cookie only after consent, a negative balance written off (never
 * invoiced) when a partnership ends, no self-billing at launch, and no promo
 * codes. It is not legal advice and must be approved before the programme is
 * promoted; until then it is not indexed.
 */

export const dynamic = "force-dynamic";

const description =
  "The ClientTurn affiliate programme terms: attribution, commission, holds, reversals, payouts, tiers, prohibited promotion methods and PECR rules.";

export const metadata: Metadata = {
  title: "Affiliate Programme Terms",
  description,
  alternates: { canonical: "/affiliates/terms" },
  // Not indexed until the owner has approved the wording (audit 17).
  robots: { index: false, follow: true },
};

function tierSentence(tiers: readonly TierDefinition[], planPercent: number | null): string {
  return [...tiers]
    .sort((a, b) => a.rank - b.rank)
    .map((tier) =>
      tier.minActiveCustomers > 0
        ? `${tier.name}: ${tierRateLabel(tier, planPercent)} from ${tier.minActiveCustomers} paid referred customers in the last 12 months`
        : `${tier.name}: ${tierRateLabel(tier, planPercent)}`,
    )
    .join("; ");
}

function sections(policy: ProgrammePolicy, tiers: readonly TierDefinition[]): LegalSection[] {
  return [
    {
      id: "who",
      heading: "1. Who these terms are between",
      body: (
        <p>
          These terms are between you (the partner) and {COMPANY.registeredName}, trading as{" "}
          {COMPANY.product}. They apply once your application is approved. You are an independent
          contractor, not an employee, agent or partner of {COMPANY.product}, and you may not make
          commitments on our behalf.
        </p>
      ),
    },
    {
      id: "attribution",
      heading: "2. How referrals are tracked",
      body: (
        <>
          <p>{describeAttribution(policy)}</p>
          <p>
            Your link carries a signed referral. We store it in a first-party cookie (
            <code>ct_ref</code>) <strong>only if the visitor accepts non-essential cookies</strong>; it is
            listed in our <Link href="/cookies" className="underline underline-offset-4">Cookie Policy</Link>.
            If they do not accept, the referral travels in the page address to sign-up during that same
            visit, and nothing is stored on their device, so a later visit cannot be credited. A referral
            counts when the person who clicked creates a new {COMPANY.product} workspace within the
            window. One workspace can only ever be credited to one partner. There are no partner promo
            codes: your referral link is how a customer is credited to you.
          </p>
          <p>
            Automated traffic, link-preview fetches and unusually high click volumes from one network
            are not counted. To protect visitors, we store only keyed hashes of network addresses,
            never the addresses themselves, and delete them after 120 days.
          </p>
        </>
      ),
    },
    {
      id: "commission",
      heading: "3. What you earn",
      body: (
        <>
          <p>{describeCommission(policy)}</p>
          <p>
            You earn <strong>once per referred customer</strong>, on their <strong>first paid
            subscription invoice</strong>. The commission is your tier&apos;s rate times that whole
            first payment, as the customer actually paid it, <strong>excluding VAT</strong> and after
            any discount or credit. For a monthly plan that is the first monthly invoice; for an annual
            plan it is the full first annual invoice, not a twelfth of it. Renewals, later invoices,
            plan changes, add-ons, top-ups, one-off purchases and payments in a currency other than{" "}
            {policy.currency} earn nothing.
          </p>
          <p>
            The rate is set by your tier when the first payment is made (see section 7). A tier never
            reduces the rate below the one stated here, and commission already earned is never
            recalculated.
          </p>
        </>
      ),
    },
    {
      id: "hold",
      heading: "4. Holds, refunds and chargebacks",
      body: (
        <>
          <p>
            Each commission is held for {policy.holdDays} days from the payment before it is approved,
            to cover refunds and chargebacks.
          </p>
          <p>
            If the customer is refunded, the commission is reversed in proportion to the amount
            refunded. If the customer disputes the payment with their bank, the commission is reversed
            when the dispute opens; if the dispute is later decided in our favour, it is restored with
            its original availability date.
          </p>
          <p>
            If commission has already been paid to you, a refund or chargeback of that first payment is
            deducted from your future commission, which can make your balance temporarily negative. No
            payout is made until the balance is back above the minimum. A customer cancelling later,
            without that first payment being refunded or charged back, does not reverse your commission.
          </p>
          <p>
            <strong>If the partnership ends while your balance is negative, the deficit is written
            off.</strong> We do not invoice you for it or ask you to repay it; our ledger records a
            write-off that brings the balance to zero.
          </p>
        </>
      ),
    },
    {
      id: "payouts",
      heading: "5. Payouts",
      body: (
        <>
          <p>{describePayout(policy)}</p>
          <p>
            Payouts are made through Stripe Connect to an account in your name. Stripe collects and
            holds your identity, bank and any tax details; we store only your tax country, entity type
            and the last four characters of your tax reference. Each monthly payout is reviewed and
            approved by our team before it is sent. If a payout fails, nothing is lost: its commission
            returns to your balance for the next run.
          </p>
          <p>
            You are responsible for declaring your commission as income. Payout statements are{" "}
            <strong>remittance advice, not VAT invoices</strong>. We do not operate self-billing: if you
            are VAT registered, you send us a VAT invoice for each payout.
          </p>
        </>
      ),
    },
    {
      id: "eligibility",
      heading: "6. Referrals that are not eligible",
      body: (
        <>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Your own workspace, or one you are a member of, own or pay for.</li>
            <li>A customer using your email address, your Stripe customer account or your payment card.</li>
            <li>A person who already had a {COMPANY.product} workspace before clicking your link.</li>
            <li>Sign-ups from paid search ads on {COMPANY.product} brand terms or close variants.</li>
            <li>Sign-ups obtained by any method prohibited in section 8.</li>
          </ul>
          <p>
            Some referrals are held for review automatically, for example when a sign-up comes from a
            network or device you use. A held referral earns nothing until our team decides it; if it
            is cleared, the one-off commission on its first payment is calculated then. We may reverse
            commission on a referral we find ineligible, including commission already paid.
          </p>
        </>
      ),
    },
    {
      id: "tiers",
      heading: "7. Tiers",
      body: (
        <>
          <p>
            Your tier sets the rate of your one-off commission: {tierSentence(tiers, policy.commissionPercent)}.
            A &ldquo;paid referred customer&rdquo; is a referral whose first payment was made in the last
            12 months. Revenue does not count towards a tier, because commission is paid once, not on
            later revenue.
          </p>
          <p>
            Tiers are checked daily: you move up as soon as you qualify, and move down only at the
            monthly review on the 1st. We may set a tier by hand in exceptional cases and will tell you
            when your tier changes.
          </p>
        </>
      ),
    },
    {
      id: "promotion",
      heading: "8. How you may promote ClientTurn",
      body: (
        <>
          <p>You must:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Clearly disclose that you earn commission (for example &ldquo;#ad&rdquo; or &ldquo;affiliate
              link&rdquo;), as the CAP Code and the Consumer Protection from Unfair Trading rules require.
            </li>
            <li>Describe {COMPANY.product} accurately, using only claims on our website or in the Resources Hub.</li>
            <li>
              Follow the Privacy and Electronic Communications Regulations (PECR) and UK GDPR for any
              email, SMS or other electronic message you send.
            </li>
          </ul>
          <p>You must not:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Send unsolicited marketing email or SMS to individuals, sole traders or unincorporated
              partnerships without their prior consent. Messages to incorporated companies and LLPs
              must identify you, and must offer a free, simple opt-out that you honour.
            </li>
            <li>Use bought, rented or scraped contact lists, or make marketing calls to numbers on the TPS or CTPS.</li>
            <li>Bid on {COMPANY.product} brand terms or close variants, or run ads that suggest you are {COMPANY.product}.</li>
            <li>
              Set referral cookies without a genuine click (cookie stuffing, hidden frames, pop-unders,
              forced redirects), or pay or reward people to click or sign up.
            </li>
            <li>Post fake reviews or testimonials, or offer discounts, codes, trials or promises we have not approved.</li>
            <li>Promote on sites with unlawful, hateful, adult or misleading content.</li>
          </ul>
          <p>
            Referrals obtained in breach of this section are not eligible, and a serious or repeated
            breach may lead to suspension and the reversal of affected commission.
          </p>
        </>
      ),
    },
    {
      id: "data",
      heading: "9. Customer data",
      body: (
        <p>
          You never receive a referred customer&apos;s name, contact details or business data. Your
          dashboard shows anonymised referral labels, their stage, the plan they are on and the
          commission earned. You must not attempt to identify or contact customers through
          {" "}{COMPANY.product} data.
        </p>
      ),
    },
    {
      id: "ending",
      heading: "10. Suspension, ending and changes",
      body: (
        <>
          <p>
            Either side may end the partnership at any time. While an account is suspended or after it
            ends, links stop tracking and no new commission accrues. Approved commission for payments
            made before the end is paid on the normal schedule, subject to sections 4 and 6. A negative
            balance at the end is written off, never invoiced (section 4).
          </p>
          <p>
            We may change these terms with at least 30 days&apos; notice in your dashboard or by email.
            Changes do not affect commission already earned. These terms are governed by the law of
            England and Wales. Questions: see the{" "}
            <Link href="/affiliates" className="underline underline-offset-4">
              programme page
            </Link>{" "}
            or contact us through the partner portal.
          </p>
        </>
      ),
    },
  ];
}

export default async function AffiliateTermsPage() {
  const [policy, tiers] = await Promise.all([getPublicPolicy(), loadTiers()]);
  return (
    <LegalPage
      title="Affiliate Programme Terms"
      intro={`The rules of the ${COMPANY.product} affiliate programme: how referrals are tracked, what you earn and when, how refunds and chargebacks are handled, and how you may promote us.`}
      operatorNote="Draft pending owner review (terms version 2026-09). Figures are read live from the programme's commission plan."
      sections={sections(policy, tiers)}
      currentPath="/affiliates/terms"
    />
  );
}
