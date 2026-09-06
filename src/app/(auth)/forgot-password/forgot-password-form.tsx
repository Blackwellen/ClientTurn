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

function BackToSignIn() {
  return (
    <p className="text-center text-[13.5px]">
      <Link
        href="/login"
        className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </p>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthResult | null, FormData>(
    requestPasswordReset,
    null,
  );

  const fieldError =
    state && !state.ok && state.field === "email" ? state.error : undefined;
  const formError =
    state && !state.ok && !state.field ? state.error : undefined;

  // The response is deliberately identical whether or not the address is
  // registered, so this never confirms that an account exists.
  if (state?.ok) {
    return (
      <div>
        <AuthSuccessState
          title="Check your inbox"
          description="If an account exists for that email address, we've sent password reset instructions. The link can only be used once, and expires after a short time."
        />
        <div className="mt-7">
          <BackToSignIn />
        </div>
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

      <div className="border-t border-white/8 pt-6">
        <AuthSuccessState
          title="Check your inbox"
          description="We'll send a secure reset link to your work email. It can only be used once, and expires after a short time."
          tone="info"
        />
      </div>

      <BackToSignIn />
    </form>
  );
}
