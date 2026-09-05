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
} from "../_components/auth-form-parts";

export function LoginForm({
  redirectTo,
  notice,
  problem,
}: {
  redirectTo?: string;
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
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined;
  const formError =
    state && !state.ok && !state.field ? state.error : problem;

  const forgotHref = redirectTo
    ? `/forgot-password?redirect=${encodeURIComponent(redirectTo)}`
    : "/forgot-password";
  const signupHref = redirectTo
    ? `/signup?redirect=${encodeURIComponent(redirectTo)}`
    : "/signup";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}

      <AuthSuccess message={notice} />
      <AuthError message={formError} />

      <TextField
        id="email"
        name="email"
        label="Work email"
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
          href={forgotHref}
          className="text-[13.5px] font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>

      <p className="text-center text-[13.5px] text-[var(--auth-text-muted)]">
        Don&apos;t have an account?{" "}
        <Link href={signupHref} className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
