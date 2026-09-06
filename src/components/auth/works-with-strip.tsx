import {
  CalendarCheck2,
  CalendarDays,
  CreditCard,
  Megaphone,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";

/** Muted "works with" strip for the auth brand panel. Lists only providers
 * ClientTurn actually integrates with — never framed as customer proof, and
 * never using a partner's trademark as an endorsement. */
const PROVIDERS: { name: string; icon: LucideIcon }[] = [
  { name: "Meta", icon: Megaphone },
  { name: "Twilio", icon: MessageSquare },
  { name: "Stripe", icon: CreditCard },
  { name: "Google Calendar", icon: CalendarDays },
  { name: "Calendly", icon: CalendarCheck2 },
];

export function WorksWithStrip() {
  return (
    <div className="border-t border-white/8 pt-7">
      <p className="text-[11.5px] font-semibold tracking-[0.22em] text-[var(--auth-text-subtle)] uppercase">
        Works with
      </p>
      <ul className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-3">
        {PROVIDERS.map(({ name, icon: Icon }) => (
          <li
            key={name}
            className="group flex items-center gap-2.5 text-[15px] font-semibold text-[#8b97a8] transition-colors duration-200 hover:text-[#c3cddb]"
          >
            {/* Neutral glyph in a tinted tile — never a reproduced brand mark. */}
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-[#9aa7b8] transition-colors duration-200 group-hover:text-[var(--auth-lime)]"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <Icon className="size-4" strokeWidth={2} aria-hidden />
            </span>
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
