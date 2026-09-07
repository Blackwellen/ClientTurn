"use client";

import * as React from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

/**
 * "Continue with Google" for the customer and partner doors.
 *
 * The redirect goes to `/auth/callback`, which already performs the PKCE code
 * exchange, activates any pending invite and works out where the person should
 * land — so this button adds a provider, not a second sign-in pathway.
 *
 * Deliberately absent from the operator door: `/admin/login` is an internal
 * entrance whose whole security model is a password plus step-up on every
 * mutation, and delegating that to a third party would weaken it.
 *
 * Branding follows Google's identity guidelines: their own mark, unmodified,
 * on a white surface with the sanctioned wording. The mark is not recoloured,
 * cropped or set on the lime — doing so is both a trademark problem and the
 * usual reason these buttons look counterfeit.
 */
export function GoogleAuthButton({
  label,
  next,
  className,
}: {
  /** Google permits "Sign in with", "Sign up with" or "Continue with". */
  label: "Sign in with Google" | "Sign up with Google" | "Continue with Google";
  /** Where to land after the exchange. The callback decides if omitted. */
  next?: string;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const callback = new URL("/auth/callback", window.location.origin);
      if (next) callback.searchParams.set("next", next);

      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback.toString(),
          // Always let someone choose which Google account to use; silently
          // reusing the one already in the browser is how people end up in
          // the wrong workspace.
          queryParams: { prompt: "select_account" },
        },
      });

      if (authError) {
        setBusy(false);
        setError(
          "Google sign-in is not available right now. Use your email and password below.",
        );
      }
      // On success the browser navigates to Google, so `busy` stays true.
    } catch {
      setBusy(false);
      setError(
        "Google sign-in is not available right now. Use your email and password below.",
      );
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-[12px] border border-[#747775]/25 bg-white px-4 text-[15px] font-medium text-[#1f1f1f] transition-[background-color,box-shadow] hover:bg-[#f7f8f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)] disabled:cursor-not-allowed disabled:opacity-70"
      >
        <Image
          src="/brands/google.svg"
          alt=""
          width={20}
          height={20}
          className="size-5 shrink-0"
        />
        {busy ? "Redirecting to Google…" : label}
      </button>

      {error && (
        <p role="alert" className="mt-2.5 text-[13px] text-[#ff9aa5]">
          {error}
        </p>
      )}
    </div>
  );
}

/** The "OR" rule between the password form and the provider button. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-4" aria-hidden>
      <span className="h-px flex-1 bg-white/12" />
      <span className="text-[12px] font-semibold tracking-[0.14em] text-[var(--auth-text-subtle)] uppercase">
        or
      </span>
      <span className="h-px flex-1 bg-white/12" />
    </div>
  );
}
