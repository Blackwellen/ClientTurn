"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Mail } from "lucide-react";
import { requestPasswordReset, type AuthResult } from "@/lib/auth/actions";
import {
  AuthError,
  AuthSuccessState,
  SubmitButton,
  TextField,
} from "../_components/auth-form-parts";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthResult | null, FormData>(
    requestPasswordReset,
    null,
  );

  const fieldError =
    state && !state.ok && state.field === "email" ? state.error : undefined;
  const formError =
    state && !state.ok && !state.field ? state.error : undefined;

  if (state?.ok) {
    return (
      <div>
        <AuthSuccessState
          title="Check your inbox"
          description="If an account exists for that email address, we'll send password reset instructions. The link will expire in 60 minutes."
        />
        <p className="mt-6 text-center text-[13.5px]">
          <Link href="/login" className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
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
        error={fieldError}
      />

      <SubmitButton pendingLabel="Sending link…">Send reset link</SubmitButton>

      <p className="text-center text-[13.5px]">
        <Link href="/login" className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
