"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  removeTotpFactor,
  signOutSessions,
  startTotpEnrolment,
  verifyTotpEnrolment,
} from "@/lib/auth/mfa-actions";

export type PanelFactor = {
  id: string;
  friendlyName: string;
  createdAt: string;
  lastChallengedAt: string | null;
};

export type PanelSession = {
  id: string;
  device: string;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  isCurrent: boolean;
  twoFactor: boolean;
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

function when(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : DATE.format(date);
}

/**
 * The signed-in person's own sign-in security: authenticator apps and
 * sessions. Shared by Settings -> Security (surface "app") and the operator
 * console (surface "admin"). Every change is a Server Action that re-checks
 * the session and writes the audit log.
 */
export function AccountSecurityPanel({
  surface,
  factors,
  sessions,
  sessionsNote,
  mfaRequiredNote,
}: {
  surface: "app" | "admin";
  factors: PanelFactor[];
  sessions: PanelSession[] | null;
  /** Shown when the session list cannot be read (e.g. migration pending). */
  sessionsNote?: string;
  /** Why two-factor cannot be switched off (workspace policy or admin rule). */
  mfaRequiredNote?: string;
}) {
  return (
    <div className="space-y-5">
      <TwoFactorCard surface={surface} factors={factors} mfaRequiredNote={mfaRequiredNote} />
      <SessionsCard surface={surface} sessions={sessions} note={sessionsNote} />
    </div>
  );
}

function TwoFactorCard({
  surface,
  factors,
  mfaRequiredNote,
}: {
  surface: "app" | "admin";
  factors: PanelFactor[];
  mfaRequiredNote?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [enrolment, setEnrolment] = React.useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const enabled = factors.length > 0;
  // Where two-factor is mandatory the server refuses to remove the last
  // authenticator, so the button says so instead of failing on click.
  const lastRequired = Boolean(mfaRequiredNote) && factors.length === 1;

  async function start() {
    setError(null);
    setBusy("start");
    try {
      const result = await startTotpEnrolment(surface);
      if (result.ok) {
        setEnrolment(result);
        setCode("");
      } else setError(result.error);
    } finally {
      setBusy(null);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!enrolment) return;
    setError(null);
    setBusy("verify");
    try {
      const result = await verifyTotpEnrolment({
        surface,
        factorId: enrolment.factorId,
        code,
      });
      if (result.ok) {
        setEnrolment(null);
        toast({ variant: "success", title: "Authenticator added" });
        router.refresh();
      } else setError(result.error);
    } finally {
      setBusy(null);
    }
  }

  async function remove(factorId: string) {
    setError(null);
    setBusy(factorId);
    try {
      const result = await removeTotpFactor({ surface, factorId });
      if (result.ok) {
        toast({ variant: "success", title: "Authenticator removed" });
        router.refresh();
      } else setError(result.error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-content-muted" aria-hidden />
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            An authenticator app code is asked for at every sign-in, so a stolen password alone
            cannot open your account.
          </CardDescription>
        </div>
        <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {mfaRequiredNote ? (
          <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-[12.5px] text-content-muted">
            {mfaRequiredNote}
          </p>
        ) : null}

        {factors.length > 0 ? (
          <ul className="divide-y divide-line-subtle rounded-lg border border-line">
            {factors.map((factor) => (
              <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-content">
                    <KeyRound className="size-3.5 text-content-muted" aria-hidden />
                    {factor.friendlyName}
                  </p>
                  <p className="text-[12px] text-content-muted">
                    Added {when(factor.createdAt)}
                    {factor.lastChallengedAt ? ` · last used ${when(factor.lastChallengedAt)}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === factor.id}
                  disabled={lastRequired}
                  title={lastRequired ? "Add another authenticator before removing this one: two-factor is required." : undefined}
                  onClick={() => remove(factor.id)}
                  aria-label={
                    lastRequired
                      ? `Remove ${factor.friendlyName} (unavailable: add another authenticator first)`
                      : `Remove ${factor.friendlyName}`
                  }
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {enrolment ? (
          <form onSubmit={confirm} className="grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-[200px_1fr]">
            <div className="flex items-center justify-center rounded-lg border border-line bg-white p-2">
              {/* An SVG data URL rendered as an image, never as markup. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrolment.qrCode} alt="QR code to add ClientTurn to your authenticator app" width={180} height={180} />
            </div>
            <div className="space-y-3">
              <p className="text-[13px] text-content-secondary">
                Scan the code with your authenticator app, or type this key:
              </p>
              <code className="block break-all rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 font-mono text-[12.5px] select-all">
                {enrolment.secret}
              </code>
              <FormField label="6-digit code from the app" htmlFor={`${surface}-enrol-code`}>
                <Input
                  id={`${surface}-enrol-code`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" loading={busy === "verify"}>
                  Confirm and turn on
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setEnrolment(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <Button size="sm" variant={enabled ? "secondary" : "primary"} loading={busy === "start"} onClick={start}>
            <KeyRound className="size-3.5" aria-hidden />
            {enabled ? "Add a backup authenticator" : "Set up two-factor"}
          </Button>
        )}

        {error ? (
          <p role="alert" className="text-[12.5px] text-danger-600">
            {error}
          </p>
        ) : null}

        <p className="text-[12px] text-content-muted">
          Keep a second authenticator (for example a password manager) as a backup. If you lose
          every device, {surface === "admin"
            ? "the owner removes the factor in the Supabase dashboard (docs/security/MFA_AND_SESSIONS.md)."
            : "your workspace owner can ask ClientTurn support to remove it after confirming who you are."}
        </p>
      </CardContent>
    </Card>
  );
}

function SessionsCard({
  surface,
  sessions,
  note,
}: {
  surface: "app" | "admin";
  sessions: PanelSession[] | null;
  note?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<"others" | "global" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(scope: "others" | "global") {
    setError(null);
    setBusy(scope);
    try {
      const result = await signOutSessions({ surface, scope });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.redirectTo) {
        router.push(result.redirectTo);
        router.refresh();
        return;
      }
      toast({ variant: "success", title: "Other sessions signed out" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="size-4 text-content-muted" aria-hidden />
            Active sessions
          </CardTitle>
          <CardDescription>
            Every browser and device signed in to your account. Signing a session out ends it at
            its next request.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions && sessions.length > 0 ? (
          <ul className="divide-y divide-line-subtle rounded-lg border border-line">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-content">
                    {session.device}
                    {session.ip ? <span className="font-normal text-content-muted"> · {session.ip}</span> : null}
                  </p>
                  <p className="text-[12px] text-content-muted">
                    Signed in {when(session.createdAt)} · last active {when(session.lastActiveAt)}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {session.twoFactor ? <Badge tone="success">Two-factor</Badge> : null}
                  {session.isCurrent ? <Badge tone="info">This device</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-content-muted">
            {note ?? "No other sessions to show."}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === "others"} onClick={() => run("others")}>
            <LogOut className="size-3.5" aria-hidden />
            Sign out other sessions
          </Button>
          <Button size="sm" variant="danger" loading={busy === "global"} onClick={() => run("global")}>
            <LogOut className="size-3.5" aria-hidden />
            Sign out everywhere
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-[12.5px] text-danger-600">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
