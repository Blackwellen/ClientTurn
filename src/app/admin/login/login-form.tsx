"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { adminSignIn } from "@/lib/admin/actions";
import type { AdminActionResult } from "@/lib/admin/actions";
import {
  AuthError,
  PasswordField,
  SubmitButton,
  TextField,
} from "@/app/(auth)/_components/auth-form-parts";

/**
 * Operator sign-in.
 *
 * Uses the same field and button components as the customer and partner doors,
 * so all three look like one product. What it deliberately does not borrow:
 * there is no "keep me signed in", no password reset link and no sign-up
 * switch. Operator accounts are provisioned, not self-served, and a long-lived
 * session on a platform-wide account is not a convenience worth having.
 */
export function AdminLoginForm() {
  const router = useRouter();
  const [state, action] = useActionState<AdminActionResult | null, FormData>(
    adminSignIn,
    null,
  );

  React.useEffect(() => {
    if (state?.ok && state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={action} className="space-y-5">
      <AuthError message={state && !state.ok ? state.error : undefined} />

      <TextField
        id="admin-email"
        name="email"
        label="Work email"
        type="email"
        inputMode="email"
        autoComplete="username"
        placeholder="you@clientturn.com"
        icon={Mail}
        required
      />

      <PasswordField
        id="admin-password"
        name="password"
        label="Password"
        autoComplete="current-password"
        required
      />

      <SubmitButton
        pendingLabel="Checking…"
        busy={Boolean(state?.ok && state.redirectTo)}
      >
        Sign in
      </SubmitButton>
    </form>
  );
}
