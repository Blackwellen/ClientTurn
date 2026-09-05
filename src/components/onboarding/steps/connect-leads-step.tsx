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
import { OBadge, OButton, OField, OPanel, OSectionTitle, OSelect } from "../ui";
import type { StepActions } from "../step-types";
import { checkMetaConnection } from "@/lib/onboarding/actions";

const WHAT_HAPPENS_NEXT = [
  {
    icon: Zap,
    title: "Sync new leads automatically",
    body: "We'll pull new Facebook leads in real-time as they come in.",
  },
  {
    icon: Wand2,
    title: "Save time",
    body: "No more manual downloads or CSV files. Leads go straight into ClientTurn.",
  },
  {
    icon: Database,
    title: "Use your form data",
    body: "We'll capture available fields and map them to your ClientTurn lead fields.",
  },
  {
    icon: ShieldCheck,
    title: "Keep your data safe",
    body: "We use secure, read-only access. You can disconnect at any time.",
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

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2.5 rounded-[8px] border border-[rgba(150,170,190,0.25)] bg-[#0b141d] px-3 py-2.5">
                  <svg viewBox="0 0 36 36" className="size-6 shrink-0" aria-hidden>
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
                </div>
                <OButton
                  disabled
                  title={reason ?? "Meta connection is not available on this environment yet."}
                >
                  Connect Meta
                  <ExternalLink className="size-3.5" aria-hidden />
                </OButton>
              </div>

              <ul className="mt-3 space-y-1.5">
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
        </OPanel>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <OPanel className="bg-[#0c151d] p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#586675] text-[13px] font-semibold text-[#c1cad6]">
                2
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold text-[#f8fafc]">Select a Facebook page</h3>
                <p className="mt-0.5 text-[13px] text-[#96a1b3]">
                  Choose the page you want to receive leads from.
                </p>
                <OField className="mt-3">
                  <OSelect disabled defaultValue="">
                    <option value="">Connect Meta to choose a page</option>
                  </OSelect>
                </OField>
              </div>
            </div>
          </OPanel>

          <OPanel className="bg-[#0c151d] p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#586675] text-[13px] font-semibold text-[#c1cad6]">
                3
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold text-[#f8fafc]">Select lead forms</h3>
                <p className="mt-0.5 text-[13px] text-[#96a1b3]">
                  Choose one or more lead forms to sync.
                </p>
                <p className="mt-3 rounded-[7px] border border-dashed border-[rgba(150,170,190,0.3)] px-3 py-3 text-[12.5px] text-[#697488]">
                  No lead forms yet — connect Meta first.
                </p>
              </div>
            </div>
          </OPanel>
        </div>

        <OPanel className="bg-[#0c151d] p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#586675] text-[13px] font-semibold text-[#c1cad6]">
              4
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold text-[#f8fafc]">Map lead fields</h3>
              <p className="mt-0.5 text-[13px] text-[#96a1b3]">
                Map your Facebook form fields to ClientTurn fields. Required fields are marked.
              </p>
              <div className="mt-3 overflow-x-auto rounded-[7px] border border-[rgba(150,170,190,0.2)]">
                <table className="w-full min-w-[420px] text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[rgba(150,170,190,0.2)] text-[#7a8698]">
                      <th className="px-3 py-2 font-medium">ClientTurn field</th>
                      <th className="px-3 py-2 font-medium">Facebook form field</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Full name", true],
                      ["Phone number", true],
                      ["Email address", false],
                      ["Form ID", false],
                      ["Lead source", false],
                    ].map(([label, required]) => (
                      <tr key={label as string} className="border-b border-[rgba(150,170,190,0.1)] last:border-0">
                        <td className="px-3 py-2 text-[#dbe1ea]">
                          {label}
                          {required ? <span className="text-[var(--auth-lime)]"> *</span> : null}
                        </td>
                        <td className="px-3 py-2 text-[#697488]">—</td>
                        <td className="px-3 py-2">
                          <OBadge tone="neutral">Awaiting connection</OBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </OPanel>

        <OPanel className="bg-[#0c151d] p-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#586675] text-[13px] font-semibold text-[#c1cad6]">
                5
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
              href="/app/settings/connections"
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
