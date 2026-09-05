"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import {
  ONBOARDING_STEPS,
  previousStep,
  stepIndex,
  type OnboardingStep,
} from "@/lib/onboarding/steps";
import {
  advanceConnectLeadsStep,
  completeOnboarding,
  goToStep,
  readTestLead,
  runTestLead,
  saveBusinessStep,
  saveFollowUpStep,
  saveQualifyBookStep,
  type BusinessStepInput,
  type FollowUpStepInput,
  type OnboardingResult,
  type QualifyBookStepInput,
} from "@/lib/onboarding/actions";
import type { ActivationCheck } from "@/lib/onboarding/provision";
import type { TestLeadOutcome } from "@/lib/onboarding/test-lead";
import { OnboardingShell, WizardFooterActions } from "./onboarding-shell";
import type { StepActions } from "./step-types";
import { BusinessStep, type BusinessInitial } from "./steps/business-step";
import { ConnectLeadsStep } from "./steps/connect-leads-step";
import { FollowUpStep, type FollowUpInitial } from "./steps/follow-up-step";
import { QualifyBookStep, type QualifyBookInitial } from "./steps/qualify-book-step";
import { TestGoLiveStep } from "./steps/test-golive-step";

export type OnboardingInitial = {
  business: BusinessInitial;
  followUp: FollowUpInitial;
  qualifyBook: QualifyBookInitial;
  testGoLive: {
    checks: ActivationCheck[];
    services: { id: string; name: string }[];
    defaultPhone: string;
    initialOutcome: TestLeadOutcome | null;
  };
};

const NOOP: StepActions = { continue: () => {}, saveExit: () => {} };

export function OnboardingWizard({
  step,
  canEdit,
  initial,
}: {
  step: OnboardingStep;
  canEdit: boolean;
  initial: OnboardingInitial;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [saveExitPending, setSaveExitPending] = React.useState(false);
  const [actions, setActions] = React.useState<StepActions>(NOOP);

  const index = stepIndex(step);

  async function handleContinue(fn: () => Promise<OnboardingResult>) {
    setPending(true);
    try {
      const result = await fn();
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      if (result.nextStep === null) {
        router.push("/app");
        router.refresh();
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleSaveExit(fn: () => Promise<OnboardingResult>) {
    setSaveExitPending(true);
    try {
      const result = await fn();
      if (!result.ok) {
        toast({ variant: "error", title: "Not everything saved", description: result.error });
      }
    } finally {
      setSaveExitPending(false);
      router.push("/app");
      router.refresh();
    }
  }

  function back() {
    const target = previousStep(step);
    if (target) handleContinue(() => goToStep(target));
  }

  function jump(target: OnboardingStep) {
    if (target !== step) handleContinue(() => goToStep(target));
  }

  if (!canEdit) {
    return (
      <OnboardingShell step={step} completedThrough={index}>
        <p className="text-[13.5px] text-[#96a1b3]">
          Your workspace is still being set up by an owner or admin. You will get access as soon
          as they finish.
        </p>
      </OnboardingShell>
    );
  }

  return (
    <>
      <OnboardingShell step={step} completedThrough={index} onJump={jump}>
        {step === "business" && (
          <BusinessStep
            initial={initial.business}
            onContinue={(payload: BusinessStepInput) => handleContinue(() => saveBusinessStep(payload))}
            onSaveExit={(payload: BusinessStepInput) => handleSaveExit(() => saveBusinessStep(payload))}
            onRegisterActions={setActions}
          />
        )}

        {step === "connect_leads" && (
          <ConnectLeadsStep
            onContinue={() => handleContinue(() => advanceConnectLeadsStep())}
            onSaveExit={() => handleSaveExit(() => advanceConnectLeadsStep())}
            onRegisterActions={setActions}
          />
        )}

        {step === "follow_up" && (
          <FollowUpStep
            initial={initial.followUp}
            onContinue={(payload: FollowUpStepInput) => handleContinue(() => saveFollowUpStep(payload))}
            onSaveExit={(payload: FollowUpStepInput) => handleSaveExit(() => saveFollowUpStep(payload))}
            onRegisterActions={setActions}
          />
        )}

        {step === "qualify_book" && (
          <QualifyBookStep
            initial={initial.qualifyBook}
            onContinue={(payload: QualifyBookStepInput) =>
              handleContinue(() => saveQualifyBookStep(payload))
            }
            onSaveExit={(payload: QualifyBookStepInput) =>
              handleSaveExit(() => saveQualifyBookStep(payload))
            }
            onRegisterActions={setActions}
          />
        )}

        {step === "test_go_live" && (
          <TestGoLiveStep
            checks={initial.testGoLive.checks}
            services={initial.testGoLive.services}
            defaultPhone={initial.testGoLive.defaultPhone}
            initialOutcome={initial.testGoLive.initialOutcome}
            goLivePending={pending}
            onRunTest={async (input) => {
              const result = await runTestLead({
                name: input.name,
                phone: input.phone,
                serviceId: input.serviceId,
                message: input.message,
              });
              return result.ok
                ? { ok: true, outcome: result.outcome }
                : { ok: false, error: result.error };
            }}
            onReadTest={async () => {
              const result = await readTestLead();
              return result.ok ? { ok: true, outcome: result.outcome } : { ok: false };
            }}
            onGoLive={() => handleContinue(() => completeOnboarding())}
            onSaveExit={() => handleSaveExit(() => Promise.resolve({ ok: true, nextStep: step }))}
            onRegisterActions={setActions}
          />
        )}
      </OnboardingShell>

      <WizardFooterActions
        onBack={index > 0 ? back : undefined}
        onSaveExit={() => actions.saveExit()}
        onContinue={() => actions.continue()}
        continuePending={pending}
        saveExitPending={saveExitPending}
        continueDisabledReason={actions.disabledReason}
        isLastStep={step === "test_go_live"}
      />
    </>
  );
}

// Keeps the step order importable from one place for anything that needs to
// render a static list (e.g. a future admin funnel view).
export { ONBOARDING_STEPS };
