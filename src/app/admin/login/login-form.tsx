"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { adminSignIn } from "@/lib/admin/actions";
import type { AdminActionResult } from "@/lib/admin/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg bg-white px-3 text-[13px] font-semibold text-[#0B1020] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
    >
      {pending ? "Checking…" : "Sign in"}
    </button>
  );
}

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
    <form action={action} className="mt-4 space-y-3">
      {state && !state.ok && (
        <p
          role="alert"
          className="border-danger-500/30 bg-danger-500/10 text-danger-200 rounded-lg border px-3 py-2 text-[13px]"
        >
          {state.error}
        </p>
      )}

      <div>
        <label
          htmlFor="admin-email"
          className="block text-[12px] font-medium text-white/70"
        >
          Work email
        </label>
        <input
          id="admin-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-[13px] text-white placeholder:text-white/30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/40"
        />
      </div>

      <div>
        <label
          htmlFor="admin-password"
          className="block text-[12px] font-medium text-white/70"
        >
          Password
        </label>
        <input
          id="admin-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-[13px] text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/40"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
