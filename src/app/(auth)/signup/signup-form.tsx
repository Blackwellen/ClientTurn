"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Mail, User } from "lucide-react";
import { signUp, type AuthResult } from "@/lib/auth/actions";
import {
  ATTRIBUTION_FIELDS,
  captureAttribution,
} from "@/lib/marketing/attribution";
import {
  AuthError,
  PasswordField,
  PasswordRequirements,
  SubmitButton,
  TextField,
} from "../_components/auth-form-parts";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

export function SignupForm({ plan = null, referral = null }: { plan?: string | null; referral?: string | null }) {
  const router = useRouter();
  const [state, formAction] = useActionState<AuthResult | null, FormData>(
    signUp,
    null,
  );
  const [password, setPassword] = React.useState("");

  // Attribution is attached at submit time so no effect has to mirror storage
  // into React state.
  function submit(formData: FormData) {
    const attribution = captureAttribution();
    for (const field of ATTRIBUTION_FIELDS) {
      formData.set(field, attribution[field] ?? "");
    }
    formAction(formData);
  }

  React.useEffect(() => {
    if (state?.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined;
  const formError =
    state && !state.ok && !state.field ? state.error : undefined;

  return (
    <form action={submit} className="space-y-5" noValidate>
      {plan && <input type="hidden" name="plan" value={plan} />}
      {/* The partner referral carried in the URL, for a visitor without cookie consent. */}
      {referral && <input type="hidden" name="ct_ref" value={referral} />}
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
        label="Work email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@yourbusiness.co.uk"
        icon={Mail}
        required
        error={fieldError("email")}
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
        <PasswordRequirements value={password} />
      </div>

      <div>
        <div className="flex items-start gap-3">
          <input
            id="terms"
            name="terms"
            type="checkbox"
            className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded-[5px] border border-white/25 bg-[var(--auth-input-bg)] accent-[var(--auth-lime)]"
            aria-invalid={fieldError("terms") ? true : undefined}
            aria-describedby={fieldError("terms") ? "terms-error" : undefined}
          />
          <label htmlFor="terms" className="text-[13.5px] leading-snug text-[var(--auth-text-muted)]">
            I agree to the{" "}
            <Link href="/terms" className="font-medium text-[var(--auth-lime)] underline-offset-4 hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium text-[var(--auth-lime)] underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            .
          </label>
        </div>
        {fieldError("terms") && (
          <p id="terms-error" className="mt-1.5 text-[12.5px] text-[var(--auth-danger-text)]">
            {fieldError("terms")}
          </p>
        )}
      </div>

      <SubmitButton pendingLabel="Creating account…" busy={Boolean(state?.ok && state.redirectTo)}>Create your account</SubmitButton>

      <GoogleSignInButton
        audience="customer"
        variant="signup"
        // Carries the plan chosen on the pricing page through Google, so a new
        // account lands on trial checkout with it already picked.
        // The partner referral rides along too, so a Google signup without
        // cookie consent is still credited (read back in the callback).
        redirectTo={googleRedirect(plan, referral)}
      />

      <p className="text-center text-[13.5px] text-[var(--auth-text-muted)]">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

/** The Google return path: the picked plan and any URL-carried partner referral. */
function googleRedirect(plan: string | null, referral: string | null): string | undefined {
  if (!plan && !referral) return undefined;
  const params = new URLSearchParams();
  if (plan) params.set("plan", plan);
  if (referral) params.set("ct_ref", referral);
  return `/start-trial?${params.toString()}`;
}
