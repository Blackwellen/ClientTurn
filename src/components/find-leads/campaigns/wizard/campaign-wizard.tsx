"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, Rocket, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  WIZARD_STEPS,
  WIZARD_STEP_KEYS,
  furthestValidStep,
  stepIndex,
  validateAll,
  type CampaignDraft,
  type WizardStepKey,
} from "@/lib/outreach/campaign-draft";
import type { LaunchCheck } from "@/lib/outreach/campaign-validation";
import type {
  AudienceEstimate,
  CampaignWizardOptions,
  IntentCategoryInsight,
} from "@/lib/outreach/campaigns/audience";
import type { CampaignBudgetContext } from "@/lib/outreach/campaign-budget";
import type { SenderHealth } from "@/lib/outreach/campaigns/sender";
import {
  estimateAudienceAction,
  launchAcquisitionCampaignAction,
  saveCampaignDraftAction,
  validateCampaignAction,
} from "@/lib/outreach/campaign-actions";
import { CampaignStepper } from "./stepper";
import { GoalStep } from "./goal-step";
import { AudienceStep } from "./audience-step";
import { IntentStep } from "./intent-step";
import { OutreachStep } from "./outreach-step";
import { BudgetStep } from "./budget-step";
import { ReviewStep } from "./review-step";

/**
 * The New Acquisition Campaign wizard.
 *
 * One route, one draft object, six steps. The step lives in `?step=`, so each
 * screen is linkable and browser Back does what a person expects rather than
 * leaving the wizard entirely.
 *
 * Two rules hold the whole thing together:
 *   - the draft is saved server-side, debounced, so nothing is lost to a
 *     refresh, a closed tab or a different device;
 *   - a step cannot be entered until the ones before it validate, and the same
 *     validators run again on the server at launch. The client's opinion about
 *     completeness is a convenience, never the gate.
 */

const AUTOSAVE_DELAY = 900;
const ESTIMATE_DELAY = 600;

type SaveState = "idle" | "saving" | "saved" | "error";

export function CampaignWizard({
  campaignId,
  initialDraft,
  initialStep,
  options,
  senders,
  budgetContext,
  initialEstimate,
  initialInsights,
  aiAvailable,
}: {
  campaignId: string;
  initialDraft: CampaignDraft;
  initialStep: WizardStepKey | null;
  options: CampaignWizardOptions;
  senders: SenderHealth[];
  budgetContext: CampaignBudgetContext;
  initialEstimate: AudienceEstimate | null;
  initialInsights: IntentCategoryInsight[];
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [draft, setDraft] = React.useState<CampaignDraft>(initialDraft);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  // The resolved answer is stored with the key it answers, so "loading" is
  // derived by comparing keys rather than being a second piece of state that
  // can fall out of step with the request in flight.
  const [resolvedEstimate, setResolvedEstimate] = React.useState<{
    key: string;
    estimate: AudienceEstimate | null;
  } | null>(null);
  const [resolvedChecks, setResolvedChecks] = React.useState<{
    key: string;
    checks: LaunchCheck[];
  } | null>(null);
  const [launching, setLaunching] = React.useState(false);
  const [confirmLaunch, setConfirmLaunch] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);

  const headingRef = React.useRef<HTMLDivElement>(null);
  const dirty = React.useRef(false);
  const saveToken = React.useRef(0);

  const errors = React.useMemo(
    () => validateAll(draft, budgetContext.ceilings),
    [draft, budgetContext.ceilings],
  );
  const furthest = furthestValidStep(errors);

  const requested = (searchParams.get("step") ?? initialStep ?? "goal") as WizardStepKey;
  // A hand-edited `?step=review` cannot skip a step that has not validated.
  const step: WizardStepKey = WIZARD_STEP_KEYS.includes(requested)
    ? WIZARD_STEP_KEYS[Math.min(stepIndex(requested), stepIndex(furthest))]
    : "goal";

  const completed = React.useMemo(
    () =>
      Object.fromEntries(
        WIZARD_STEP_KEYS.map((key) => [key, Object.keys(errors[key] ?? {}).length === 0]),
      ) as Record<WizardStepKey, boolean>,
    [errors],
  );

  const stepErrors = showErrors ? (errors[step] ?? {}) : {};

  /* ------------------------------------------------------------ routing */

  const goTo = React.useCallback(
    (next: WizardStepKey, replace = false) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", next);
      const url = `?${params.toString()}`;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
      setShowErrors(false);
    },
    [router, searchParams],
  );

  // Moving between steps should put the reader at the top of the new one, and
  // announce it — a wizard that silently swaps its contents is disorienting
  // for anyone not watching the whole viewport.
  React.useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  /* ----------------------------------------------------------- autosave */

  const update = React.useCallback(
    (mutate: (current: CampaignDraft) => CampaignDraft) => {
      dirty.current = true;
      setDraft(mutate);
    },
    [],
  );

  React.useEffect(() => {
    if (!dirty.current) return;

    const token = ++saveToken.current;

    const timer = setTimeout(async () => {
      setSaveState("saving");
      const result = await saveCampaignDraftAction({ campaignId, step, draft });
      // A stale save must not overwrite the state of a newer one.
      if (token !== saveToken.current) return;

      if (result.ok) {
        setSaveState("saved");
      } else {
        setSaveState("error");
        toast({ variant: "error", title: result.error });
      }
    }, AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [draft, campaignId, step, toast]);

  /* ------------------------------------------------------- audience estimate */

  const audienceKey = JSON.stringify({
    audience: draft.audience,
    grade: draft.intentScore.minimumGrade,
    perRun: draft.budget.prospectsPerRun,
  });

  const estimate = resolvedEstimate?.estimate ?? initialEstimate;
  const onAudienceStep = step === "audience" || step === "intent";
  const estimating = onAudienceStep && resolvedEstimate?.key !== audienceKey;

  React.useEffect(() => {
    if (!onAudienceStep) return;
    if (resolvedEstimate?.key === audienceKey) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await estimateAudienceAction({ campaignId, draft });
      if (cancelled) return;
      setResolvedEstimate({
        key: audienceKey,
        estimate: result.ok ? result.data : null,
      });
    }, ESTIMATE_DELAY);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Keyed on the criteria rather than the whole draft: typing a subject in
    // step 4 must not re-run a count over every prospect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey, onAudienceStep, campaignId, resolvedEstimate?.key]);

  /* ------------------------------------------------------------ validation */

  // Re-validated whenever the draft changes, because a launch check is only
  // worth showing against the configuration currently stored.
  const validationKey = JSON.stringify(draft);
  const onReview = step === "review";
  const checks = resolvedChecks?.checks ?? null;
  const validating = onReview && resolvedChecks?.key !== validationKey;

  React.useEffect(() => {
    if (!onReview) return;
    if (resolvedChecks?.key === validationKey) return;

    let cancelled = false;

    void (async () => {
      const result = await validateCampaignAction(campaignId);
      if (cancelled) return;
      if (result.ok) setResolvedChecks({ key: validationKey, checks: result.data.checks });
      else toast({ variant: "error", title: result.error });
    })();

    return () => {
      cancelled = true;
    };
  }, [onReview, validationKey, campaignId, resolvedChecks?.key, toast]);

  /* ---------------------------------------------------------------- launch */

  const launch = async () => {
    setLaunching(true);
    try {
      const result = await launchAcquisitionCampaignAction({
        campaignId,
        startMode: draft.outreach.startMode,
      });

      if (!result.ok) {
        // The server's verdict replaces the client's: it looked at what is
        // actually stored, this page looked at what it was holding.
        if (result.checks) {
          setResolvedChecks({ key: validationKey, checks: result.checks });
        }
        toast({ variant: "error", title: result.error });
        return;
      }

      toast({
        variant: "success",
        title:
          result.data.status === "ACTIVE"
            ? "Campaign is live."
            : "Campaign created and ready for review.",
        description:
          result.data.status === "ACTIVE"
            ? "Sending starts shortly. Every recipient is re-checked immediately before their message goes out."
            : "Activate it from the campaign page when you are happy with it.",
      });

      // Redirect rather than re-render: the campaign that exists now is not the
      // draft this page is holding.
      router.push(`/app/find-leads/campaigns/${result.data.campaignId}`);
    } finally {
      setLaunching(false);
    }
  };

  const next = () => {
    if (!completed[step]) {
      setShowErrors(true);
      return;
    }
    const index = stepIndex(step);
    if (index < WIZARD_STEP_KEYS.length - 1) goTo(WIZARD_STEP_KEYS[index + 1]);
  };

  const previous = () => {
    const index = stepIndex(step);
    if (index > 0) goTo(WIZARD_STEP_KEYS[index - 1]);
  };

  const blocked = checks?.some((check) => check.state === "BLOCK") ?? false;
  const isLast = step === "review";

  return (
    <div className="space-y-5">
      <div
        ref={headingRef}
        tabIndex={-1}
        className="outline-none"
        aria-live="polite"
      >
        <span className="sr-only">
          Step {stepIndex(step) + 1} of {WIZARD_STEPS.length}:{" "}
          {WIZARD_STEPS[stepIndex(step)].label}
        </span>
      </div>

      <CampaignStepper
        current={step}
        furthest={furthest}
        completed={completed}
        onSelect={(target) => goTo(target)}
      />

      {step === "goal" && (
        <GoalStep draft={draft} errors={stepErrors} options={options} onChange={update} />
      )}
      {step === "audience" && (
        <AudienceStep
          draft={draft}
          errors={stepErrors}
          options={options}
          estimate={estimate}
          estimating={estimating}
          onChange={update}
        />
      )}
      {step === "intent" && (
        <IntentStep
          draft={draft}
          errors={stepErrors}
          options={options}
          estimate={estimate}
          insights={initialInsights}
          loading={estimating}
          onChange={update}
        />
      )}
      {step === "outreach" && (
        <OutreachStep
          draft={draft}
          errors={stepErrors}
          campaignId={campaignId}
          senders={senders}
          aiAvailable={aiAvailable}
          onChange={update}
        />
      )}
      {step === "budget" && (
        <BudgetStep
          draft={draft}
          errors={stepErrors}
          context={budgetContext}
          onChange={update}
        />
      )}
      {step === "review" && (
        <ReviewStep
          draft={draft}
          options={options}
          senders={senders}
          checks={checks}
          validating={validating}
          startMode={draft.outreach.startMode}
          onStartModeChange={(startMode) =>
            update((current) => ({
              ...current,
              outreach: { ...current.outreach, startMode },
            }))
          }
          onEdit={(target) => goTo(target)}
        />
      )}

      {/* ------------------------------------------------------------ footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <div className="flex items-center gap-3">
          {step === "goal" ? (
            <Button variant="secondary" size="md" onClick={() => setConfirmCancel(true)}>
              Cancel
            </Button>
          ) : (
            <Button variant="secondary" size="md" onClick={previous}>
              <ArrowLeft className="size-4" aria-hidden />
              Previous
            </Button>
          )}
          <SaveIndicator state={saveState} />
        </div>

        {showErrors && !completed[step] && (
          <p className="order-last flex w-full items-center gap-1.5 text-[12.5px] text-danger-600 sm:order-none sm:w-auto">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            Finish this step before continuing.
          </p>
        )}

        {isLast ? (
          <Button
            variant="success"
            size="lg"
            loading={launching}
            disabled={validating || blocked}
            onClick={() => setConfirmLaunch(true)}
          >
            <Rocket className="size-4" aria-hidden />
            Launch campaign
          </Button>
        ) : (
          <Button variant="success" size="md" onClick={next}>
            Next step
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmLaunch}
        onClose={() => setConfirmLaunch(false)}
        onConfirm={() => {
          setConfirmLaunch(false);
          void launch();
        }}
        title={
          draft.outreach.startMode === "IMMEDIATE"
            ? "Launch and start sending?"
            : "Create this campaign?"
        }
        scope={
          draft.outreach.startMode === "IMMEDIATE"
            ? `Up to ${draft.budget.dailyContacts} prospects a day will be emailed from ${
                senders.find((s) => s.id === draft.outreach.senderIdentityId)?.email ??
                "your connected mailbox"
              }.`
            : "The campaign will be created in READY state. Nothing will be sent until you activate it."
        }
        consequence="Every recipient is re-checked for suppression and contactability immediately before their message is sent, and anyone who has opted out is skipped."
        confirmLabel={
          draft.outreach.startMode === "IMMEDIATE" ? "Launch campaign" : "Create campaign"
        }
        loading={launching}
      />

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => router.push("/app/find-leads?view=campaigns")}
        title="Leave this campaign?"
        scope="Your draft is saved, so you can pick it up again from the Campaigns list."
        consequence="Nothing has been sent and no budget has been reserved."
        confirmLabel="Leave"
      />
    </div>
  );
}

/** The quiet autosave line. Never a modal, never a blocker. */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 text-[12px]",
        state === "error" ? "text-danger-600" : "text-content-muted",
      )}
    >
      {state === "saving" && (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </>
      )}
      {state === "saved" && (
        <>
          <Check className="size-3.5 text-success-600" aria-hidden />
          Saved
        </>
      )}
      {state === "error" && (
        <>
          <TriangleAlert className="size-3.5" aria-hidden />
          Couldn&rsquo;t save
        </>
      )}
    </span>
  );
}
