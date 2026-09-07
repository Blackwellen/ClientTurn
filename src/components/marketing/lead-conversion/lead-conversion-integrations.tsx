import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  Database,
  Megaphone,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";

/**
 * A compact, truthful integration strip — not a copy of the home page
 * marketplace.
 *
 * "Direct" means ClientTurn holds the connection itself, as listed in
 * `src/lib/integrations/catalog.ts`. "Webhook connector" means the other system
 * posts to a signed inbound endpoint we host: ClientTurn never calls out to it
 * and cannot read or write anything in it. Every entry in
 * `src/lib/integrations/apps.ts` is that second kind, so listing Pipedrive or
 * Zapier as a native integration here would be a straightforward lie.
 */
type Item = { name: string; kind: "native" | "bridge" };

const CATEGORIES: { icon: LucideIcon; title: string; items: Item[] }[] = [
  {
    icon: Megaphone,
    title: "Lead sources",
    items: [
      { name: "Meta Lead Ads", kind: "native" },
      { name: "Google Ads", kind: "native" },
      { name: "TikTok Lead Generation", kind: "native" },
      { name: "LinkedIn Lead Gen Forms", kind: "native" },
    ],
  },
  {
    icon: MessageSquare,
    title: "Communication",
    items: [
      { name: "Twilio SMS", kind: "native" },
      { name: "WhatsApp", kind: "native" },
      { name: "Email", kind: "native" },
      { name: "Slack", kind: "native" },
    ],
  },
  {
    icon: CalendarCheck,
    title: "Booking",
    items: [
      { name: "Google Calendar", kind: "native" },
      { name: "Calendly", kind: "native" },
    ],
  },
  {
    icon: Database,
    title: "CRM & automation",
    items: [
      { name: "HubSpot", kind: "native" },
      { name: "Salesforce", kind: "native" },
      { name: "Pipedrive", kind: "bridge" },
      { name: "Zapier", kind: "bridge" },
    ],
  },
];

export function LeadConversionIntegrations() {
  return (
    <section
      id="lcp-integrations"
      className="lcp-section lcp-int"
      aria-labelledby="lcp-int-title"
    >
      <span className="lcp-bloom" aria-hidden />
      <div className="lcp-shell">
        <div className="lcp-int-head">
          <span className="lcp-eyebrow">Integrations</span>
          <h2 id="lcp-int-title">
            Keep the tools around your lead journey{" "}
            <span className="lcp-accent">connected.</span>
          </h2>
          <p>
            Bring supported lead sources, communication, booking and CRM systems
            into the same operating flow.
          </p>
        </div>

        <div className="lcp-int-grid">
          {CATEGORIES.map(({ icon: Icon, title, items }) => (
            <div key={title} className="lcp-int-cat">
              <div className="lcp-int-cat-head">
                <span aria-hidden>
                  <Icon size={15} strokeWidth={2} />
                </span>
                <h3>{title}</h3>
              </div>
              <ul className="lcp-int-list">
                {items.map((item) => (
                  <li key={item.name}>
                    <b>{item.name}</b>
                    <span className="lcp-int-tag" data-kind={item.kind}>
                      {item.kind === "native" ? "Direct" : "Webhook connector"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="lcp-int-foot">
          <p>
            “Webhook connector” means the other system posts to a signed inbound
            endpoint — ClientTurn does not read or write in that account.
          </p>
          <Link href="/#integrations" className="lcp-card-link">
            See all integrations
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
