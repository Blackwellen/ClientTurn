/**
 * Google sign-in entry point.
 *
 * Deliberately a plain link, not a widget: the whole point of this build is a
 * full-page redirect through this app's own `/api/auth/google/connect` route
 * (see `src/lib/auth/google-login.ts` for why), not an embedded Google
 * Identity Services button. Clicking it leaves the page like any other OAuth
 * connect button already in this codebase (Calendly, Google Calendar, Slack).
 *
 * Signup is open, so Google both signs in and registers: a new customer gets a
 * workspace and goes to the trial checkout, an existing one signs in (see the
 * callback route). The Terms are accepted at Checkout either way.
 *
 * A plain <a>, not next/link: <Link> prefetches visible links, and prefetching
 * a route handler that redirects to Google started an OAuth round trip (and a
 * CORS error in the console) on every sign-in and sign-up page load.
 */
export function GoogleSignInButton({
  redirectTo,
  audience = "customer",
  variant = "signin",
}: {
  redirectTo?: string;
  audience?: "customer" | "affiliate";
  /** "signin" sits on a login form; "signup" sits on a signup form. */
  variant?: "signin" | "signup";
}) {
  const params = new URLSearchParams({ aud: audience });
  if (redirectTo) params.set("redirect", redirectTo);
  const href = `/api/auth/google/connect?${params.toString()}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[12px] font-medium tracking-wide text-[var(--auth-text-subtle)] uppercase">
          Or
        </span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <a
        href={href}
        className="flex h-[52px] w-full items-center justify-center gap-3 rounded-[11px] border border-white/15 bg-white/[0.03] text-[15px] font-semibold text-[var(--auth-text)] transition-colors hover:border-white/25 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]"
      >
        <GoogleMark />
        {variant === "signup" ? "Sign up with Google" : "Continue with Google"}
      </a>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.61Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.69A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.69V4.98H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.02l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.98l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}
