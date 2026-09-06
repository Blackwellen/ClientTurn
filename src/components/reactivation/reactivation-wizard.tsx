"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { createCampaign, previewAudience } from "@/lib/campaigns/actions";
import {
  DEFAULT_AUDIENCE_FILTER,
  type AudienceFilter,
  type AudiencePreview,
} from "@/lib/campaigns/types";
import {
  WizardProgress,
  WIZARD_STEPS,
} from "./wizard/wizard-progress";
import { AudienceStep, type FilterOptions } from "./wizard/audience-step";
import {
  MessageTimingStep,
  type ChannelOption,
  type QuietHours,
} from "./wizard/message-timing-step";
import { ReviewLaunchStep } from "./wizard/review-launch-step";
import {
  clearDraft,
  initialWizardState,
  launchChecklist,
  readDraft,
  resolvedAudienceLabel,
  scheduledInstant,
  splitTags,
  validateAudienceStep,
  validateMessageStep,
  type WizardChannel,
  type WizardState,
  writeDraft,
} from "./wizard/state";

/**
 * `ReactivationWizard` — exactly three steps: Audience, Message & Timing,
 * Review & Launch. One state object spans all three, so Back never loses a
 * value and Step 3 reviews precisely what Steps 1 and 2 configured.
 *
 * The step lives in `?step=`, which makes each screen linkable and gives the
 * browser Back button the behaviour a user expects. The audience estimate is
 * always resolved on the server through `previewAudience`; the number the
 * client holds is never trusted at launch — `createCampaign` re-resolves it.
 */
export function ReactivationWizard({
  businessName,
  options,
  defaultChannel,
  whatsappEnabled,
  emailEnabled,
  providerConnected,
  quietHours,
}: {
  businessName: string;
  options: FilterOptions;
  defaultChannel: WizardChannel;
  whatsappEnabled: boolean;
  /** True when this workspace has its own mailbox connected and healthy. */
  emailEnabled: boolean;
  providerConnected: boolean;
  quietHours: QuietHours;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const requestedStep = Number(searchParams.get("step") ?? "1");
  const [furthestStep, setFurthestStep] = React.useState(0);

  // A step can only be entered if the ones before it have been cleared, so a
  // hand-edited `?step=3` cannot skip validation.
  const step = Math.min(
    Math.max(Number.isFinite(requestedStep) ? requestedStep - 1 : 0, 0),
    Math.min(furthestStep, WIZARD_STEPS.length - 1),
  );

  // `boot` is null until the mount effect has looked for a saved draft, which
  // keeps hydration, "has a draft been restored" and the answers themselves
  // in one atomic piece of state rather than three that can disagree.
  const [boot, setBoot] = React.useState<{
    value: WizardState;
    fromDraft: boolean;
  } | null>(null);
  const [touched, setTouched] = React.useState(false);

  const blank = React.useMemo(
    () => initialWizardState(defaultChannel),
    [defaultChannel],
  );
  const state = boot?.value ?? blank;
  const hydrated = boot !== null;
  const dirty = touched || (boot?.fromDraft ?? false);

  const setState = React.useCallback(
    (update: (current: WizardState) => WizardState) => {
      setTouched(true);
      setBoot((current) =>
        current ? { ...current, value: update(current.value) } : current,
      );
    },
    [],
  );

  // The resolved estimate is stored with the filter key it answers, so
  // "loading" is derived by comparing keys rather than being a second piece
  // of state that can fall out of step with the request in flight.
  const [resolved, setResolved] = React.useState<{
    key: string;
    preview: AudiencePreview | null;
    error: string | null;
  } | null>(null);
  const [csvBusy, setCsvBusy] = React.useState(false);

  const [showErrors, setShowErrors] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  const [estimateAtReview, setEstimateAtReview] = React.useState<number | null>(
    null,
  );

  const headingRef = React.useRef<HTMLDivElement>(null);
  const requestId = React.useRef(0);

  /* --------------------------------------------------- draft restore --- */

  React.useEffect(() => {
    const draft = readDraft(defaultChannel);
    // Session storage is an external system read exactly once on mount — it
    // cannot be read during render because the server has no storage. This is
    // a single atomic update, not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBoot({ value: draft ?? initialWizardState(defaultChannel), fromDraft: draft !== null });
  }, [defaultChannel]);

  React.useEffect(() => {
    if (hydrated && dirty) writeDraft(state);
  }, [state, hydrated, dirty]);

  /* ------------------------------------------------ audience estimate --- */

  const filters = state.audienceFilters;
  const filterKey = JSON.stringify(filters);

  React.useEffect(() => {
    if (!hydrated) return;

    const id = ++requestId.current;

    const handle = window.setTimeout(async () => {
      const result = await previewAudience(JSON.parse(filterKey));
      // A later keystroke has already fired: discard this stale answer.
      if (id !== requestId.current) return;

      setResolved({
        key: filterKey,
        preview: result.ok ? result.data : null,
        error: result.ok ? null : result.error,
      });
    }, 350);

    return () => window.clearTimeout(handle);
  }, [filterKey, hydrated]);

  // A minute hand for the "is this schedule still in the future" check, so
  // validation cannot call Date.now() during render.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(handle);
  }, []);

  /* -------------------------------------------------------- mutation --- */

  const patch = React.useCallback(
    (next: Partial<WizardState>) => {
      setState((current) => ({ ...current, ...next }));
    },
    [setState],
  );

  const patchFilters = React.useCallback(
    (next: Partial<AudienceFilter>) => {
      setState((current) => ({
        ...current,
        audienceFilters: {
          ...DEFAULT_AUDIENCE_FILTER,
          ...current.audienceFilters,
          ...next,
        },
      }));
    },
    [setState],
  );

  /* ------------------------------------------------------ validation --- */

  const previewLoading = !resolved || resolved.key !== filterKey;
  const preview = resolved?.key === filterKey ? resolved.preview : null;
  const previewError = resolved?.key === filterKey ? resolved.error : null;

  const eligible = preview?.eligible ?? 0;
  const audienceReady = !previewLoading && preview !== null;

  const audienceIssues = validateAudienceStep(state, {
    eligible,
    audienceReady,
    csvBusy,
  });
  const messageIssues = validateMessageStep(state, {
    providerConnected,
    now,
  });

  const stepIssues = [audienceIssues, messageIssues, { fields: {}, valid: true }][
    step
  ];
  const fieldErrors = showErrors ? stepIssues.fields : {};

  const timingValid =
    state.sendMode === "now" || scheduledInstant(state) !== null;
  const messageValid = Object.keys(messageIssues.fields).length === 0;

  const canLaunch =
    eligible > 0 &&
    audienceIssues.valid &&
    messageIssues.valid &&
    providerConnected &&
    !submitting &&
    !previewLoading;

  /* ------------------------------------------------------ navigation --- */

  const goToStep = React.useCallback(
    (next: number) => {
      setShowErrors(false);
      setFurthestStep((current) => Math.max(current, next));
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", String(next + 1));
      router.replace(`/app/reactivation/new?${params.toString()}`, {
        scroll: false,
      });
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    [router, searchParams],
  );

  function next() {
    if (!stepIssues.valid) {
      setShowErrors(true);
      return;
    }
    if (step === 1) setEstimateAtReview(eligible);
    goToStep(step + 1);
  }

  function back() {
    if (step > 0) goToStep(step - 1);
  }

  function cancel() {
    if (dirty) {
      setConfirmCancel(true);
      return;
    }
    router.push("/app/reactivation");
  }

  function discard() {
    clearDraft();
    setConfirmCancel(false);
    router.push("/app/reactivation");
  }

  /* ---------------------------------------------------------- launch --- */

  async function launch() {
    if (!canLaunch || submitting) return;
    setSubmitting(true);
    setLaunchError(null);

    try {
      const scheduled = scheduledInstant(state);
      const result = await createCampaign(
        {
          name: state.campaignName.trim(),
          description: state.description.trim() || undefined,
          audienceLabel: resolvedAudienceLabel(state),
          tags: splitTags(state.tags).slice(0, 8),
          channel: state.channel,
          audience: state.audienceFilters,
          // Subjects are only meaningful on email; the schema rejects them
          // elsewhere, so they are omitted rather than sent empty.
          subject:
            state.channel === "email" ? state.subject.trim() : undefined,
          followupSubject:
            state.channel === "email" && state.followUpEnabled
              ? (state.followUpSubject.trim() || state.subject.trim())
              : undefined,
          message: state.initialMessage.trim(),
          followup: state.followUpEnabled
            ? state.followUpMessage.trim()
            : undefined,
          followupDelayHours: state.followUpDelayDays * 24,
          sendMode: state.sendMode,
          scheduledAt: scheduled ? scheduled.toISOString() : undefined,
          sendRatePerMinute: 20,
          aiPersonalize: false,
        },
        true,
      );

      if (!result.ok) {
        setLaunchError(result.error);
        toast({
          variant: "error",
          title: "Campaign not launched",
          description: result.error,
        });
        return;
      }

      clearDraft();
      setTouched(false);
      toast({
        variant: "success",
        title:
          state.sendMode === "schedule"
            ? "Campaign scheduled"
            : "Campaign launched",
        description:
          state.sendMode === "schedule"
            ? "Sending begins at the scheduled time, inside your send window."
            : "Sending starts within the next send window.",
      });
      router.push(`/app/reactivation?campaign=${result.data.id}`);
      router.refresh();
    } catch {
      setLaunchError("Something went wrong. Nothing was sent — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ------------------------------------------------------ revalidation --- */

  // If the estimate moved between leaving Step 2 and arriving at Step 3, say
  // so rather than letting a stale number sit under the launch button.
  const revalidationNotice =
    step === 2 &&
    estimateAtReview !== null &&
    !previewLoading &&
    estimateAtReview !== eligible
      ? `The audience changed while you were setting this up: ${eligible.toLocaleString(
          "en-GB",
        )} contacts are eligible now, not ${estimateAtReview.toLocaleString("en-GB")}.`
      : null;

  const channels: ChannelOption[] = [
    { value: "sms", label: "SMS", available: true },
    {
      value: "whatsapp",
      label: "WhatsApp",
      available: whatsappEnabled,
      reason: whatsappEnabled ? undefined : "not included on your current plan",
    },
    {
      value: "email",
      label: "Email",
      available: emailEnabled,
      reason: emailEnabled
        ? undefined
        : "connect your mailbox in Settings → Connections first",
    },
  ];

  const checklistDone = launchChecklist(state, {
    eligible,
    providerConnected,
    messageValid,
    timingValid,
  }).every((item) => item.done);

  return (
    <div className="space-y-5 pb-24">
      <div className="border-line-subtle border-b pb-4">
        <WizardProgress current={step} />
      </div>

      <div
        ref={headingRef}
        tabIndex={-1}
        aria-live="polite"
        className="sr-only focus:outline-none"
      >
        Step {step + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[step].label}
      </div>

      {launchError && (
        <div
          role="alert"
          className="border-danger-100 bg-danger-50 text-danger-700 rounded-lg border px-4 py-3 text-[13px]"
        >
          {launchError}
        </div>
      )}

      {step === 0 && (
        <AudienceStep
          state={state}
          patch={patch}
          patchFilters={patchFilters}
          options={options}
          preview={preview}
          loading={previewLoading}
          error={previewError}
          fieldErrors={fieldErrors}
          onCsvBusyChange={setCsvBusy}
        />
      )}

      {step === 1 && (
        <MessageTimingStep
          state={state}
          patch={patch}
          preview={preview}
          loading={previewLoading}
          businessName={businessName}
          quietHours={quietHours}
          channels={channels}
          fieldErrors={fieldErrors}
        />
      )}

      {step === 2 && (
        <ReviewLaunchStep
          state={state}
          preview={preview}
          loading={previewLoading}
          businessName={businessName}
          quietHours={quietHours}
          options={options}
          providerConnected={providerConnected}
          messageValid={messageValid}
          timingValid={timingValid}
          revalidationNotice={revalidationNotice}
        />
      )}

      {/* ----------------------------------------------------- footer --- */}
      <div className="bg-surface/95 border-line-subtle fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur lg:left-[var(--lr-sidebar-width,0px)]">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <Button variant="secondary" onClick={cancel} disabled={submitting}>
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={back}
              disabled={step === 0 || submitting}
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Back
            </Button>

            {step < 2 ? (
              <Button onClick={next} disabled={submitting}>
                {step === 0
                  ? "Continue to Message & Timing"
                  : "Continue to Review & Launch"}
                <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            ) : (
              <Button
                variant="success"
                onClick={launch}
                loading={submitting}
                disabled={!canLaunch || !checklistDone}
                title={
                  canLaunch
                    ? undefined
                    : "Fix the outstanding items before launching."
                }
              >
                <Rocket className="size-3.5" aria-hidden />
                Launch campaign
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Discard this campaign setup?"
        scope="This campaign draft only. No campaign has been created and nothing has been sent."
        consequence="Your audience, message and timing choices are lost and cannot be recovered."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={discard}
        onClose={() => setConfirmCancel(false)}
      />
    </div>
  );
}
