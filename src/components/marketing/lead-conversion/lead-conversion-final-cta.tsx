import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  Inbox,
  ListChecks,
  MessageSquareText,
} from "lucide-react";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { LcpCta } from "./lcp-cta";

const ROUTE = [
  { icon: Inbox, label: "Lead" },
  { icon: MessageSquareText, label: "Reply" },
  { icon: ListChecks, label: "Qualified" },
  { icon: CalendarCheck, label: "Booked" },
];

export function LeadConversionFinalCta() {
  return (
    <section
      id="lcp-final"
      className="lcp-section lcp-final"
      aria-labelledby="lcp-final-title"
    >
      <div className="lcp-shell">
        <div className="lcp-final-panel">
          <div>
            <span className="lcp-eyebrow">Start converting</span>
            <h2 id="lcp-final-title">
              Give every inbound enquiry a{" "}
              <span className="lcp-accent">clear next step.</span>
            </h2>
            <p>
              Respond, qualify, follow up and route warm leads from one
              connected ClientTurn workflow.
            </p>
            <div className="lcp-final-actions">
              <LcpCta
                placement="lead_conversion_final"
                className="lcp-btn lcp-btn-primary"
              >
                Start Free <ArrowRight size={17} aria-hidden />
              </LcpCta>
              <Link href="/contact-sales" className="lcp-btn lcp-btn-ghost">
                Contact Sales
              </Link>
            </div>
            <p className="lcp-final-note">
              {TRIAL_DAYS}-day free trial · No card required
            </p>
          </div>

          <div className="lcp-final-route">
            {ROUTE.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.label}>
                  <div className="lcp-route-step">
                    <span className="lcp-route-dot" aria-hidden>
                      <Icon size={15} strokeWidth={2} />
                    </span>
                    <b>{step.label}</b>
                  </div>
                  {i < ROUTE.length - 1 && (
                    <span className="lcp-route-line" aria-hidden />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
