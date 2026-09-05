/** Muted "works with" strip for the auth brand panel. Lists only providers
 * ClientTurn actually integrates with — never framed as customer proof. */
const PROVIDERS = ["Meta", "Twilio", "Stripe", "Google Calendar", "Calendly"];

export function WorksWithStrip() {
  return (
    <div className="border-t border-white/8 pt-6">
      <p className="text-[11px] font-medium tracking-[0.2em] text-[var(--auth-text-subtle)] uppercase">
        Works with
      </p>
      <ul className="mt-3.5 flex flex-wrap items-center gap-x-7 gap-y-2.5">
        {PROVIDERS.map((name) => (
          <li
            key={name}
            className="text-[14.5px] font-semibold text-[var(--auth-text-subtle)]/90 opacity-80"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
