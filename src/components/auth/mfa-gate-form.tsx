"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, QrCode } from "lucide-react";
import {
  startTotpEnrolment,
  verifyTotpChallenge,
  verifyTotpEnrolment,
} from "@/lib/auth/mfa-actions";
import {
  AuthError,
  SubmitButton,
  TextField,
} from "@/app/(auth)/_components/auth-form-parts";

type Factor = { id: string; friendlyName: string };

/**
 * The two-factor door shown between password sign-in and the app (/mfa) or
 * the operator console (/admin/mfa). `setup` enrols an authenticator app
 * (QR code plus a typed secret for people who cannot scan); `verify` asks
 * for the current code. Every step is a Server Action; nothing about the
 * factor is decided in the browser.
 */
export function MfaGateForm({
  surface,
  mode,
  next,
  factors,
}: {
  surface: "app" | "admin";
  mode: "setup" | "verify";
  next?: string;
  factors: Factor[];
}) {
  return mode === "setup" ? (
    <SetupFlow surface={surface} next={next} />
  ) : (
    <VerifyForm surface={surface} next={next} factors={factors} />
  );
}

function useLanding() {
  const router = useRouter();
  const [leaving, setLeaving] = React.useState(false);
  return {
    leaving,
    go(target: string | undefined) {
      if (!target) return;
      setLeaving(true);
      router.push(target);
      router.refresh();
    },
  };
}

function VerifyForm({
  surface,
  next,
  factors,
}: {
  surface: "app" | "admin";
  next?: string;
  factors: Factor[];
}) {
  const [error, setError] = React.useState<string | undefined>();
  const landing = useLanding();

  async function submit(formData: FormData) {
    setError(undefined);
    const result = await verifyTotpChallenge({
      surface,
      code: String(formData.get("code") ?? ""),
      factorId: String(formData.get("factorId") ?? "") || null,
      next: next ?? null,
    });
    if (result.ok) landing.go(result.redirectTo);
    else setError(result.error);
  }

  return (
    <form action={submit} className="space-y-5">
      <AuthError message={error} />
      {factors.length > 1 && (
        <div>
          <label htmlFor="mfa-factor" className="mb-2 block text-[14.5px] font-semibold text-[#f6f8fb]">
            Authenticator
          </label>
          <select
            id="mfa-factor"
            name="factorId"
            defaultValue={factors[0]?.id}
            className="h-[52px] w-full rounded-[11px] border border-[var(--auth-input-border)] bg-transparent px-4 text-[15px] text-[var(--auth-text)]"
          >
            {factors.map((factor) => (
              <option key={factor.id} value={factor.id} className="text-black">
                {factor.friendlyName}
              </option>
            ))}
          </select>
        </div>
      )}
      <TextField
        id="mfa-code"
        name="code"
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123 456"
        icon={KeyRound}
        hint="Open your authenticator app and enter the code shown for ClientTurn."
        required
      />
      <SubmitButton pendingLabel="Checking…" busy={landing.leaving}>
        Verify
      </SubmitButton>
    </form>
  );
}

function SetupFlow({ surface, next }: { surface: "app" | "admin"; next?: string }) {
  const [enrolment, setEnrolment] = React.useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [error, setError] = React.useState<string | undefined>();
  const [starting, setStarting] = React.useState(false);
  const landing = useLanding();

  async function start() {
    setError(undefined);
    setStarting(true);
    try {
      const result = await startTotpEnrolment(surface);
      if (result.ok) setEnrolment(result);
      else setError(result.error);
    } finally {
      setStarting(false);
    }
  }

  async function verify(formData: FormData) {
    if (!enrolment) return;
    setError(undefined);
    const result = await verifyTotpEnrolment({
      surface,
      factorId: enrolment.factorId,
      code: String(formData.get("code") ?? ""),
      next: next ?? null,
    });
    if (result.ok) landing.go(result.redirectTo);
    else setError(result.error);
  }

  if (!enrolment) {
    return (
      <div className="space-y-5">
        <AuthError message={error} />
        <ol className="space-y-2 text-[14px] leading-relaxed text-[var(--auth-text-muted)]">
          <li>1. Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar).</li>
          <li>2. Scan the QR code we show you, or type the key.</li>
          <li>3. Enter the 6-digit code the app shows.</li>
        </ol>
        <form action={start}>
          <SubmitButton pendingLabel="Preparing…" busy={starting}>
            Set up authenticator
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <form action={verify} className="space-y-5">
      <AuthError message={error} />
      <div className="flex flex-col items-center gap-3 rounded-[12px] border border-white/10 bg-white p-4">
        {/* An SVG data URL rendered as an image, never as markup. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={enrolment.qrCode}
          alt="QR code to add ClientTurn to your authenticator app"
          width={184}
          height={184}
        />
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-[var(--auth-text)]">
          <QrCode className="size-4" aria-hidden /> Can&apos;t scan? Enter this key instead
        </p>
        <code className="block break-all rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[13px] tracking-wider text-[var(--auth-text)] select-all">
          {enrolment.secret}
        </code>
      </div>
      <TextField
        id="mfa-enrol-code"
        name="code"
        label="6-digit code from the app"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123 456"
        icon={KeyRound}
        required
      />
      <SubmitButton pendingLabel="Checking…" busy={landing.leaving}>
        Turn on two-factor
      </SubmitButton>
      <p className="text-[12.5px] leading-relaxed text-[var(--auth-text-muted)]">
        Losing your phone means losing this code. Once you are in, add a second
        authenticator (for example a password manager) as a backup.
      </p>
    </form>
  );
}
