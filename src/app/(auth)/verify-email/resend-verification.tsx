"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { AuthError, AuthSuccess } from "../_components/auth-form-parts";

const COOLDOWN_SECONDS = 60;

export function ResendVerification({
  email,
  next = "/onboarding",
}: {
  email: string;
  /**
   * Where the confirmation link lands. Defaults to customer onboarding; the
   * partner door passes its own, so a resent link does not quietly move a
   * partner into the customer flow.
   */
  next?: string;
}) {
  const [pending, setPending] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);
  const [message, setMessage] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    if (pending || cooldown > 0 || !email) return;
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (resendError) throw resendError;
      setMessage("Verification email sent. Check your inbox.");
    } catch {
      setError("We could not send that email just now. Try again shortly.");
    } finally {
      setPending(false);
      setCooldown(COOLDOWN_SECONDS);
    }
  }

  return (
    <div className="space-y-3">
      <AuthSuccess message={message} />
      <AuthError message={error} />

      <Button
        type="button"
        variant="secondary"
        size="lg"
        fullWidth
        loading={pending}
        disabled={pending || cooldown > 0 || !email}
        onClick={resend}
      >
        {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}
      </Button>

      <p className="text-[12px] text-content-muted" aria-live="polite">
        {cooldown > 0
          ? "You can request another email once the timer finishes."
          : "Not in your inbox? Check your spam folder before resending."}
      </p>
    </div>
  );
}
