"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updatePassword, type AuthResult } from "@/lib/auth/actions";
import {
  AuthError,
  PasswordField,
  PasswordStrength,
  SubmitButton,
} from "../_components/auth-form-parts";

type LinkState = "checking" | "valid" | "invalid";

export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const router = useRouter();
  const [linkState, setLinkState] = React.useState<LinkState>(
    hasSession ? "valid" : "checking",
  );
  const [password, setPassword] = React.useState("");
  const [state, formAction] = useActionState<AuthResult | null, FormData>(
    updatePassword,
    null,
  );

  React.useEffect(() => {
    if (hasSession) return;
    let cancelled = false;

    // Supabase may deliver the recovery grant in the URL fragment, which never
    // reaches the server. Adopt it here before deciding the link is dead.
    async function adopt() {
      const supabase = createClient();
      const hash = window.location.hash.startsWith("#")
        ? new URLSearchParams(window.location.hash.slice(1))
        : null;
      const accessToken = hash?.get("access_token");
      const refreshToken = hash?.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!cancelled) {
          window.history.replaceState(null, "", window.location.pathname);
          setLinkState(error ? "invalid" : "valid");
          if (!error) router.refresh();
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled) setLinkState(data.session ? "valid" : "invalid");
    }

    void adopt();
    return () => {
      cancelled = true;
    };
  }, [hasSession, router]);

  React.useEffect(() => {
    if (state?.ok && state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  if (linkState === "checking") {
    return (
      <p className="text-[13.5px] text-[var(--auth-text-muted)]" role="status">
        Checking your reset link…
      </p>
    );
  }

  if (linkState === "invalid") {
    return (
      <div>
        <p className="text-[22px] font-bold text-[var(--auth-text)]">Reset link expired</p>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--auth-text-muted)]">
          Request a new password reset link to continue.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 flex h-[56px] w-full items-center justify-center gap-2 rounded-[11px] text-[16px] font-bold text-[var(--auth-on-lime)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_14px_38px_rgba(168,255,31,0.28)]"
          style={{ background: "linear-gradient(135deg, var(--auth-lime-hover), var(--auth-lime))" }}
        >
          Request another link
          <ArrowRight className="size-4.5" aria-hidden />
        </Link>
      </div>
    );
  }

  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined;
  const formError =
    state && !state.ok && !state.field ? state.error : undefined;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <AuthError message={formError} />

      <div>
        <PasswordField
          id="password"
          name="password"
          label="New password"
          autoComplete="new-password"
          required
          value={password}
          onChange={setPassword}
          error={fieldError("password")}
        />
        <PasswordStrength value={password} />
      </div>

      <PasswordField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        required
        error={fieldError("confirmPassword")}
      />

      <SubmitButton pendingLabel="Updating…">Reset password</SubmitButton>

      <p className="text-center text-[13.5px]">
        <Link href="/login" className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
