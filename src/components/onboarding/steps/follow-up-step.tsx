"use client";

import * as React from "react";
import { Check, MessageCircle, Phone, Plus, Send, Trash2 } from "lucide-react";
import {
  MergeChip,
  OButton,
  OField,
  OInput,
  OPanel,
  ORadioCard,
  OSectionTitle,
  OSelect,
  OTextarea,
} from "../ui";
import type { StepActions } from "../step-types";
import { DELAY_PRESETS, formatDelay } from "@/lib/automations/types";
import { sendFollowUpTestMessage, type FollowUpStepInput } from "@/lib/onboarding/actions";

const MERGE_FIELDS = [
  { token: "first_name", label: "{{first_name}}" },
  { token: "service_name", label: "{{service_name}}" },
  { token: "business_name", label: "{{business_name}}" },
  { token: "business_phone", label: "{{business_phone}}" },
];

const BEST_PRACTICE = [
  "Keep messages short and friendly",
  "Mention your business and the next step",
  "Be helpful, not pushy",
  "Send messages during business hours",
  "Include an opt-out option",
  "Test your message before going live",
];

export type FollowUpSequenceStep = {
  delaySeconds: number;
  channel: "sms" | "whatsapp";
  template: string;
  enabled: boolean;
};

export type FollowUpInitial = {
  defaultChannel: "sms" | "whatsapp";
  signature: string;
  businessPhone: string;
  whatsappAvailable: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  optOutWording: string;
  steps: FollowUpSequenceStep[];
};

export function FollowUpStep({
  initial,
  onContinue,
  onSaveExit,
  onRegisterActions,
}: {
  initial: FollowUpInitial;
  onContinue: (payload: FollowUpStepInput) => void;
  onSaveExit: (payload: FollowUpStepInput) => void;
  onRegisterActions: (actions: StepActions) => void;
}) {
  const [channel, setChannel] = React.useState<"sms" | "whatsapp">(initial.defaultChannel);
  const [signature, setSignature] = React.useState(initial.signature);
  const [steps, setSteps] = React.useState<FollowUpSequenceStep[]>(
    initial.steps.length > 0
      ? initial.steps
      : [{ delaySeconds: 0, channel: "sms", template: "", enabled: true }],
  );
  const [quietEnabled, setQuietEnabled] = React.useState(initial.quietHoursEnabled);
  const [quietStart, setQuietStart] = React.useState(initial.quietHoursStart);
  const [quietEnd, setQuietEnd] = React.useState(initial.quietHoursEnd);
  const [optOut, setOptOut] = React.useState(initial.optOutWording);
  const [openingRef, setOpeningRef] = React.useState<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [sending, setSending] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  function buildPayload(): FollowUpStepInput {
    return {
      defaultChannel: channel,
      signature,
      quietHoursEnabled: quietEnabled,
      quietHoursStart: quietStart,
      quietHoursEnd: quietEnd,
      optOutWording: optOut,
      steps: steps.filter((s) => s.template.trim().length > 0),
    };
  }

  const disabledReason = !steps[0]?.template.trim()
    ? "Write your opening message before continuing."
    : !/stop/i.test(optOut)
      ? "Opt-out wording must mention replying STOP."
      : undefined;

  React.useEffect(() => {
    onRegisterActions({
      continue: () => onContinue(buildPayload()),
      saveExit: () => onSaveExit(buildPayload()),
      disabledReason,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, signature, steps, quietEnabled, quietStart, quietEnd, optOut, disabledReason]);

  function insertMergeField(token: string) {
    const insert = `{{${token}}}`;
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== 0) return s;
        const el = openingRef;
        if (el && document.activeElement === el) {
          const start = el.selectionStart ?? s.template.length;
          const end = el.selectionEnd ?? s.template.length;
          return { ...s, template: s.template.slice(0, start) + insert + s.template.slice(end) };
        }
        return { ...s, template: `${s.template}${s.template ? " " : ""}${insert}` };
      }),
    );
  }

  async function sendTest() {
    setSending(true);
    setTestResult(null);
    try {
      const result = await sendFollowUpTestMessage({
        channel,
        message: steps[0]?.template ?? "",
      });
      setTestResult(
        result.ok
          ? { ok: true, message: `Sent via ${result.provider}.` }
          : { ok: false, message: result.error },
      );
    } finally {
      setSending(false);
    }
  }

  const openingLength = steps[0]?.template.length ?? 0;
  const segments = channel === "sms" ? Math.max(1, Math.ceil(openingLength / 160)) : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.15fr_0.85fr]">
      <div className="space-y-4">
        <div>
          <OSectionTitle hint="Choose which channel to use for follow-ups.">
            Messaging channel
          </OSectionTitle>
          <div className="space-y-2.5">
            <ORadioCard selected={channel === "sms"} onSelect={() => setChannel("sms")}>
              <span className="flex items-center gap-2 text-[14px] font-medium text-[#f0f3f8]">
                <MessageCircle className="size-4 text-[#9ad84a]" aria-hidden />
                SMS
              </span>
              <p className="mt-0.5 text-[12.5px] text-[#8c98ab]">
                Send text messages to leads (most popular)
              </p>
            </ORadioCard>
            <ORadioCard
              selected={channel === "whatsapp"}
              onSelect={() => initial.whatsappAvailable && setChannel("whatsapp")}
              disabled={!initial.whatsappAvailable}
            >
              <span className="flex items-center gap-2 text-[14px] font-medium text-[#f0f3f8]">
                <MessageCircle className="size-4 text-[#25d366]" aria-hidden />
                WhatsApp
              </span>
              <p className="mt-0.5 text-[12.5px] text-[#8c98ab]">
                {initial.whatsappAvailable
                  ? "Send messages via WhatsApp"
                  : "Setup required — connect WhatsApp in Settings → Connections"}
              </p>
            </ORadioCard>
          </div>
        </div>

        <div>
          <OSectionTitle hint="Connect your number and set how your messages appear to leads.">
            Sender setup
          </OSectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <OField label="Phone number">
              <div className="flex h-10 items-center gap-2 rounded-[7px] border border-[rgba(150,170,190,0.32)] bg-[#0b141d] px-3">
                <Phone className="size-3.5 shrink-0 text-[#7a8698]" aria-hidden />
                <span className="truncate text-[14px] text-[#eef2f7]">
                  {initial.businessPhone || "Not set"}
                </span>
              </div>
            </OField>
            <OField label="Sender identity" hint="This is how your messages will appear to leads.">
              <OInput
                value={signature}
                placeholder="Your business, your name"
                onChange={(e) => setSignature(e.target.value)}
              />
            </OField>
          </div>
        </div>

        <div>
          <OSectionTitle hint="Write the first message that will be sent to new leads.">
            Opening message
          </OSectionTitle>
          <OTextarea
            ref={setOpeningRef}
            rows={4}
            maxLength={500}
            value={steps[0]?.template ?? ""}
            onChange={(e) =>
              setSteps((prev) => prev.map((s, i) => (i === 0 ? { ...s, template: e.target.value } : s)))
            }
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {MERGE_FIELDS.map((field) => (
                <button key={field.token} type="button" onClick={() => insertMergeField(field.token)}>
                  <MergeChip>{field.label}</MergeChip>
                </button>
              ))}
            </div>
            <p className="shrink-0 text-[11.5px] text-[#697488]">
              {openingLength}/500{segments ? ` · ${segments} SMS segment${segments === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <OSectionTitle hint="We'll send a series of messages if there's no reply.">
            Follow-up sequence
          </OSectionTitle>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <OPanel key={i} className="bg-[#0c151d] p-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[rgba(150,170,190,0.4)] text-[12px] font-semibold text-[#c1cad6]">
                    {i + 1}
                  </span>
                  <span className="w-24 shrink-0 text-[13px] font-medium text-[#dbe1ea]">
                    {i === 0 ? "Immediately" : formatDelay(step.delaySeconds)}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-[13px] text-[#96a1b3]">
                    {step.template || "No message yet"}
                  </p>
                  {steps.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove step ${i + 1}`}
                      onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                      className="text-[#7a8698] hover:text-[#ff6b70]"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="text-[12px] font-medium text-[var(--auth-lime)]"
                  >
                    {expanded === i ? "Done" : "Edit"}
                  </button>
                </div>
                {expanded === i && (
                  <div className="mt-2.5 space-y-2 border-t border-[rgba(150,170,190,0.15)] pt-2.5">
                    {i > 0 && (
                      <OField label="Delay">
                        <OSelect
                          value={step.delaySeconds}
                          onChange={(e) =>
                            setSteps((prev) =>
                              prev.map((s, j) =>
                                j === i ? { ...s, delaySeconds: Number(e.target.value) } : s,
                              ),
                            )
                          }
                        >
                          {DELAY_PRESETS.filter((p) => p.seconds > 0).map((preset) => (
                            <option key={preset.seconds} value={preset.seconds}>
                              {preset.label}
                            </option>
                          ))}
                        </OSelect>
                      </OField>
                    )}
                    <OField label="Message">
                      <OTextarea
                        rows={3}
                        maxLength={500}
                        value={step.template}
                        onChange={(e) =>
                          setSteps((prev) =>
                            prev.map((s, j) => (j === i ? { ...s, template: e.target.value } : s)),
                          )
                        }
                      />
                    </OField>
                  </div>
                )}
              </OPanel>
            ))}
          </div>
          <OButton
            variant="secondary"
            className="mt-2.5 w-full"
            disabled={steps.length >= 8}
            onClick={() =>
              setSteps((prev) => [
                ...prev,
                {
                  delaySeconds: (prev.at(-1)?.delaySeconds ?? 0) + 86400,
                  channel,
                  template: "",
                  enabled: true,
                },
              ])
            }
          >
            <Plus className="size-3.5" aria-hidden />
            Add another message
          </OButton>
        </div>

        <div>
          <OSectionTitle hint="Choose when to pause messages (in your local time).">
            Quiet hours
          </OSectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <OField label="Start time">
              <input
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className="h-10 w-full rounded-[7px] border border-[rgba(150,170,190,0.32)] bg-[#0b141d] px-3 text-[14px] text-[#eef2f7] outline-none focus:border-[rgba(168,255,31,0.75)]"
              />
            </OField>
            <OField label="End time">
              <input
                type="time"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                className="h-10 w-full rounded-[7px] border border-[rgba(150,170,190,0.32)] bg-[#0b141d] px-3 text-[14px] text-[#eef2f7] outline-none focus:border-[rgba(168,255,31,0.75)]"
              />
            </OField>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[12.5px] text-[#96a1b3]">
            <input
              type="checkbox"
              checked={quietEnabled}
              onChange={(e) => setQuietEnabled(e.target.checked)}
              className="size-3.5 accent-[var(--auth-lime)]"
            />
            We won&rsquo;t send messages during these hours.
          </label>
        </div>

        <div>
          <OSectionTitle hint="Add a short opt-out message (required for compliance).">
            Opt-out wording
          </OSectionTitle>
          <OInput
            maxLength={160}
            value={optOut}
            onChange={(e) => setOptOut(e.target.value)}
          />
          <p className="mt-1.5 text-right text-[11.5px] text-[#697488]">{optOut.length}/160</p>
        </div>

        <div>
          <OButton variant="secondary" className="w-full" onClick={sendTest} loading={sending}>
            <Send className="size-3.5" aria-hidden />
            Send test message
          </OButton>
          {testResult && (
            <p
              className={`mt-1.5 text-[12.5px] ${testResult.ok ? "text-[var(--auth-lime)]" : "text-[#ff6b70]"}`}
            >
              {testResult.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <OSectionTitle hint="Here's how your follow-up sequence will work.">
            Sequence overview
          </OSectionTitle>
          <ol className="space-y-3 border-l border-dashed border-[rgba(150,170,190,0.3)] pl-4">
            <li className="relative">
              <span className="absolute top-1 -left-[21px] size-2.5 rounded-full bg-[var(--auth-lime)]" />
              <p className="text-[13px] font-medium text-[#f0f3f8]">Lead received</p>
            </li>
            {steps.map((step, i) => (
              <li key={i} className="relative">
                <span className="absolute top-1 -left-[21px] size-2.5 rounded-full bg-[var(--auth-lime)]" />
                <p className="text-[13px] font-medium text-[#f0f3f8]">
                  {i === 0 ? "Immediately" : formatDelay(step.delaySeconds)}
                </p>
                <p className="text-[12px] text-[#8c98ab]">
                  {i === 0 ? "Send opening message" : `Follow up (Message ${i + 1})`}
                </p>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <OSectionTitle hint="Follow these tips to get the best results.">
            Best practice tips
          </OSectionTitle>
          <ul className="space-y-1.5">
            {BEST_PRACTICE.map((tip) => (
              <li key={tip} className="flex items-start gap-2 text-[12.5px] text-[#96a1b3]">
                <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--auth-lime)]" aria-hidden />
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
