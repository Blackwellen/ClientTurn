import Link from "next/link";
import { FlCta } from "../fl-cta";
import { CLOSING_FLOW, INTEGRATION_ROWS } from "../data";
import { ArrowRight, ChevronRight } from "../pieces";
import { Reveal, StaggerItem, StaggerReveal, fadeUp } from "../motion";

/**
 * Closing panel.
 *
 * The compact Describe → Search → Verify → Engage → Lead flow restates the
 * whole page in five words, then the two actions. The integration strip below
 * it is labelled by *route*, not by logo: everything listed is reachable
 * through the app/webhook connector, and saying so is the difference between
 * an accurate capability and an implied native two-way sync.
 */
export function FindLeadsFinalCta() {
  return (
    <section className="fl-section fl-final" aria-labelledby="fl-final-title">
      <div aria-hidden className="fl-grid-bg" />
      <div aria-hidden className="fl-glow" />

      <div className="fl-wrap">
        <Reveal className="fl-final-inner">
          <p className="fl-eyebrow">Build your pipeline</p>
          <h2 className="fl-h2" id="fl-final-title" style={{ marginTop: 18 }}>
            Tell ClientTurn <em>who you want to reach.</em>
          </h2>
          <p className="fl-lead">
            Turn a natural-language target into a structured sourcing plan, a
            verified prospect list and a controlled acquisition workflow.
          </p>

          <StaggerReveal as="ol" className="fl-final-flow" step={0.09}>
            {CLOSING_FLOW.map((step, index) => (
              <StaggerItem as="li" key={step} variants={fadeUp}>
                <span>{step}</span>
                {index < CLOSING_FLOW.length - 1 && (
                  <ChevronRight aria-hidden size={15} />
                )}
              </StaggerItem>
            ))}
          </StaggerReveal>

          <div className="fl-final-actions">
            <FlCta placement="find_leads_final_cta">
              Start Finding Leads
              <ArrowRight size={16} />
            </FlCta>
            <FlCta
              placement="find_leads_contact_sales"
              href="/contact-sales"
              variant="secondary"
            >
              Contact Sales
            </FlCta>
          </div>

          <p className="fl-body" style={{ marginTop: 40 }}>
            Already using something for outbound? Prospects and replies can be
            pushed onward through the app and webhook connector.
          </p>
          <StaggerReveal
            as="ul"
            className="fl-integrations"
            step={0.04}
            style={{ justifyContent: "center" }}
          >
            {INTEGRATION_ROWS.map((name) => (
              <StaggerItem as="li" key={name} variants={fadeUp}>
                {name}
              </StaggerItem>
            ))}
          </StaggerReveal>
          <p
            className="fl-body"
            style={{ marginTop: 12, fontSize: 12.5, color: "var(--fl-ink-4)" }}
          >
            Available via app/webhook connector. Native two-way sync is not
            implied.
          </p>

          <nav
            aria-label="Related pages"
            className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
          >
            {[
              { label: "How lead conversion works", href: "/#how-it-works" },
              { label: "Industries", href: "/#industries" },
              { label: "Pricing", href: "/#pricing" },
              { label: "Frequently asked questions", href: "/#faq" },
              { label: "Talk to sales", href: "/contact-sales" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[13px] text-[#c3ccd9] underline decoration-[#2c384d] decoration-1 underline-offset-4 transition-colors hover:text-[var(--fl-lime)]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </Reveal>
      </div>
    </section>
  );
}
