"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, ShieldCheck } from "lucide-react";
import { completeOnboarding } from "@/lib/affiliates/actions";
import {
  EMPTY_DRAFT,
  ONBOARDING_STEPS,
  PROMOTION_METHODS,
  STEP_META,
  hasPayoutDetails,
  nextStep,
  previousStep,
  progressPercent,
  stepIndex,
  stepProblems,
  validateDraft,
  type OnboardingDraft,
  type OnboardingStep,
} from "@/lib/affiliates/onboarding";
import { formatMinor, type CommissionPlan } from "@/lib/affiliates/types";

/**
 * Partner onboarding (V4 §29-30).
 *
 * One step at a time, each gated by the same pure rules the server re-runs at
 * submit. The draft lives in component state and in `sessionStorage`, so a
 * refresh or an accidental back-navigation does not cost someone the two
 * minutes they just spent — but nothing is written to the database until they
 * press submit, so an abandoned wizard leaves no half-built partner record.
 */

const DRAFT_KEY = "ct_partner_onboarding";

export function OnboardingWizard({
  defaultName,
  defaultEmail,
  plan,
}: {
  defaultName: string;
  defaultEmail: string;
  plan: CommissionPlan | null;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<OnboardingStep>("profile");
  const [draft, setDraft] = React.useState<OnboardingDraft>({
    ...EMPTY_DRAFT,
    displayName: defaultName,
    contactEmail: defaultEmail,
  });
  const [showProblems, setShowProblems] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string>();

  // Restore once on mount. A stored draft only ever refills the form; it can
  // never skip a step, because every step is re-validated below.
  React.useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(DRAFT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<OnboardingDraft>;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore browser-only storage after hydration so the server and first client render match.
        setDraft((current) => ({ ...current, ...parsed }));
      }
    } catch {
      // A malformed or unavailable store is not worth interrupting anyone for.
    }
  }, []);

  React.useEffect(() => {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Private browsing and blocked storage both land here. The wizard still
      // works; it just will not survive a refresh.
    }
  }, [draft]);

  const set = <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const problems = stepProblems(step, draft);
  const canAdvance = problems.length === 0;

  const goNext = () => {
    if (!canAdvance) {
      setShowProblems(true);
      return;
    }
    setShowProblems(false);
    const following = nextStep(step);
    if (following) setStep(following);
  };

  const goBack = () => {
    setShowProblems(false);
    const preceding = previousStep(step);
    if (preceding) setStep(preceding);
  };

  const submit = async () => {
    const all = validateDraft(draft);
    if (all.length > 0) {
      setShowProblems(true);
      setFormError(all[0]);
      return;
    }

    setSubmitting(true);
    setFormError(undefined);
    try {
      const result = await completeOnboarding(draft);
      if (result.ok) {
        try {
          window.sessionStorage.removeItem(DRAFT_KEY);
        } catch {
          // Nothing depends on the draft surviving past this point.
        }
        router.replace("/affiliates/app");
        router.refresh();
        return;
      }
      setFormError(result.error);
    } catch {
      setFormError("Your application could not be sent. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full">
      <Progress step={step} />

      <div className="mt-7">
        <p className="text-[12.5px] font-bold tracking-[0.2em] text-[var(--auth-lime)] uppercase">
          Step {stepIndex(step) + 2} of {ONBOARDING_STEPS.length + 1}
        </p>
        <h1 className="mt-3 text-[28px] leading-[1.08] font-bold tracking-[-0.025em] text-[var(--auth-text)] sm:text-[32px]">
          {STEP_META[step].title}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--auth-text-muted)]">
          {STEP_META[step].description}
        </p>
      </div>

      <div className="mt-7 space-y-5">
        {step === "profile" && (
          <>
            <Field
              label="Name or brand"
              hint="How you want to be credited. This is not shown to customers."
              value={draft.displayName}
              onChange={(value) => set("displayName", value)}
              autoComplete="organization"
            />
            <Field
              label="Contact email"
              type="email"
              hint="Application decisions and payout notices go here."
              value={draft.contactEmail}
              onChange={(value) => set("contactEmail", value)}
              autoComplete="email"
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Company"
                optional
                value={draft.companyName}
                onChange={(value) => set("companyName", value)}
                autoComplete="organization"
              />
              <Field
                label="Country"
                value={draft.country}
                onChange={(value) => set("country", value)}
                autoComplete="country-name"
              />
            </div>
            <Field
              label="Website or main channel"
              optional
              placeholder="https://"
              value={draft.websiteUrl}
              onChange={(value) => set("websiteUrl", value)}
              autoComplete="url"
            />
          </>
        )}

        {step === "audience" && (
          <>
            <TextArea
              label="Tell us about your audience"
              hint="Who they are, and why ClientTurn would be useful to them. A couple of honest sentences is plenty — this is the part a reviewer actually reads."
              rows={6}
              value={draft.audienceDescription}
              onChange={(value) => set("audienceDescription", value)}
            />
            <Field
              label="Roughly how many people do you reach?"
              optional
              placeholder="e.g. 4,000 newsletter subscribers"
              value={draft.audienceSize}
              onChange={(value) => set("audienceSize", value)}
            />
          </>
        )}

        {step === "promotion" && (
          <>
            <fieldset>
              <legend className="mb-3 block text-[14.5px] font-semibold text-[#f6f8fb]">
                Where will your links live?
              </legend>
              <div className="flex flex-wrap gap-2">
                {PROMOTION_METHODS.map((method) => {
                  const on = draft.promotionMethods.includes(method);
                  return (
                    <button
                      key={method}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        set(
                          "promotionMethods",
                          on
                            ? draft.promotionMethods.filter((m) => m !== method)
                            : [...draft.promotionMethods, method],
                        )
                      }
                      className={
                        on
                          ? "inline-flex items-center gap-1.5 rounded-full border border-[rgba(168,255,31,0.5)] bg-[rgba(168,255,31,0.12)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--auth-lime)]"
                          : "inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3.5 py-2 text-[13.5px] text-[var(--auth-text-muted)] transition-colors hover:border-white/25 hover:text-[var(--auth-text)]"
                      }
                    >
                      {on && <Check className="size-3.5" aria-hidden />}
                      {method}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3.5 text-[13px] leading-relaxed text-[var(--auth-text-muted)]">
              <p className="font-semibold text-[var(--auth-text)]">
                What we cannot accept
              </p>
              <p className="mt-1.5">
                Paid search on the ClientTurn brand name, coupon and cashback
                sites, and unsolicited email. Referring yourself earns nothing.
              </p>
            </div>
          </>
        )}

        {step === "payout" && (
          <>
            <div className="rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3.5 text-[13px] leading-relaxed text-[var(--auth-text-muted)]">
              You can skip this and add it later — it is only needed before your
              first payout.
            </div>

            <div>
              <label className="mb-2 block text-[14.5px] font-semibold text-[#f6f8fb]">
                How should we pay you?
              </label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["BANK_TRANSFER", "Bank transfer"],
                    ["PAYPAL", "PayPal"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={draft.payoutMethod === value}
                    onClick={() =>
                      set(
                        "payoutMethod",
                        draft.payoutMethod === value ? "" : value,
                      )
                    }
                    className={
                      draft.payoutMethod === value
                        ? "rounded-full border border-[rgba(168,255,31,0.5)] bg-[rgba(168,255,31,0.12)] px-4 py-2 text-[13.5px] font-medium text-[var(--auth-lime)]"
                        : "rounded-full border border-white/12 px-4 py-2 text-[13.5px] text-[var(--auth-text-muted)] transition-colors hover:border-white/25 hover:text-[var(--auth-text)]"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {draft.payoutMethod && (
              <>
                <Field
                  label="Account name"
                  value={draft.payoutAccountName}
                  onChange={(value) => set("payoutAccountName", value)}
                  autoComplete="off"
                />
                <Field
                  label={
                    draft.payoutMethod === "PAYPAL"
                      ? "PayPal email"
                      : "Payment reference"
                  }
                  hint="We never ask for a full account number here. A payout is made by a person against these details."
                  value={draft.payoutReference}
                  onChange={(value) => set("payoutReference", value)}
                  autoComplete="off"
                />
              </>
            )}
          </>
        )}

        {step === "review" && (
          <>
            <Summary draft={draft} plan={plan} />

            <label className="flex items-start gap-3 text-[13.5px] leading-relaxed text-[var(--auth-text-muted)]">
              <input
                type="checkbox"
                checked={draft.acceptedTerms}
                onChange={(event) => set("acceptedTerms", event.target.checked)}
                className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded-[5px] border border-white/25 bg-[var(--auth-input-bg)] accent-[var(--auth-lime)]"
              />
              <span>
                I have read and accept the{" "}
                <Link
                  href="/terms"
                  className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
                >
                  programme terms
                </Link>
                , including that commission is confirmed only after the refund
                hold period and that self-referrals do not earn.
              </span>
            </label>
          </>
        )}

        {showProblems && problems.length > 0 && (
          <ul className="space-y-1 rounded-[12px] border border-[var(--auth-danger)] bg-[rgba(255,90,90,0.08)] px-4 py-3 text-[13px] text-[var(--auth-danger-text)]">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        {formError && (
          <p className="rounded-[12px] border border-[var(--auth-danger)] bg-[rgba(255,90,90,0.08)] px-4 py-3 text-[13px] text-[var(--auth-danger-text)]">
            {formError}
          </p>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        {previousStep(step) ? (
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-2 text-[14px] font-medium text-[var(--auth-text-muted)] transition-colors hover:text-[var(--auth-text)]"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
        ) : (
          <span />
        )}

        {step === "review" ? (
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            aria-busy={submitting}
            className="group inline-flex h-[52px] items-center justify-center gap-2 rounded-[11px] px-7 text-[15.5px] font-bold text-[var(--auth-on-lime)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_14px_38px_rgba(168,255,31,0.28)] disabled:cursor-not-allowed disabled:opacity-70"
            style={{
              background:
                "linear-gradient(135deg, var(--auth-lime-hover), var(--auth-lime))",
            }}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Sending…
              </>
            ) : (
              <>
                Submit application
                <ArrowRight className="size-4.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            className="group inline-flex h-[52px] items-center justify-center gap-2 rounded-[11px] px-7 text-[15.5px] font-bold text-[var(--auth-on-lime)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_14px_38px_rgba(168,255,31,0.28)]"
            style={{
              background:
                "linear-gradient(135deg, var(--auth-lime-hover), var(--auth-lime))",
            }}
          >
            Continue
            <ArrowRight className="size-4.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </button>
        )}
      </div>

      {step === "payout" && !hasPayoutDetails(draft) && (
        <p className="mt-4 text-right text-[12.5px] text-[var(--auth-text-subtle)]">
          Leaving this blank is fine — you can add it before your first payout.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Progress({ step }: { step: OnboardingStep }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] text-[var(--auth-text-subtle)]">
        <span>{STEP_META[step].title}</span>
        <span>
          {stepIndex(step) + 1} of {ONBOARDING_STEPS.length}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8"
        role="progressbar"
        aria-valuenow={progressPercent(step)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Application progress"
      >
        <div
          className="h-full rounded-full bg-[var(--auth-lime)] transition-[width] duration-300"
          style={{ width: `${Math.max(progressPercent(step), 8)}%` }}
        />
      </div>
    </div>
  );
}

function Summary({
  draft,
  plan,
}: {
  draft: OnboardingDraft;
  plan: CommissionPlan | null;
}) {
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-white/8 rounded-[12px] border border-white/8 bg-white/[0.03]">
        <Row label="Name">{draft.displayName || "—"}</Row>
        <Row label="Contact">{draft.contactEmail || "—"}</Row>
        {draft.companyName && <Row label="Company">{draft.companyName}</Row>}
        {draft.websiteUrl && <Row label="Website">{draft.websiteUrl}</Row>}
        <Row label="Audience">
          <span className="whitespace-pre-wrap">{draft.audienceDescription}</span>
          {draft.audienceSize && (
            <span className="mt-1 block text-[var(--auth-text-subtle)]">
              {draft.audienceSize}
            </span>
          )}
        </Row>
        <Row label="Promotion">
          {draft.promotionMethods.join(", ") || "—"}
        </Row>
        <Row label="Payouts">
          {hasPayoutDetails(draft)
            ? `${draft.payoutMethod === "PAYPAL" ? "PayPal" : "Bank transfer"} · ${draft.payoutAccountName}`
            : "Not set yet — you can add this later"}
        </Row>
      </dl>

      {plan && (
        <div className="rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--auth-text)]">
            <ShieldCheck className="size-4 text-[var(--auth-lime)]" aria-hidden />
            What you would earn
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--auth-text-muted)]">
            {plan.commissionType === "FLAT_AMOUNT"
              ? `${formatMinor(plan.flatAmountMinor ?? 0, plan.currency)} per paying customer.`
              : plan.commissionType === "FIRST_PAYMENT_PERCENT"
                ? `${plan.percent ?? 0}% of the first payment.`
                : plan.recurringMonths
                  ? `${plan.percent ?? 0}% of every payment for ${plan.recurringMonths} months.`
                  : `${plan.percent ?? 0}% of every payment, for the life of the customer.`}{" "}
            Confirmed after a {plan.holdDays}-day hold, paid once your approved
            balance reaches{" "}
            {formatMinor(plan.minimumPayoutMinor, plan.currency)}. Final terms
            are confirmed when your application is approved.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-[13.5px]">
      <dt className="w-28 shrink-0 text-[var(--auth-text-subtle)]">{label}</dt>
      <dd className="min-w-0 flex-1 text-[var(--auth-text)]">{children}</dd>
    </div>
  );
}

const INPUT =
  "h-[52px] w-full rounded-[var(--auth-radius-input)] border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] px-4 text-[15px] text-[#e8edf4] shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#768499] focus:border-[rgba(168,255,31,0.75)] focus:ring-[4px] focus:ring-[rgba(168,255,31,0.12)]";

function Field({
  label,
  value,
  onChange,
  hint,
  type = "text",
  placeholder,
  optional,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  type?: string;
  placeholder?: string;
  optional?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-[14.5px] font-semibold text-[#f6f8fb]">
        {label}
        {optional && (
          <span className="ml-2 font-normal text-[var(--auth-text-subtle)]">
            Optional
          </span>
        )}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT}
      />
      {hint && (
        <span className="mt-1.5 block text-[12.5px] leading-relaxed text-[var(--auth-text-subtle)]">
          {hint}
        </span>
      )}
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  hint,
  rows = 5,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  rows?: number;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-[14.5px] font-semibold text-[#f6f8fb]">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        maxLength={2000}
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT} h-auto resize-y py-3 leading-relaxed`}
      />
      {hint && (
        <span className="mt-1.5 block text-[12.5px] leading-relaxed text-[var(--auth-text-subtle)]">
          {hint}
        </span>
      )}
    </label>
  );
}
