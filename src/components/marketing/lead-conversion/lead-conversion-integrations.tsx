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
 * "Direct" means the customer can connect it themselves, right now, with no
 * one from Client Turn involved — either a self-serve OAuth redirect or a
 * self-serve pasted-credential dialog, both `connectionMethod` values in
 * `src/lib/integrations/catalog.ts` for an entry with `connectPath` set
 * (OAuth) or `connectionMethod: "token"` (paste, e.g. HubSpot's own private
 * app / service key token). "Webhook connector" means the other system posts
 * to a signed inbound endpoint we host: ClientTurn never calls out to it and
 * cannot read or write anything in it. Every entry in
 * `src/lib/integrations/apps.ts` is that second kind, so listing Pipedrive or
 * Zapier as a native integration here would be a straightforward lie.
 *
 * "Team-assisted" is for a catalog entry that is genuinely not self-serve
 * yet — `connectPath: null` *and* no token-paste dialog either, so the
 * connection can only be made by hand today. Labelling one of those
 * "native"/"Direct" would overstate parity with the providers that actually
 * have a working self-serve flow.
 *
 * Salesforce is the one exception worth calling out: it has a real
 * `connectPath` and real platform credentials as of 2026-09-13, so by the
 * letter of the rule above it qualifies as "native". It stays "assisted"
 * anyway, on the same precedent this project already applied to Meta before
 * that integration went live — a working adapter plus configured credentials
 * is not the same claim as a flow that has actually moved a lead into a real
 * org. Move it to "native" once someone has connected one real Salesforce
 * account and confirmed a lead lands there, not before.
 */
type Item = { name: string; kind: "native" | "bridge" | "assisted" };

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
      { name: "Zoho CRM", kind: "native" },
      { name: "Salesforce", kind: "assisted" },
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
            Lead sources, messaging, booking and CRM in one flow.
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
                      {item.kind === "native"
                        ? "Direct"
                        : item.kind === "assisted"
                          ? "Team-assisted"
                          : "Webhook connector"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="lcp-int-foot">
          <p>
            “Webhook connector”: the other system posts to our signed endpoint;
            we never read or write in that account. “Team-assisted”: no self-serve
            connect yet, so our team sets it up.
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
