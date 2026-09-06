"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Mail } from "lucide-react";
import { signIn, type AuthResult } from "@/lib/auth/actions";
import {
  AuthError,
  AuthSuccess,
  PasswordField,
  SubmitButton,
  TextField,
} from "@/app/(auth)/_components/auth-form-parts";

/**
 * Partner sign-in.
 *
 * Deliberately the same `signIn` action as the customer login — one credential
 * store, one rate limiter, one set of error semantics. The only difference is
 * where it lands and what it offers someone without an account: the partner
 * programme, not customer signup.
 */
export function AffiliateLoginForm({
  redirectTo,
  notice,
  problem,
}: {
  redirectTo: string;
  notice?: string;
  problem?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<AuthResult | null, FormData>(
    signIn,
    null,
  );

  React.useEffect(() => {
    if (state?.ok && state.redirectTo) {
      router.replace(state.redirectTo);
    }
  }, [state, router]);

  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined;
  const formError = state && !state.ok && !state.field ? state.error : problem;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="redirect" value={redirectTo} />

      <AuthSuccess message={notice} />
      <AuthError message={formError} />

      <TextField
        id="email"
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@yourbusiness.co.uk"
        icon={Mail}
        required
        error={fieldError("email")}
      />

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        required
        error={fieldError("password")}
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2.5 text-[13.5px] text-[var(--auth-text-muted)]">
          <input
            type="checkbox"
            name="keepSignedIn"
            className="size-[18px] cursor-pointer rounded-[5px] border border-white/25 bg-[var(--auth-input-bg)] accent-[var(--auth-lime)]"
          />
          Keep me signed in
        </label>
        <Link
          href="/forgot-password"
          className="text-[13.5px] font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <SubmitButton
        pendingLabel="Signing in…"
        busy={Boolean(state?.ok && state.redirectTo)}
      >
        Sign in to partner portal
      </SubmitButton>

      <p className="text-center text-[13.5px] text-[var(--auth-text-muted)]">
        Not a partner yet?{" "}
        <Link
          href="/affiliates"
          className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
        >
          Apply to join
        </Link>
      </p>

      <p className="text-center text-[13px] text-[var(--auth-text-muted)]">
        Looking for your own workspace?{" "}
        <Link
          href="/login"
          className="font-medium underline underline-offset-4 hover:text-[var(--auth-text)]"
        >
          Customer sign in
        </Link>
      </p>
    </form>
  );
}
