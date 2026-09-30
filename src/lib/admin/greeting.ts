/**
 * The Overview greeting, in platform time (Europe/London) so the first paint
 * is stable across renders. Greets the operator by first name; falls back to
 * "Admin" only when the profile has none (it used to say "Admin" for everyone).
 */
const PLATFORM_TZ = "Europe/London";

export function adminGreeting(now: Date, firstName: string | null | undefined): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: PLATFORM_TZ, hour: "2-digit", hour12: false }).format(now),
  );
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = firstName?.trim().slice(0, 40);
  return `${part}, ${name || "Admin"}`;
}
