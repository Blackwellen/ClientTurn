"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Mail, User } from "lucide-react";
import {
  signUpPartner,
  type PartnerSignUpResult,
} from "@/lib/affiliates/signup-actions";
import {
  AuthError,
  PasswordField,
  PasswordRequirements,
  SubmitButton,
  TextField,
} from "@/app/(auth)/_components/auth-form-parts";

/**
 * Partner account creation.
 *
 * The customer signup form asks for a business name because it provisions a
 * workspace. This one does not: a partner has no workspace, and asking for one
 * would create an expectation the portal never meets.
 */
export function PartnerSignUpForm() {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [state, formAction] = useActionState<PartnerSignUpResult | null, FormData>(
    signUpPartner,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) router.push(state.redirectTo);
  }, [state, router]);

  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined;
  const formError = state && !state.ok && !state.field ? state.error : undefined;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <AuthError message={formError} />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id="firstName"
          name="firstName"
          label="First name"
          autoComplete="given-name"
          placeholder="John"
          icon={User}
          required
          error={fieldError("firstName")}
        />
        <TextField
          id="lastName"
          name="lastName"
          label="Last name"
          autoComplete="family-name"
          placeholder="Smith"
          icon={User}
          required
          error={fieldError("lastName")}
        />
      </div>

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
        hint="We send your application decision and payout notices here."
      />

      <div>
        <PasswordField
          id="password"
          name="password"
          label="Password"
          autoComplete="new-password"
          required
          value={password}
          onChange={setPassword}
          error={fieldError("password")}
        />
        <div className="mt-3">
          <PasswordRequirements value={password} />
        </div>
      </div>

      <label className="flex items-start gap-3 text-[13.5px] leading-relaxed text-[var(--auth-text-muted)]">
        <input
          type="checkbox"
          name="terms"
          required
          className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded-[5px] border border-white/25 bg-[var(--auth-input-bg)] accent-[var(--auth-lime)]"
        />
        <span>
          I agree to the{" "}
          <Link
            href="/terms"
            className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
          >
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {fieldError("terms") && (
        <p className="text-[12.5px] text-[var(--auth-danger-text)]">
          {fieldError("terms")}
        </p>
      )}

      <SubmitButton
        pendingLabel="Creating your account…"
        busy={Boolean(state?.ok)}
      >
        Create partner account
      </SubmitButton>

      <p className="text-center text-[13px] leading-relaxed text-[var(--auth-text-subtle)]">
        Creating an account does not start a subscription. You will be asked a
        few questions about your audience, then a person reviews your
        application.
      </p>

      <p className="text-center text-[13.5px] text-[var(--auth-text-muted)]">
        Already a partner?{" "}
        <Link
          href="/affiliates/login"
          className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>

      <p className="text-center text-[13px] text-[var(--auth-text-muted)]">
        Looking for your own workspace?{" "}
        <Link
          href="/signup"
          className="font-medium underline underline-offset-4 hover:text-[var(--auth-text)]"
        >
          Customer sign up
        </Link>
      </p>
    </form>
  );
}
