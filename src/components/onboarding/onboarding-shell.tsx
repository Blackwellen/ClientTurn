"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { STEP_META, type OnboardingStep } from "@/lib/onboarding/steps";
import { OButton } from "./ui";
import { WizardProgress, WizardProgressMobile } from "./wizard-progress";

function HandwrittenNote({ step }: { step: OnboardingStep }) {
  const isLast = step === "test_go_live";
  return (
    <div
      className="hidden shrink-0 items-start gap-1 lg:flex"
      style={{ fontFamily: "var(--font-caveat)" }}
    >
      <svg width="34" height="46" viewBox="0 0 34 46" fill="none" className="mt-3 -scale-x-100 opacity-90">
        <path
          d="M28 4C22 14 10 20 6 36"
          stroke="var(--auth-lime)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M6 36L14 32.5M6 36L9 43.5"
          stroke="var(--auth-lime)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="text-[22px] leading-[1.15] text-[var(--auth-lime)]">
        {isLast ? (
          "You're almost there!"
        ) : (
          <>
            5 simple steps
            <br />
            to more business.
          </>
        )}
      </p>
    </div>
  );
}

export function OnboardingShell({
  step,
  completedThrough,
  onJump,
  children,
}: {
  step: OnboardingStep;
  completedThrough: number;
  onJump?: (step: OnboardingStep) => void;
  children: ReactNode;
}) {
  const meta = STEP_META[step];

  return (
    <div className="mx-auto w-[calc(100%-32px)] max-w-[1580px] px-0 py-6 sm:py-8 lg:py-10">
      <header className="flex items-start justify-between gap-4">
        <Logo href={null} height={60} />
        <p className="hidden max-w-[280px] pt-2 text-right text-[13px] leading-snug text-[#8c98ab] sm:block">
          More leads. More bookings. A more profitable business.
        </p>
      </header>

      <div className="mt-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[36px] leading-[1] font-extrabold tracking-[-0.03em] text-[#f8fafc] sm:text-[48px] lg:text-[58px]">
            Set up <span className="text-[var(--auth-lime)]">ClientTurn</span>
          </h1>
          <p className="mt-2.5 max-w-[640px] text-[16px] leading-relaxed text-[#c7d0dc] sm:text-[19px]">
            Complete these steps to get to a live test lead as quickly as possible.
          </p>
        </div>
        <HandwrittenNote step={step} />
      </div>

      <WizardProgress current={step} completedThrough={completedThrough} onJump={onJump} />
      <WizardProgressMobile current={step} />

      <div
        className="mt-6 rounded-[20px] border border-[rgba(130,155,180,0.26)] p-4 sm:p-6 lg:p-7"
        style={{
          background: "linear-gradient(180deg, rgba(9,17,24,0.98), rgba(5,11,17,0.99))",
          boxShadow: "0 30px 90px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.025)",
        }}
      >
        <div className="mb-5">
          <p className="text-[12.5px] font-medium tracking-wide text-[#7a8698] uppercase">
            Step {meta.number} of 5
          </p>
          <h2 className="mt-1 text-[26px] font-bold tracking-[-0.01em] text-[#f8fafc] sm:text-[32px]">
            {meta.title}
          </h2>
          <p className="mt-1.5 max-w-[760px] text-[14px] leading-relaxed text-[#a7b2c2] sm:text-[15px]">
            {meta.description}
          </p>
        </div>

        {children}
      </div>
    </div>
  );
}

export function WizardFooterActions({
  onBack,
  backDisabled,
  onSaveExit,
  onContinue,
  continueLabel = "Continue",
  continuePending,
  saveExitPending,
  continueDisabledReason,
  isLastStep,
}: {
  onBack?: () => void;
  backDisabled?: boolean;
  onSaveExit: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continuePending?: boolean;
  saveExitPending?: boolean;
  continueDisabledReason?: string;
  isLastStep?: boolean;
}) {
  return (
    <div className="mx-auto mt-5 flex w-[calc(100%-32px)] max-w-[1580px] items-center justify-between gap-3">
      <OButton
        variant="secondary"
        onClick={onBack}
        disabled={backDisabled || !onBack || continuePending || saveExitPending}
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back
      </OButton>
      <div className="flex flex-col items-end gap-1.5">
        {continueDisabledReason && (
          <p className="text-right text-[12.5px] text-[#ffb020]">{continueDisabledReason}</p>
        )}
        <div className="flex items-center gap-2">
          <OButton
            variant="secondary"
            onClick={onSaveExit}
            loading={saveExitPending}
            disabled={continuePending}
          >
            Save &amp; exit
          </OButton>
          <OButton
            onClick={onContinue}
            loading={continuePending}
            disabled={saveExitPending || Boolean(continueDisabledReason)}
          >
            {isLastStep ? "Go live" : continueLabel}
            <ArrowRight className="size-3.5" aria-hidden />
          </OButton>
        </div>
      </div>
    </div>
  );
}
