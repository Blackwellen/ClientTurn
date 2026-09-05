"use client";

import * as React from "react";
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Filter,
  MessageCircle,
  Play,
  Rocket,
  Users,
  Wifi,
  XCircle,
} from "lucide-react";
import { OBadge, OButton, OField, OInput, OPanel, OSectionTitle, OSelect } from "../ui";
import type { StepActions } from "../step-types";
import type { ActivationCheck } from "@/lib/onboarding/provision";
import type { TestLeadOutcome } from "@/lib/onboarding/test-lead";

const HEALTH_ROWS: { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "lead_source", label: "Meta Leads", icon: Wifi },
  { key: "messaging", label: "Messaging", icon: MessageCircle },
  { key: "qualification", label: "Qualification", icon: Filter },
  { key: "booking", label: "Booking System", icon: Calendar },
];

const JOURNEY_STAGES = [
  { key: "received", label: "Lead received" },
  { key: "reply", label: "Auto-reply sent" },
  { key: "qualified", label: "Qualified" },
  { key: "booking", label: "Booking ready" },
  { key: "complete", label: "Test complete" },
];

function checkStatus(check: ActivationCheck | undefined) {
  if (!check) return { label: "Unknown", tone: "neutral" as const };
  if (check.passed) return { label: "Ready", tone: "success" as const };
  return { label: check.blocking ? "Action required" : "Optional", tone: check.blocking ? "danger" as const : "warning" as const };
}

export function TestGoLiveStep({
  checks,
  services,
  defaultPhone,
  initialOutcome,
  onRunTest,
  onReadTest,
  onGoLive,
  onSaveExit,
  onRegisterActions,
  goLivePending,
}: {
  checks: ActivationCheck[];
  services: { id: string; name: string }[];
  defaultPhone: string;
  initialOutcome: TestLeadOutcome | null;
  onRunTest: (input: { name: string; phone: string; serviceId: string; message: string }) => Promise<{
    ok: boolean;
    outcome?: TestLeadOutcome | null;
    error?: string;
  }>;
  onReadTest: () => Promise<{ ok: boolean; outcome?: TestLeadOutcome | null }>;
  onGoLive: () => void;
  onSaveExit: () => void;
  onRegisterActions: (actions: StepActions) => void;
  goLivePending: boolean;
}) {
  const [name, setName] = React.useState("James Miller");
  const [phone, setPhone] = React.useState(defaultPhone || "+44 7700 900123");
  const [serviceId, setServiceId] = React.useState(services[0]?.id ?? "");
  const [message, setMessage] = React.useState("Hi, I'm interested in getting a quote.");
  const [running, setRunning] = React.useState(false);
  const [outcome, setOutcome] = React.useState<TestLeadOutcome | null>(initialOutcome);
  const [error, setError] = React.useState<string | null>(null);

  const blocking = checks.filter((c) => c.blocking && !c.passed);
  const allReady = blocking.length === 0;

  React.useEffect(() => {
    onRegisterActions({
      continue: onGoLive,
      saveExit: onSaveExit,
      disabledReason: allReady ? undefined : "Complete every required step before going live.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady]);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const result = await onRunTest({ name, phone, serviceId, message });
      if (!result.ok) {
        setError(result.error ?? "Could not run the test lead.");
        return;
      }
      setOutcome(result.outcome ?? null);
      for (let i = 0; i < 6; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const next = await onReadTest();
        if (next.ok && next.outcome) {
          setOutcome(next.outcome);
          if (next.outcome.messages.length > 0) break;
        }
      }
    } finally {
      setRunning(false);
    }
  }

  const sent = outcome?.messages.find((m) => m.status === "SENT" || m.status === "DELIVERED");
  const failed = outcome?.messages.find((m) => m.status === "FAILED");
  const stageIndex = !outcome
    ? -1
    : failed
      ? 1
      : sent
        ? outcome.status === "QUALIFIED" || outcome.status === "BOOKED"
          ? outcome.status === "BOOKED"
            ? 3
            : 2
          : 1
        : 0;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.3fr_0.9fr]">
      <div>
        <OSectionTitle hint="All systems must be ready before going live.">
          Activation checklist
        </OSectionTitle>
        <ul className="space-y-1.5">
          {checks.map((check) => {
            const status = checkStatus(check);
            return (
              <li
                key={check.key}
                className="flex items-center justify-between gap-3 rounded-[7px] border border-[rgba(150,170,190,0.16)] bg-[#0b141d] px-3 py-2"
              >
                <span className="flex items-center gap-2 text-[13px] text-[#dbe1ea]">
                  {check.passed ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-[var(--auth-lime)]" aria-hidden />
                  ) : (
                    <XCircle
                      className={`size-3.5 shrink-0 ${check.blocking ? "text-[#ff6b70]" : "text-[#ffb020]"}`}
                      aria-hidden
                    />
                  )}
                  {check.label}
                </span>
                <OBadge tone={status.tone}>{status.label}</OBadge>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-4">
        <div>
          <OSectionTitle hint="This will create a test lead and run it through your full ClientTurn system, following the same path as a real lead. Test leads are excluded from analytics.">
            Send a test lead
          </OSectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <OField label="Name">
              <OInput value={name} onChange={(e) => setName(e.target.value)} />
            </OField>
            <OField label="Phone number">
              <OInput value={phone} onChange={(e) => setPhone(e.target.value)} />
            </OField>
            <OField label="Service">
              <OSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                {services.length === 0 && <option value="">No services configured</option>}
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </OSelect>
            </OField>
            <OField label="Message (optional)">
              <OInput value={message} onChange={(e) => setMessage(e.target.value)} />
            </OField>
          </div>
          <OButton className="mt-3 w-full" onClick={run} loading={running}>
            <Play className="size-3.5" aria-hidden />
            {outcome ? "Run test lead again" : "Run test lead"}
          </OButton>
          {error && <p className="mt-1.5 text-[12.5px] text-[#ff6b70]">{error}</p>}
        </div>

        <div>
          <OSectionTitle hint="See your test lead travel through the same internal process as a real lead.">
            Test lead journey
          </OSectionTitle>
          <div className="flex items-start justify-between gap-1 overflow-x-auto pb-1">
            {JOURNEY_STAGES.map((stage, i) => {
              const reached = i <= stageIndex;
              const isFailure = failed && i === 1;
              return (
                <div key={stage.key} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 ${
                      isFailure
                        ? "border-[#ff6b70] text-[#ff6b70]"
                        : reached
                          ? "border-[var(--auth-lime)] text-[var(--auth-lime)]"
                          : "border-[#4a5568] text-[#5c6981]"
                    }`}
                  >
                    {isFailure ? (
                      <XCircle className="size-4" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-4" aria-hidden />
                    )}
                  </span>
                  <p className="text-[11.5px] leading-tight font-medium text-[#c1cad6]">
                    {stage.label}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <OSectionTitle hint="All systems are operating normally.">System health</OSectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {HEALTH_ROWS.map((row) => {
              const check = checks.find((c) => c.key === row.key);
              const healthy = check?.passed ?? false;
              return (
                <OPanel key={row.key} className="flex flex-col items-center gap-1 bg-[#0c151d] py-3 text-center">
                  <row.icon className="size-4 text-[#9ad84a]" aria-hidden />
                  <p className="text-[11.5px] font-medium text-[#dbe1ea]">{row.label}</p>
                  <span
                    className={`flex items-center gap-1 text-[10.5px] ${healthy ? "text-[var(--auth-lime)]" : "text-[#ffb020]"}`}
                  >
                    <span className="size-1.5 rounded-full bg-current" /> {healthy ? "Healthy" : "Attention"}
                  </span>
                </OPanel>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <OSectionTitle hint="What happens when you go live?">Go live with confidence</OSectionTitle>
          <ul className="space-y-3">
            {[
              { icon: Rocket, title: "Start receiving real leads", body: "Your system will be live and processing new leads immediately." },
              { icon: MessageCircle, title: "Automated follow-ups", body: "Every lead will be contacted and nurtured automatically." },
              { icon: Users, title: "More bookings", body: "Qualified leads will be booked (or handed over) based on your setup." },
              { icon: BarChart3, title: "Track your results", body: "See your leads, bookings and revenue in your dashboard." },
            ].map((item) => (
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

        <div
          className={`rounded-[12px] border p-4 ${
            allReady
              ? "border-[rgba(168,255,31,0.35)] bg-[rgba(168,255,31,0.06)]"
              : "border-[rgba(255,176,32,0.3)] bg-[rgba(255,176,32,0.05)]"
          }`}
        >
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[#f8fafc]">
            {allReady ? (
              <CheckCircle2 className="size-4 text-[var(--auth-lime)]" aria-hidden />
            ) : (
              <XCircle className="size-4 text-[#ffb020]" aria-hidden />
            )}
            {allReady ? "You're ready to go live!" : "Almost there"}
          </p>
          <p className="mt-1 text-[12.5px] text-[#96a1b3]">
            {allReady
              ? "Your ClientTurn setup is configured and tested."
              : `Still needed: ${blocking.map((c) => c.label.toLowerCase()).join(", ")}.`}
          </p>
          <ul className="mt-2.5 space-y-1">
            {checks
              .filter((c) => c.blocking)
              .map((c) => (
                <li key={c.key} className="flex items-center gap-1.5 text-[12.5px] text-[#c1cad6]">
                  {c.passed ? (
                    <CheckCircle2 className="size-3.5 text-[var(--auth-lime)]" aria-hidden />
                  ) : (
                    <XCircle className="size-3.5 text-[#ffb020]" aria-hidden />
                  )}
                  {c.label}
                </li>
              ))}
          </ul>
          <OButton className="mt-3 w-full" disabled={!allReady} onClick={onGoLive} loading={goLivePending}>
            <Rocket className="size-3.5" aria-hidden />
            Go live
          </OButton>
        </div>
      </div>
    </div>
  );
}
