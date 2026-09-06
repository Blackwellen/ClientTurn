"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Braces,
  CalendarClock,
  CircleCheck,
  Eye,
  Info,
  Mail,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  MAX_SEQUENCE_STEPS,
  MERGE_FIELDS,
  MIN_GAP_OPTIONS,
  RECOMMENDED_SEND_WINDOW,
  SEND_WINDOWS,
  PROMOTION_RULES,
  REPLY_ACTION_LABELS,
  REPLY_RULES,
  START_MODES,
  replyActionFor,
  stepTiming,
  stepTitle,
  type CampaignDraft,
  type FieldErrors,
  type PromotionRule,
  type ReplyRuleKey,
  type SequenceStep,
  type StartMode,
} from "@/lib/outreach/campaign-draft";
import type { SenderHealth } from "@/lib/outreach/campaigns/sender";
import type { VariantProposal } from "@/lib/outreach/campaigns/variants";
import { generateVariantsAction } from "@/lib/outreach/campaign-actions";
import {
  Field,
  NoteBox,
  RadioRow,
  RailCard,
  SectionCard,
  TickList,
} from "./pieces";

/**
 * Every condition that stops a cold sequence dead (V4 §20.6).
 *
 * Mirrors what `campaigns/lifecycle.ts` and the dispatcher actually enforce —
 * these are not aspirations, and each is re-evaluated immediately before every
 * single send rather than once at launch.
 */
const COLD_STOP_CONDITIONS = [
  "Replies stop subsequent emails.",
  "Opt-outs and unsubscribes are immediately suppressed.",
  "Bounces and complaints stop the sequence.",
  "Promotion to Lead stops the sequence.",
  "Campaign pause or budget exhaustion stops sending.",
  "Sender-health issues automatically pause the sequence.",
] as const;

/**
 * UK-first, because that is who this product serves. The stored value is an
 * IANA zone, so adding others later needs no migration.
 */
const SEND_TIMEZONES = [
  { value: "Europe/London", label: "(GMT+00:00) London" },
  { value: "Europe/Dublin", label: "(GMT+00:00) Dublin" },
  { value: "Europe/Paris", label: "(GMT+01:00) Central European Time" },
  { value: "America/New_York", label: "(GMT-05:00) Eastern Time (ET)" },
  { value: "America/Chicago", label: "(GMT-06:00) Central Time (CT)" },
  { value: "America/Los_Angeles", label: "(GMT-08:00) Pacific Time (PT)" },
] as const;

/**
 * Step 4 — Outreach.
 *
 * Email only, by construction. There is no channel control on this screen at
 * all, because cold outreach is email-first by policy and offering a disabled
 * SMS toggle would imply it is a plan away rather than a rule.
 *
 * The sequence is a bounded list, not a canvas. Five steps is the ceiling and
 * the "Add" control disappears at it — an unbounded cold sequence is a
 * deliverability problem dressed up as flexibility.
 */
export function OutreachStep({
  draft,
  errors,
  campaignId,
  senders,
  aiAvailable,
  onChange,
}: {
  draft: CampaignDraft;
  errors: FieldErrors;
  campaignId: string | null;
  senders: SenderHealth[];
  aiAvailable: boolean;
  onChange: (update: (draft: CampaignDraft) => CampaignDraft) => void;
}) {
  const { outreach } = draft;
  const { toast } = useToast();
  const [previewStep, setPreviewStep] = React.useState(1);
  const [generating, setGenerating] = React.useState(false);
  const [proposals, setProposals] = React.useState<VariantProposal[]>([]);

  const sender = senders.find((row) => row.id === outreach.senderIdentityId) ?? null;

  const setOutreach = (patch: Partial<CampaignDraft["outreach"]>) =>
    onChange((current) => ({ ...current, outreach: { ...current.outreach, ...patch } }));

  const setStep = (position: number, patch: Partial<SequenceStep>) =>
    setOutreach({
      steps: outreach.steps.map((step) =>
        step.position === position ? { ...step, ...patch } : step,
      ),
    });

  const addStep = () => {
    if (outreach.steps.length >= MAX_SEQUENCE_STEPS) return;
    const last = outreach.steps[outreach.steps.length - 1];
    setOutreach({
      steps: [
        ...outreach.steps,
        {
          position: outreach.steps.length + 1,
          // Each follow-up must be later than the one before it, so the
          // default is derived rather than fixed.
          delayDays: Math.min(30, (last?.delayDays ?? 0) + 4),
          subject: "",
          body: "",
          enabled: true,
        },
      ],
    });
  };

  const removeStep = (position: number) => {
    if (outreach.steps.length <= 1) return;
    setOutreach({
      steps: outreach.steps
        .filter((step) => step.position !== position)
        .map((step, index) => ({ ...step, position: index + 1 })),
    });
    setPreviewStep(1);
  };

  const generate = async (position: number) => {
    if (!campaignId) return;
    setGenerating(true);
    try {
      const result = await generateVariantsAction({
        campaignId,
        stepPosition: position,
        count: Math.max(1, outreach.variantsPerStep - 1),
      });
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      setProposals(result.data.variants);
      toast({
        variant: "success",
        title: `${result.data.variants.length} variant${result.data.variants.length === 1 ? "" : "s"} suggested.`,
        description: "Review them before using one — nothing is sent until you launch.",
      });
    } finally {
      setGenerating(false);
    }
  };

  const preview = outreach.steps.find((step) => step.position === previewStep) ?? outreach.steps[0];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)_minmax(0,340px)]">
        <SectionCard
          icon={Mail}
          title="Sender identity"
          description="Choose which connected email account to use for this campaign."
          bodyClassName="space-y-3"
        >
          {senders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-surface-sunken/50 px-3.5 py-3 text-[12.5px] text-content-muted">
              No connected sender identities.{" "}
              <Link
                href="/app/settings?view=connections"
                className="font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Go to Connections
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface px-3 py-2.5">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-purple-50 text-[12px] font-semibold text-purple-700"
                >
                  {initials(sender?.displayName ?? "?")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Sender identity"
                      value={outreach.senderIdentityId ?? ""}
                      onChange={(event) =>
                        setOutreach({ senderIdentityId: event.target.value || null })
                      }
                      className="min-w-0 max-w-full truncate bg-transparent text-[13px] font-medium text-content focus:outline-none"
                    >
                      <option value="">Choose a sender</option>
                      {senders.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.email}
                        </option>
                      ))}
                    </select>
                    {sender && (
                      <Badge
                        tone={
                          sender.state === "HEALTHY"
                            ? "success"
                            : sender.state === "WARNING"
                              ? "warning"
                              : "danger"
                        }
                        dense
                      >
                        {sender.state === "HEALTHY"
                          ? "Verified"
                          : sender.state === "WARNING"
                            ? "Check setup"
                            : "Blocked"}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-[12px] text-content-muted">
                    {sender?.displayName ?? "No sender selected"}
                  </p>
                </div>
              </div>

              {sender && (
                <p
                  className={cn(
                    "flex items-start gap-1.5 text-[12px] leading-snug",
                    sender.state === "HEALTHY"
                      ? "text-success-700"
                      : sender.state === "WARNING"
                        ? "text-warning-700"
                        : "text-danger-700",
                  )}
                >
                  <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>{sender.summary}</span>
                </p>
              )}

              {errors.senderIdentityId && (
                <p className="text-[12px] text-danger-600">{errors.senderIdentityId}</p>
              )}
            </>
          )}
        </SectionCard>

        <div className="rounded-xl border border-info-100 bg-info-50 p-4">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 size-4 shrink-0 text-info-600" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-content">
                Email-first for cold outreach
              </p>
              <p className="mt-1 text-[12px] leading-snug text-content-secondary">
                Cold outreach starts with email unless your plan and policy permit
                additional channels. Social outreach is manual or API-gated.
              </p>
              <Link
                href="/privacy"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Learn about outreach policies
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
          </div>
        </div>

        <RailCard icon={Eye} title="Message preview" tone="info">
          <div
            className="mb-3 grid gap-1 rounded-lg bg-surface-sunken p-1"
            style={{ gridTemplateColumns: `repeat(${outreach.steps.length}, minmax(0, 1fr))` }}
            role="tablist"
            aria-label="Message preview step"
          >
            {outreach.steps.map((step) => (
              <button
                key={step.position}
                type="button"
                role="tab"
                aria-selected={previewStep === step.position}
                onClick={() => setPreviewStep(step.position)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors",
                  previewStep === step.position
                    ? "bg-surface text-content shadow-xs"
                    : "text-content-muted hover:text-content",
                )}
              >
                Step {step.position}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-line bg-surface p-3.5">
            <p className="text-[12.5px] text-content">
              <span className="font-semibold">Subject:</span>{" "}
              {preview?.subject || (
                <span className="text-content-subtle">Not written yet</span>
              )}
            </p>
            <div className="mt-2.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-content-secondary">
              {preview?.body || (
                <span className="text-content-subtle">
                  Write this step&rsquo;s message to see it previewed here.
                </span>
              )}
            </div>
            <p className="mt-3 border-t border-line-subtle pt-2.5 text-[11.5px] leading-snug text-content-muted">
              Your signature, postal address and a one-click unsubscribe link are added
              automatically to every send.
            </p>
          </div>
        </RailCard>

        {/* The tokens this surface can actually fill, straight from the
            canonical registry — the picker can never offer one that the
            validator would then reject. */}
        <RailCard icon={Braces} title="Available merge fields" tone="purple">
          <ul className="flex flex-wrap gap-1.5">
            {MERGE_FIELDS.map((field) => (
              <li key={field}>
                <code className="rounded-md border border-line bg-surface-sunken px-2 py-1 font-mono text-[11.5px] text-content-secondary">
                  {`{{${field}}}`}
                </code>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[11.5px] leading-snug text-content-muted">
            A field with no value for a given prospect uses its configured
            fallback, or the send pauses. A broken placeholder is never emailed.
          </p>
        </RailCard>

        {/* Stop conditions are stated here, not buried in a help article: they
            are the reason a cold sequence is safe to switch on. Each one is
            re-checked immediately before every send. */}
        <RailCard icon={Info} title="Important behaviour" tone="info">
          <TickList items={COLD_STOP_CONDITIONS} />
        </RailCard>
      </div>

      {/* ---------------------------------------------------------- sequence */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <SectionCard
          icon={Mail}
          title="Email sequence"
          description="Create a sequence of emails to engage prospects. Keep messages concise, relevant and compliant."
          bodyClassName="space-y-3"
        >
          {errors.steps && <p className="text-[12px] text-danger-600">{errors.steps}</p>}

          <ol className="space-y-3">
            {outreach.steps.map((step) => (
              <li
                key={step.position}
                className="rounded-lg border border-line bg-surface p-3.5"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-[12.5px] font-semibold tabular-nums text-content"
                  >
                    {step.position}
                  </span>

                  <div className="w-28 shrink-0">
                    <p className="text-[13px] font-semibold leading-tight text-content">
                      {stepTitle(step.position)}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-content-muted">
                      {stepTiming(step.delayDays)}
                    </p>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <Field
                      label="Subject"
                      htmlFor={`step-${step.position}-subject`}
                      required
                      error={errors[`step-${step.position}-subject`]}
                    >
                      <Input
                        id={`step-${step.position}-subject`}
                        value={step.subject}
                        maxLength={200}
                        placeholder="Quick question about your property portfolio"
                        aria-invalid={Boolean(errors[`step-${step.position}-subject`])}
                        onChange={(event) =>
                          setStep(step.position, { subject: event.target.value })
                        }
                      />
                    </Field>

                    <Field
                      label="Message"
                      htmlFor={`step-${step.position}-body`}
                      required
                      error={
                        errors[`step-${step.position}-body`] ??
                        errors[`step-${step.position}-delay`]
                      }
                    >
                      <Textarea
                        id={`step-${step.position}-body`}
                        rows={5}
                        value={step.body}
                        maxLength={5000}
                        placeholder={
                          "Hi {{first_name}},\n\nI came across {{company_name}} and wanted to reach out regarding your property portfolio..."
                        }
                        aria-invalid={Boolean(errors[`step-${step.position}-body`])}
                        onChange={(event) =>
                          setStep(step.position, { body: event.target.value })
                        }
                      />
                    </Field>

                    <div className="flex flex-wrap items-center gap-3">
                      <label
                        htmlFor={`step-${step.position}-delay`}
                        className="text-[12px] text-content-muted"
                      >
                        Send
                      </label>
                      <Input
                        id={`step-${step.position}-delay`}
                        type="number"
                        min={0}
                        max={30}
                        value={step.delayDays}
                        disabled={step.position === 1}
                        onChange={(event) =>
                          setStep(step.position, {
                            delayDays: Math.max(
                              0,
                              Math.min(30, Number(event.target.value) || 0),
                            ),
                          })
                        }
                        className="h-8 w-20"
                      />
                      <span className="text-[12px] text-content-muted">
                        {step.position === 1 ? "immediately" : "days after the previous step"}
                      </span>

                      <div className="ml-auto flex items-center gap-3">
                        <Switch
                          checked={step.enabled}
                          onCheckedChange={(enabled) => setStep(step.position, { enabled })}
                          label={`Step ${step.position} enabled`}
                          tone="success"
                        />
                        <button
                          type="button"
                          onClick={() => setPreviewStep(step.position)}
                          className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-content transition-colors hover:bg-surface-hover"
                        >
                          Preview
                        </button>
                        {outreach.steps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeStep(step.position)}
                            aria-label={`Remove step ${step.position}`}
                            className="rounded-md p-1 text-content-subtle transition-colors hover:bg-danger-50 hover:text-danger-600"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {outreach.steps.length < MAX_SEQUENCE_STEPS ? (
            <Button variant="secondary" size="sm" onClick={addStep}>
              <Plus className="size-3.5" aria-hidden />
              Add email step
            </Button>
          ) : (
            <p className="text-[12px] text-content-muted">
              {MAX_SEQUENCE_STEPS} steps is the maximum for a cold sequence.
            </p>
          )}

        </SectionCard>

        <SectionCard
          icon={Wand2}
          title="Message variants"
          description="Use multiple variants to improve performance across your audience."
          tone="purple"
          bodyClassName="space-y-3.5"
        >
          <div className="flex items-center gap-3">
            <Switch
              checked={outreach.variantsEnabled}
              onCheckedChange={(variantsEnabled) =>
                setOutreach({
                  variantsEnabled,
                  variantsPerStep: variantsEnabled
                    ? Math.max(2, outreach.variantsPerStep)
                    : 1,
                })
              }
              label="Enable message variants"
              tone="success"
            />
            <span className="text-[13px] font-medium text-content">
              Enable message variants
            </span>
          </div>

          <Field
            label="Number of variants per step"
            htmlFor="variants-per-step"
            error={errors.variantsPerStep}
          >
            <Select
              id="variants-per-step"
              value={String(outreach.variantsPerStep)}
              disabled={!outreach.variantsEnabled}
              onChange={(event) =>
                setOutreach({ variantsPerStep: Number(event.target.value) })
              }
            >
              <option value="1">1 variant</option>
              <option value="2">2 variants (A/B)</option>
              <option value="3">3 variants (A/B/C)</option>
              <option value="4">4 variants (A/B/C/D)</option>
            </Select>
          </Field>

          <NoteBox icon={Sparkles} tone="info">
            AI can help you generate high-performing variants based on your audience and
            value proposition. Suggestions are reviewed by you before anything is sent.
          </NoteBox>

          <Button
            variant="secondary"
            size="sm"
            fullWidth
            loading={generating}
            disabled={!outreach.variantsEnabled || !aiAvailable || !campaignId}
            onClick={() => generate(previewStep)}
            title={
              aiAvailable
                ? undefined
                : "AI assistance is switched off or not configured for this workspace."
            }
          >
            <Sparkles className="size-3.5" aria-hidden />
            Generate variants with AI
          </Button>

          {proposals.length > 0 && (
            <ul className="space-y-2">
              {proposals.map((proposal) => (
                <li
                  key={proposal.label}
                  className="rounded-lg border border-line bg-surface-sunken/50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="purple" dense>
                      Variant {proposal.label}
                    </Badge>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => {
                        setStep(previewStep, {
                          subject: proposal.subject,
                          body: proposal.body,
                        });
                        setProposals([]);
                      }}
                    >
                      Use this
                    </Button>
                  </div>
                  <p className="mt-2 text-[12.5px] font-medium text-content">
                    {proposal.subject}
                  </p>
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12px] leading-snug text-content-secondary">
                    {proposal.body}
                  </p>
                  {proposal.warnings.map((warning) => (
                    <p key={warning} className="mt-1.5 text-[11.5px] text-warning-700">
                      {warning}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* -------------------------------------------------- send schedule */}
      <SectionCard
        icon={CalendarClock}
        title="Sequence settings"
        description="When this sequence is allowed to send. These preferences narrow what policy permits; they never widen it."
        bodyClassName="grid gap-4 sm:grid-cols-3"
      >
        <Field label="Time zone for sending" htmlFor="send-timezone">
          <Select
            id="send-timezone"
            value={outreach.timezone}
            onChange={(event) => setOutreach({ timezone: event.target.value })}
          >
            {SEND_TIMEZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11.5px] leading-snug text-content-muted">
            Emails are sent during your configured send window in this zone.
          </p>
        </Field>

        <Field label="Send window (optional)" htmlFor="send-window">
          <Select
            id="send-window"
            value={outreach.sendWindow}
            onChange={(event) => setOutreach({ sendWindow: event.target.value })}
          >
            {SEND_WINDOWS.map((window) => (
              <option key={window.value} value={window.value}>
                {window.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11.5px] leading-snug text-content-muted">
            Recommended: {RECOMMENDED_SEND_WINDOW}
          </p>
        </Field>

        <Field label="Minimum gap between emails" htmlFor="min-gap">
          <Select
            id="min-gap"
            value={String(outreach.minGapDays)}
            onChange={(event) =>
              setOutreach({ minGapDays: Number(event.target.value) })
            }
          >
            {MIN_GAP_OPTIONS.map((days) => (
              <option key={days} value={String(days)}>
                {days} {days === 1 ? "day" : "days"}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11.5px] leading-snug text-content-muted">
            Prevents messages from being sent too closely together.
          </p>
        </Field>
      </SectionCard>

      {/* ---------------------------------------- replies, promotion, start */}
      <div className="grid gap-5 lg:grid-cols-3">
        <SectionCard
          icon={MessageSquare}
          title="Reply classification behaviour"
          description="Define how the system should handle different types of replies."
          bodyClassName="space-y-3"
        >
          {REPLY_RULES.map((rule) => {
            const action = replyActionFor(
              rule.key,
              outreach.replyRules as Record<string, string>,
            );
            const locked = rule.actions.length === 1;

            return (
              <div key={rule.key} className="flex flex-wrap items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md",
                    REPLY_TONES[rule.key],
                  )}
                >
                  <MessageSquare className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium leading-tight text-content">
                    {rule.label}
                  </p>
                  <p className="text-[11.5px] leading-tight text-content-muted">{rule.hint}</p>
                </div>
                <Select
                  aria-label={`Action for ${rule.label}`}
                  value={action}
                  disabled={locked}
                  className="h-8 w-full text-[12px] sm:w-48"
                  onChange={(event) =>
                    setOutreach({
                      replyRules: {
                        ...outreach.replyRules,
                        [rule.key]: event.target.value,
                      },
                    })
                  }
                >
                  {rule.actions.map((option) => (
                    <option key={option} value={option}>
                      {REPLY_ACTION_LABELS[option]}
                    </option>
                  ))}
                </Select>
              </div>
            );
          })}

          {/* Not a setting. A campaign cannot decide to keep emailing someone
              who asked it to stop, so the control is absent, not disabled. */}
          <p className="text-[11.5px] leading-snug text-content-muted">
            An unsubscribe always stops this campaign and adds the contact to your global
            suppression list. That cannot be changed per campaign.
          </p>
        </SectionCard>

        <SectionCard
          icon={Users}
          title="Promotion to lead behaviour"
          description="Control when a prospect is automatically promoted to a lead."
          bodyClassName="space-y-3.5"
        >
          {PROMOTION_RULES.map((rule) => (
            <RadioRow
              key={rule.value}
              name="promotion-rule"
              value={rule.value}
              checked={outreach.promotionRule === rule.value}
              onChange={(value) => setOutreach({ promotionRule: value as PromotionRule })}
              title={rule.label}
              description={rule.description}
            />
          ))}
        </SectionCard>

        <SectionCard
          icon={CalendarClock}
          title="Campaign start"
          description="Choose whether to start immediately or after review."
          bodyClassName="space-y-3.5"
        >
          {START_MODES.map((mode) => (
            <RadioRow
              key={mode.value}
              name="start-mode"
              value={mode.value}
              checked={outreach.startMode === mode.value}
              onChange={(value) => setOutreach({ startMode: value as StartMode })}
              title={mode.label}
              description={mode.description}
              // Starting automatically requires a sender we would actually be
              // willing to send from right now.
              disabled={mode.value === "IMMEDIATE" && sender?.state !== "HEALTHY"}
              disabledReason={
                mode.value === "IMMEDIATE" && sender?.state !== "HEALTHY"
                  ? "Available once the sending identity is healthy."
                  : undefined
              }
            />
          ))}
        </SectionCard>
      </div>
    </div>
  );
}

const REPLY_TONES: Record<ReplyRuleKey, string> = {
  POSITIVE: "bg-success-50 text-success-600",
  QUESTION: "bg-info-50 text-info-600",
  NOT_INTERESTED: "bg-warning-50 text-warning-600",
  UNSUBSCRIBE: "bg-danger-50 text-danger-600",
  HUMAN_REQUEST: "bg-purple-50 text-purple-600",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
