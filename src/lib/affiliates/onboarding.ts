/**
 * Partner onboarding (V4 §29-30).
 *
 * Pure — no `server-only`, no Supabase — so the wizard's client components and
 * `node --test` can both use it. Relative imports with extensions for the same
 * reason.
 *
 * Onboarding *is* the application. Signup creates an account; these steps
 * collect what a human reviewer needs to make a decision, and the `affiliates`
 * row is written once at the end. A half-finished wizard leaves no partial
 * partner record for an operator to puzzle over.
 */

export const ONBOARDING_STEPS = [
  "profile",
  "audience",
  "promotion",
  "payout",
  "review",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const STEP_META: Record<
  OnboardingStep,
  { title: string; description: string }
> = {
  profile: {
    title: "About you",
    description: "How you want to be credited, and where we can reach you.",
  },
  audience: {
    title: "Your audience",
    description: "Who you reach, and why ClientTurn would be useful to them.",
  },
  promotion: {
    title: "How you'll promote",
    description: "Where your referral links are going to live.",
  },
  payout: {
    title: "Getting paid",
    description: "Where commission is sent once it clears the hold period.",
  },
  review: {
    title: "Check and submit",
    description: "One last look before this goes to a reviewer.",
  },
};

export const PROMOTION_METHODS = [
  "Newsletter",
  "YouTube or podcast",
  "Social media",
  "Blog or SEO",
  "Agency clients",
  "Community or group",
  "Events",
  "In person",
] as const;

export type OnboardingDraft = {
  displayName: string;
  companyName: string;
  contactEmail: string;
  websiteUrl: string;
  country: string;
  audienceDescription: string;
  audienceSize: string;
  promotionMethods: string[];
  payoutMethod: "BANK_TRANSFER" | "PAYPAL" | "";
  payoutAccountName: string;
  payoutReference: string;
  acceptedTerms: boolean;
};

export const EMPTY_DRAFT: OnboardingDraft = {
  displayName: "",
  companyName: "",
  contactEmail: "",
  websiteUrl: "",
  country: "United Kingdom",
  audienceDescription: "",
  audienceSize: "",
  promotionMethods: [],
  payoutMethod: "",
  payoutAccountName: "",
  payoutReference: "",
  acceptedTerms: false,
};

/** A website is optional, but a malformed one is worse than none. */
export function isPlausibleUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return /^https?:\/\/[^\s./]+\.[^\s.]+/i.test(trimmed);
}

export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * What is still wrong with a step, as messages a person can act on.
 *
 * Every step validates the same way here and on the server. This is the
 * courtesy copy that stops someone reaching step 5 before being told step 1 was
 * incomplete; `validateDraft` below is what actually gates the write.
 */
export function stepProblems(
  step: OnboardingStep,
  draft: OnboardingDraft,
): string[] {
  const problems: string[] = [];

  switch (step) {
    case "profile":
      if (draft.displayName.trim().length < 2) {
        problems.push("Enter the name you want to be credited as.");
      }
      if (!isPlausibleEmail(draft.contactEmail)) {
        problems.push("Enter a valid contact email address.");
      }
      if (!isPlausibleUrl(draft.websiteUrl)) {
        problems.push("A website must start with http:// or https://.");
      }
      break;

    case "audience":
      // Twenty characters is roughly one honest sentence. Less than that
      // cannot tell a reviewer anything, and this is the field they read.
      if (draft.audienceDescription.trim().length < 20) {
        problems.push(
          "Tell us a little more about your audience — a sentence or two is plenty.",
        );
      }
      break;

    case "promotion":
      if (draft.promotionMethods.length === 0) {
        problems.push("Choose at least one way you plan to promote us.");
      }
      break;

    case "payout":
      // Payout details are optional at application time: someone can be
      // approved and add them before the first payout run. Half-filled is the
      // only state worth refusing, because it silently fails later.
      if (draft.payoutMethod || draft.payoutAccountName || draft.payoutReference) {
        if (!draft.payoutMethod) problems.push("Choose how you want to be paid.");
        if (draft.payoutAccountName.trim().length < 2) {
          problems.push("Enter the account name.");
        }
        if (draft.payoutReference.trim().length < 4) {
          problems.push("Enter the payment reference or PayPal email.");
        }
      }
      break;

    case "review":
      if (!draft.acceptedTerms) {
        problems.push("Accept the programme terms to submit your application.");
      }
      break;
  }

  return problems;
}

export function isStepComplete(
  step: OnboardingStep,
  draft: OnboardingDraft,
): boolean {
  return stepProblems(step, draft).length === 0;
}

/** True when payout details were filled in completely. */
export function hasPayoutDetails(draft: OnboardingDraft): boolean {
  return Boolean(
    draft.payoutMethod &&
      draft.payoutAccountName.trim().length >= 2 &&
      draft.payoutReference.trim().length >= 4,
  );
}

/**
 * Every problem across every step.
 *
 * The submit button checks this rather than only the current step: arriving at
 * "review" with an empty audience should be impossible, but a resumed draft or
 * a hand-edited form makes it possible, and the server refuses either way.
 */
export function validateDraft(draft: OnboardingDraft): string[] {
  return ONBOARDING_STEPS.flatMap((step) => stepProblems(step, draft));
}

export function firstIncompleteStep(draft: OnboardingDraft): OnboardingStep | null {
  return ONBOARDING_STEPS.find((step) => !isStepComplete(step, draft)) ?? null;
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const index = stepIndex(step);
  return index > 0 ? ONBOARDING_STEPS[index - 1] : null;
}

/** How far along the wizard is, for the progress bar. */
export function progressPercent(step: OnboardingStep): number {
  return Math.round((stepIndex(step) / (ONBOARDING_STEPS.length - 1)) * 100);
}

export function parseStep(value: unknown): OnboardingStep {
  return typeof value === "string" &&
    ONBOARDING_STEPS.includes(value as OnboardingStep)
    ? (value as OnboardingStep)
    : "profile";
}
