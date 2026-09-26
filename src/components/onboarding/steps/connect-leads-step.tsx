"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleDashed,
  Database,
  ExternalLink,
  ListChecks,
  ShieldCheck,
  Wand2,
  Zap,
} from "lucide-react";
import { OBadge, OButton, OPanel, OSectionTitle } from "../ui";
import type { StepActions } from "../step-types";
import { checkMetaConnection } from "@/lib/onboarding/actions";

const META_CONNECT_HREF = "/api/integrations/meta/connect?return=/onboarding";

const WHAT_HAPPENS_NEXT = [
  {
    icon: Zap,
    title: "Sync new leads automatically",
    body: "New Facebook and Instagram form leads arrive within seconds of being submitted.",
  },
  {
    icon: Wand2,
    title: "Save time",
    body: "No more manual downloads or CSV files. Leads go straight into ClientTurn.",
  },
  {
    icon: Database,
    title: "Use your form data",
    body: "Every answer on the form is captured and mapped automatically. Nothing to set up.",
  },
  {
    icon: ShieldCheck,
    title: "Keep your data safe",
    body: "Access tokens are held server-side only. You can disconnect at any time.",
  },
];

export function ConnectLeadsStep({
  onContinue,
  onSaveExit,
  onRegisterActions,
}: {
  onContinue: () => void;
  onSaveExit: () => void;
  onRegisterActions: (actions: StepActions) => void;
}) {
  const [status, setStatus] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    checkMetaConnection().then((result) => {
      if (!active) return;
      if (result.ok) {
        setStatus(result.status);
        setReason(result.reason);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function runTest() {
    setChecking(true);
    try {
      const result = await checkMetaConnection();
      if (result.ok) {
        setStatus(result.status);
        setReason(result.reason);
      }
    } finally {
      setChecking(false);
    }
  }

  React.useEffect(() => {
    onRegisterActions({ continue: onContinue, saveExit: onSaveExit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = status === "HEALTHY" || status === "DEGRADED" || status === "ACTION_REQUIRED";
  // A reason is only set when the platform cannot offer Meta (credentials not
  // configured, or not on the plan). Null with a status means it can.
  const available = status !== null && !reason;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.9fr_1fr]">
      <div className="space-y-4">
        <OPanel className="bg-[#0c151d] p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--auth-lime)] text-[13px] font-semibold text-[var(--auth-lime)]">
              1
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold text-[#f8fafc]">
                Connect your Meta account
              </h3>
              <p className="mt-0.5 text-[13px] text-[#96a1b3]">
                Securely connect your Facebook account to access your pages and lead forms.
              </p>

              <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3 rounded-[8px] border border-[rgba(150,170,190,0.25)] bg-[#0b141d] px-3 py-2.5">
                  <svg viewBox="0 0 36 36" className="size-7 shrink-0" aria-hidden>
                    <circle cx="18" cy="18" r="18" fill="#0866FF" />
                    <path
                      d="M20.7 23.5v-7.1h2.4l.35-2.8h-2.75v-1.8c0-.8.23-1.35 1.37-1.35h1.47v-2.5A19.6 19.6 0 0 0 21.7 7c-2.42 0-4.08 1.48-4.08 4.2v2.34H14.9v2.8h2.72v7.15h3.08Z"
                      fill="#fff"
                    />
                  </svg>
                  <div>
                    <p className="text-[13.5px] font-medium text-[#f0f3f8]">Meta</p>
                    <p className="text-[12px] text-[#8c98ab]">Connect your Facebook account</p>
                  </div>
                  {connected ? (
                    <OBadge tone="success">Connected</OBadge>
                  ) : available ? (
                    // A full navigation, not a fetch: the connect route mints
                    // the OAuth state server-side and redirects to Meta, and
                    // `return=/onboarding` brings the person back here.
                    <a
                      href={META_CONNECT_HREF}
                      className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--auth-lime)] px-3.5 text-[13px] font-semibold text-[#0b1020] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]"
                    >
                      Connect Meta
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ) : (
                    <OButton disabled className="ml-1" title={reason ?? undefined}>
                      Not available yet
                    </OButton>
                  )}
                </div>

                <ul className="space-y-1.5 lg:shrink-0">
                  {[
                    "We only access your pages and lead forms",
                    "Your data is secure and encrypted",
                    "You can disconnect at any time",
                  ].map((line) => (
                    <li key={line} className="flex items-center gap-2 text-[12.5px] text-[#96a1b3]">
                      <CheckCircle2 className="size-3.5 shrink-0 text-[var(--auth-lime)]" aria-hidden />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </OPanel>

        <OPanel className="bg-[#0c151d] p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#586675] text-[13px] font-semibold text-[#c1cad6]">
              2
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold text-[#f8fafc]">
                Pages, forms and fields are set up for you
              </h3>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[#96a1b3]">
                There is nothing to map. ClientTurn picks the Page you manage (preferring
                one linked to Instagram), finds every lead form on it, and maps each
                answer automatically: name, email and phone go to the lead, and every
                other question is kept as an answer on the lead. To use a different Page,
                choose it later in Settings &rarr; Connections &rarr; Meta Lead Ads.
              </p>
            </div>
          </div>
        </OPanel>

        <OPanel className="bg-[#0c151d] p-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#586675] text-[13px] font-semibold text-[#c1cad6]">
                3
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-[#f8fafc]">Verify connection</h3>
                <p className="mt-0.5 text-[13px] text-[#96a1b3]">
                  We&rsquo;ll test your connection and make sure we can pull leads successfully.
                </p>
              </div>
            </div>
            <OButton variant="secondary" onClick={runTest} loading={checking} disabled={!connected}>
              <ListChecks className="size-3.5" aria-hidden />
              Run connection test
            </OButton>
          </div>
        </OPanel>
      </div>

      <div className="space-y-4">
        <div>
          <OSectionTitle hint="Your Meta connection status and permissions.">
            Connection health
          </OSectionTitle>
          <OPanel className="flex items-center gap-2.5 bg-[#0c151d]">
            <CircleDashed className="size-4 shrink-0 text-[#7a8698]" aria-hidden />
            <div>
              <p className="text-[13.5px] font-medium text-[#f0f3f8]">
                {connected ? "Connected" : "Not connected"}
              </p>
              <p className="text-[12.5px] text-[#8c98ab]">
                {reason ?? "Connect your Meta account to continue."}
              </p>
            </div>
          </OPanel>
        </div>

        <div>
          <OSectionTitle hint="Once connected, we will:">What happens next?</OSectionTitle>
          <ul className="space-y-3">
            {WHAT_HAPPENS_NEXT.map((item) => (
              <li key={item.title} className="flex items-start gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[rgba(168,255,31,0.1)] text-[var(--auth-lime)]">
                  <item.icon className="size-3.5" aria-hidden />
                </span>
                <div>
                  <p className="text-[13.5px] font-medium text-[#f0f3f8]">{item.title}</p>
                  <p className="text-[12.5px] text-[#8c98ab]">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <OPanel className="bg-[#0c151d]">
          <p className="text-[13px] font-medium text-[#f0f3f8]">Need help?</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#8c98ab]">
            You do not need Meta connected to finish setup — continue now and connect it any
            time from{" "}
            <Link
              href="/app/settings?section=connections"
              className="font-medium text-[var(--auth-lime)] underline-offset-2 hover:underline"
            >
              Settings → Connections
            </Link>
            .
          </p>
        </OPanel>
      </div>
    </div>
  );
}
