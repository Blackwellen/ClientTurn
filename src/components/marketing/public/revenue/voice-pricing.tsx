import * as React from "react";
import { Check, FileSignature, PhoneCall } from "lucide-react";
import {
  PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN,
  PRO_MONTHLY_GBP,
  PRO_WITH_VOICE_ANNUAL_MONTHLY_GBP,
  PRO_WITH_VOICE_MONTHLY_GBP,
  SIGNATURE_LABEL,
  VOICE_ADDON,
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
  VOICE_TERMS,
  gbp,
  minutes,
  packPencePerMinute,
} from "@/lib/marketing/voice-offer";
import { PublicCard, SectionEyebrow, GlyphTile } from "../ui";
import { PrimaryCta, SecondaryCta } from "../actions";
import "./revenue.css";

/**
 * Voice and quote-to-cash pricing, for /pricing (#voice-pricing).
 *
 * Every price is read from `lib/marketing/voice-offer` (OD-2). The buy
 * actions are the existing signup flow the plan cards already use
 * (`/signup?plan=...`); minute packs and the number are bought in Billing
 * once a paid plan is active, so this block has no pack checkout of its own.
 * Voice is never shown as free or as part of the trial.
 */
export function VoicePricingBand() {
  return (
    <div>
      <SectionEyebrow className="mb-5">AI Voice Sales Agent and quotes</SectionEyebrow>
      <h2 id="voice-pricing-heading" className="pub-h2">
        Voice pricing. <span className="pub-accent">Prepaid, capped, no overage.</span>
      </h2>
      <p className="pub-lead mt-5 max-w-3xl">
        Bundled with Pro, or a prepaid add-on on Starter and Growth. Quotes and invoices come with
        every paid plan.
      </p>

      <div className="rv-vp-grid">
        <PublicCard lit className="rv-vp-card">
          <div className="flex items-center gap-3">
            <GlyphTile icon={PhoneCall} size={40} glyph={18} solid />
            <h3 className="text-lg font-semibold text-[var(--pub-text)]">Pro with Voice</h3>
          </div>
          <p className="rv-vp-price">
            <b>{gbp(PRO_WITH_VOICE_MONTHLY_GBP)}</b>
            <span>/ month, excluding VAT</span>
          </p>
          <ul className="pub-ticks">
            <li>
              <Check className="size-3.5" aria-hidden />
              <span>{minutes(VOICE_ADDON.includedMinutes)} of AI calls a month</span>
            </li>
            <li>
              <Check className="size-3.5" aria-hidden />
              <span>A dedicated UK number for your business</span>
            </li>
            <li>
              <Check className="size-3.5" aria-hidden />
              <span>Everything in Pro</span>
            </li>
          </ul>
          <p className="rv-vp-alt">
            <strong>Don&rsquo;t need voice? Pro {gbp(PRO_MONTHLY_GBP)}</strong> a month.
          </p>
          <p className="pub-small mt-3">
            Annual: {gbp(PRO_WITH_VOICE_ANNUAL_MONTHLY_GBP)} a month. The discount excludes the{" "}
            {gbp(VOICE_ADDON.monthlyPriceGbp)} voice item.
          </p>
          <div className="mt-auto flex flex-wrap gap-3 pt-6">
            <PrimaryCta placement="pricing_voice_pro" href="/signup?plan=pro">
              Choose Pro with Voice
            </PrimaryCta>
          </div>
        </PublicCard>

        <PublicCard className="rv-vp-card">
          <h3 className="text-lg font-semibold text-[var(--pub-text)]">
            Starter and Growth: voice add-on
          </h3>
          <p className="pub-small mt-2">Prepaid minute packs plus a dedicated number.</p>
          <div className="pub-screen-scroll">
            <table className="rv-vp-table">
              <caption className="sr-only">Voice minute packs</caption>
              <thead>
                <tr>
                  <th scope="col">Pack</th>
                  <th scope="col">Per minute</th>
                  <th scope="col">Price</th>
                </tr>
              </thead>
              <tbody>
                {VOICE_MINUTE_PACKS.map((pack) => (
                  <tr key={pack.minutes}>
                    <th scope="row">{minutes(pack.minutes)}</th>
                    <td>{packPencePerMinute(pack)}p</td>
                    <td>{gbp(pack.priceGbp)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Dedicated UK number</th>
                  <td>Monthly</td>
                  <td>{gbp(VOICE_NUMBER_MONTHLY_GBP)}/month</td>
                </tr>
                <tr>
                  <th scope="row">Premium voice</th>
                  <td>Optional</td>
                  <td>+{gbp(PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN)}/min</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="pub-small mt-3">Bought in Billing once your plan is active.</p>
          <div className="mt-auto flex flex-wrap gap-3 pt-6">
            <SecondaryCta placement="pricing_voice_addon" href="/signup?plan=growth" withArrow>
              Start on Growth
            </SecondaryCta>
          </div>
        </PublicCard>
      </div>

      <div className="pub-columns mt-8">
        <div className="pub-column">
          <h3 className="text-base font-semibold text-[var(--pub-text)]">How voice minutes work</h3>
          <ul className="pub-ticks">
            {VOICE_TERMS.map((term) => (
              <li key={term}>
                <Check className="size-3.5" aria-hidden />
                <span>{term}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="pub-column">
          <div className="pub-cell-row">
            <GlyphTile icon={FileSignature} size={36} glyph={16} />
            <h3 className="text-base font-semibold text-[var(--pub-text)]">Quotes and payments</h3>
          </div>
          <ul className="pub-ticks">
            <li>
              <Check className="size-3.5" aria-hidden />
              <span>Branded quotes priced by your rules, on every paid plan.</span>
            </li>
            <li>
              <Check className="size-3.5" aria-hidden />
              <span>{SIGNATURE_LABEL}.</span>
            </li>
            <li>
              <Check className="size-3.5" aria-hidden />
              <span>
                Invoices paid through your own Stripe. ClientTurn takes no share.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
