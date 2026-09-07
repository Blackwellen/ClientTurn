import Image from "next/image";
import { brandMarkSrc } from "@/lib/integrations/brand-marks";
import type { ProviderType } from "@/lib/integrations/catalog";

/**
 * The "works with" strip on the auth brand panel.
 *
 * Every entry is a provider ClientTurn genuinely integrates with, named from
 * the connection catalogue, and carrying that provider's own mark from
 * `public/brands/` — the same assets Settings → Connections uses, so the two
 * surfaces cannot drift apart. The marks identify their provider; they are the
 * trademark of their owners and are never presented as an endorsement, which
 * is why the heading reads "Works with" and no logo is scaled up or given
 * prominence over the others.
 *
 * Marks are supplied as single-colour SVGs on a light tile so a brand's own
 * colours stay legible against the dark panel without recolouring the mark.
 */
const PROVIDERS: { name: string; provider: ProviderType }[] = [
  { name: "Meta", provider: "meta" },
  { name: "Twilio", provider: "twilio_sms" },
  { name: "Google Calendar", provider: "google_calendar" },
  { name: "Calendly", provider: "calendly" },
];

export function WorksWithStrip() {
  return (
    <div className="border-t border-white/8 pt-7">
      <p className="text-[11.5px] font-semibold tracking-[0.22em] text-[var(--auth-text-subtle)] uppercase">
        Works with
      </p>
      {/* Four labelled marks, on one line. The name sits beside its logo
          rather than in a tooltip: a mark alone asks the reader to recognise a
          glyph, and the point of this strip is to say plainly which systems
          ClientTurn connects to. Four is what fits the column at this size. */}
      <ul className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3.5">
        {PROVIDERS.map(({ name, provider }) => {
          const src = brandMarkSrc(provider);
          return (
            <li
              key={name}
              className="group flex shrink-0 items-center gap-2.5 text-[14.5px] font-semibold whitespace-nowrap text-[#8b97a8] transition-colors duration-200 hover:text-[#c3cddb]"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-200"
                style={{
                  background: "rgba(255,255,255,0.94)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {src && (
                  <Image
                    src={src}
                    alt=""
                    width={20}
                    height={20}
                    className="size-5 object-contain"
                  />
                )}
              </span>
              {name}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
