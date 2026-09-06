import {
  MAX_SEQUENCE_STEPS,
  type CampaignDraft,
  type BudgetCeilings,
  validateAudience,
  validateBudget,
  validateGoal,
  validateIntentScore,
  validateOutreach,
} from "./campaign-draft.ts";

/**
 * Launch validation (V4 section 17.7).
 *
 * Pure: it takes facts the server gathered and returns verdicts. The gathering
 * lives in `campaigns/server/validation.ts`; the *judgement* lives here so the
 * right-rail card and the launch gate cannot drift apart — the card renders
 * exactly the array the gate refuses on.
 *
 * A check is BLOCKED or it is not. A WARNING never stops a launch, which keeps
 * the rule "the button is disabled when and only when something is blocking"
 * true by construction.
 */

export const LAUNCH_CHECKS = [
  "SENDER_HEALTH",
  "PLAN_ENTITLEMENTS",
  "SUPPRESSION",
  "CONTACTABILITY",
  "SEQUENCE",
  "PROVIDER_HEALTH",
  "DOMAIN_SAFETY",
  "BUDGET",
] as const;

export type LaunchCheckKey = (typeof LAUNCH_CHECKS)[number];

export const LAUNCH_CHECK_LABELS: Record<LaunchCheckKey, string> = {
  SENDER_HEALTH: "Sender health",
  PLAN_ENTITLEMENTS: "Plan entitlements",
  SUPPRESSION: "Suppression check",
  CONTACTABILITY: "Contactability rules",
  SEQUENCE: "Sequence validity",
  PROVIDER_HEALTH: "Provider health",
  DOMAIN_SAFETY: "Domain/mailbox safety",
  BUDGET: "Budget and limits",
};

export type CheckState = "PASS" | "WARN" | "BLOCK";

export type LaunchCheck = {
  key: LaunchCheckKey;
  label: string;
  state: CheckState;
  /** The short right-hand summary in the validation rail. */
  detail: string;
  /** What the customer should do, when there is something to do. */
  fix?: { label: string; href: string };
};

/** Everything the server has to look up before a verdict can be reached. */
export type LaunchFacts = {
  sender: {
    exists: boolean;
    active: boolean;
    verified: boolean;
    coldEnabled: boolean;
    hasPostalFooter: boolean;
    spf: string;
    dkim: string;
    dmarc: string;
    bounceRate: number;
    complaintRate: number;
    /** HEALTHY | WATCH | WARNING | PAUSED */
    mailboxHealth: string;
    domainHealth: string;
    dailySendCap: number;
    pausedUntil: string | null;
  } | null;
  plan: {
    active: boolean;
    coldEmailEnabled: boolean;
    sourcingEnabled: boolean;
  };
  /** False when the suppression service could not be reached at all. */
  suppressionAvailable: boolean;
  contactabilityAvailable: boolean;
  /** Compliance policy pack resolved for the workspace's country. */
  policyPackVersion: string | null;
  providers: { healthy: boolean; degraded: string[] };
  service: { exists: boolean; active: boolean };
  savedSearchAvailable: boolean;
  intentCategoriesActive: boolean;
  scoringPolicyVersion: string | null;
  ceilings: BudgetCeilings;
};

const HEALTH_BLOCKING = new Set(["PAUSED"]);
const HEALTH_WARNING = new Set(["WARNING", "WATCH"]);

function senderCheck(draft: CampaignDraft, facts: LaunchFacts): LaunchCheck {
  const base = { key: "SENDER_HEALTH" as const, label: LAUNCH_CHECK_LABELS.SENDER_HEALTH };
  const connections = { label: "Open Connections", href: "/app/settings?view=connections" };
  const sender = facts.sender;

  if (!draft.outreach.senderIdentityId || !sender || !sender.exists) {
    return {
      ...base,
      state: "BLOCK",
      detail: "No sending identity attached",
      fix: connections,
    };
  }
  if (!sender.active) {
    return { ...base, state: "BLOCK", detail: "Sending identity is inactive", fix: connections };
  }
  if (!sender.verified) {
    return { ...base, state: "BLOCK", detail: "Not verified", fix: connections };
  }
  if (!sender.coldEnabled) {
    return { ...base, state: "BLOCK", detail: "Not enabled for cold outreach", fix: connections };
  }
  if (!sender.hasPostalFooter) {
    // Not a preference: a cold marketing email without a postal address is not
    // lawful to send in the UK.
    return {
      ...base,
      state: "BLOCK",
      detail: "No postal address on the identity",
      fix: connections,
    };
  }
  if (sender.pausedUntil && Date.parse(sender.pausedUntil) > Date.now()) {
    return { ...base, state: "BLOCK", detail: "Sender is paused", fix: connections };
  }

  const auth = [sender.spf, sender.dkim, sender.dmarc];
  if (auth.some((state) => state === "FAIL")) {
    return {
      ...base,
      state: "BLOCK",
      detail: "SPF, DKIM or DMARC is failing",
      fix: connections,
    };
  }
  if (auth.some((state) => state === "MISSING" || state === "UNKNOWN")) {
    return {
      ...base,
      state: "WARN",
      detail: "Email authentication is incomplete",
      fix: connections,
    };
  }

  return { ...base, state: "PASS", detail: "Good - SPF, DKIM, DMARC valid" };
}

function planCheck(draft: CampaignDraft, facts: LaunchFacts): LaunchCheck {
  const base = { key: "PLAN_ENTITLEMENTS" as const, label: LAUNCH_CHECK_LABELS.PLAN_ENTITLEMENTS };
  const billing = { label: "See plans", href: "/app/settings?view=billing" };

  if (!facts.plan.active) {
    return { ...base, state: "BLOCK", detail: "No active subscription", fix: billing };
  }
  if (!facts.plan.coldEmailEnabled) {
    return { ...base, state: "BLOCK", detail: "Cold email is not on this plan", fix: billing };
  }
  if (draft.audience.source !== "EXISTING_ONLY" && !facts.plan.sourcingEnabled) {
    return {
      ...base,
      state: "BLOCK",
      detail: "New sourcing is not on this plan",
      fix: billing,
    };
  }
  if (!facts.service.exists) {
    return { ...base, state: "BLOCK", detail: "The selected service no longer exists" };
  }
  if (!facts.service.active) {
    return { ...base, state: "BLOCK", detail: "The selected service is no longer active" };
  }
  return { ...base, state: "PASS", detail: "Within limits" };
}

function suppressionCheck(facts: LaunchFacts): LaunchCheck {
  const base = { key: "SUPPRESSION" as const, label: LAUNCH_CHECK_LABELS.SUPPRESSION };
  if (!facts.suppressionAvailable) {
    // Refusing to launch is the safe failure here. Sending without being able
    // to check who opted out is the one outcome that cannot be undone.
    return { ...base, state: "BLOCK", detail: "Suppression service unavailable" };
  }
  return { ...base, state: "PASS", detail: "No conflicts found" };
}

function contactabilityCheck(facts: LaunchFacts): LaunchCheck {
  const base = { key: "CONTACTABILITY" as const, label: LAUNCH_CHECK_LABELS.CONTACTABILITY };
  if (!facts.contactabilityAvailable) {
    return { ...base, state: "BLOCK", detail: "Contact rules could not be evaluated" };
  }
  if (!facts.policyPackVersion) {
    return { ...base, state: "BLOCK", detail: "No compliance policy configured" };
  }
  return { ...base, state: "PASS", detail: "Valid and configured" };
}

function sequenceCheck(draft: CampaignDraft): LaunchCheck {
  const base = { key: "SEQUENCE" as const, label: LAUNCH_CHECK_LABELS.SEQUENCE };
  const errors = validateOutreach(draft);
  const sequenceErrors = Object.entries(errors).filter(
    ([key]) => key === "steps" || key.startsWith("step-"),
  );

  if (sequenceErrors.length > 0) {
    return { ...base, state: "BLOCK", detail: sequenceErrors[0][1] };
  }

  const enabled = draft.outreach.steps.filter((step) => step.enabled).length;
  if (enabled > MAX_SEQUENCE_STEPS) {
    return { ...base, state: "BLOCK", detail: `More than ${MAX_SEQUENCE_STEPS} steps` };
  }
  return {
    ...base,
    state: "PASS",
    detail: `${enabled} email step${enabled === 1 ? "" : "s"} configured`,
  };
}

function providerCheck(draft: CampaignDraft, facts: LaunchFacts): LaunchCheck {
  const base = { key: "PROVIDER_HEALTH" as const, label: LAUNCH_CHECK_LABELS.PROVIDER_HEALTH };

  if (!facts.providers.healthy) {
    // Only blocking when the campaign actually depends on sourcing: an
    // existing-prospects campaign has no reason to care that Apollo is down.
    const needsProviders = draft.audience.source !== "EXISTING_ONLY";
    return {
      ...base,
      state: needsProviders ? "BLOCK" : "WARN",
      detail:
        facts.providers.degraded.length > 0
          ? `Unavailable: ${facts.providers.degraded.join(", ")}`
          : "A required provider is unavailable",
    };
  }
  if (draft.intentScore.intentRequired && !facts.intentCategoriesActive) {
    return { ...base, state: "BLOCK", detail: "Selected intent categories are inactive" };
  }
  if (draft.audience.savedSearchId && !facts.savedSearchAvailable) {
    return { ...base, state: "BLOCK", detail: "The saved search is no longer available" };
  }
  return { ...base, state: "PASS", detail: "All providers operational" };
}

function domainCheck(facts: LaunchFacts): LaunchCheck {
  const base = { key: "DOMAIN_SAFETY" as const, label: LAUNCH_CHECK_LABELS.DOMAIN_SAFETY };
  const sender = facts.sender;
  if (!sender) return { ...base, state: "BLOCK", detail: "No mailbox to check" };

  if (HEALTH_BLOCKING.has(sender.mailboxHealth) || HEALTH_BLOCKING.has(sender.domainHealth)) {
    return { ...base, state: "BLOCK", detail: "Sending is paused for this domain" };
  }
  if (sender.bounceRate > 0.05) {
    return { ...base, state: "BLOCK", detail: "Bounce rate above the safe threshold" };
  }
  if (sender.complaintRate > 0.003) {
    return { ...base, state: "BLOCK", detail: "Complaint rate above the safe threshold" };
  }
  if (HEALTH_WARNING.has(sender.mailboxHealth) || HEALTH_WARNING.has(sender.domainHealth)) {
    return { ...base, state: "WARN", detail: "Mailbox reputation needs watching" };
  }
  return { ...base, state: "PASS", detail: "No issues detected" };
}

function budgetCheck(draft: CampaignDraft, facts: LaunchFacts): LaunchCheck {
  const base = { key: "BUDGET" as const, label: LAUNCH_CHECK_LABELS.BUDGET };
  const errors = validateBudget(draft, facts.ceilings);
  const first = Object.values(errors)[0];
  if (first) return { ...base, state: "BLOCK", detail: first };

  const sender = facts.sender;
  if (sender && draft.budget.dailyContacts > sender.dailySendCap) {
    return {
      ...base,
      state: "BLOCK",
      detail: `Above the mailbox cap of ${sender.dailySendCap} a day`,
    };
  }
  return { ...base, state: "PASS", detail: "Within plan limits" };
}

/** The eight checks, always in the same order, always all present. */
export function evaluateLaunch(draft: CampaignDraft, facts: LaunchFacts): LaunchCheck[] {
  return [
    senderCheck(draft, facts),
    planCheck(draft, facts),
    suppressionCheck(facts),
    contactabilityCheck(facts),
    sequenceCheck(draft),
    providerCheck(draft, facts),
    domainCheck(facts),
    budgetCheck(draft, facts),
  ];
}

export function launchBlocked(checks: LaunchCheck[]): boolean {
  return checks.some((check) => check.state === "BLOCK");
}

export function launchSummary(checks: LaunchCheck[]): {
  ok: boolean;
  title: string;
  detail: string;
} {
  const blocked = checks.filter((c) => c.state === "BLOCK");
  const warned = checks.filter((c) => c.state === "WARN");

  if (blocked.length > 0) {
    return {
      ok: false,
      title: `${blocked.length} check${blocked.length === 1 ? "" : "s"} need attention`,
      detail: blocked.map((c) => c.detail).join(". "),
    };
  }
  if (warned.length > 0) {
    return {
      ok: true,
      title: "Ready to launch, with warnings",
      detail: warned.map((c) => c.detail).join(". "),
    };
  }
  return {
    ok: true,
    title: "All checks passed",
    detail: "Your campaign is ready to launch.",
  };
}

/**
 * The step-level completeness the review page shows next to each summary card.
 *
 * Uses the same validators the wizard used, rather than a second opinion, so a
 * card can never say "complete" about a step the stepper considers unfinished.
 */
export function reviewCompleteness(
  draft: CampaignDraft,
  ceilings: BudgetCeilings,
): Record<"goal" | "audience" | "intent" | "outreach" | "budget", boolean> {
  return {
    goal: Object.keys(validateGoal(draft)).length === 0,
    audience: Object.keys(validateAudience(draft)).length === 0,
    intent: Object.keys(validateIntentScore(draft)).length === 0,
    outreach: Object.keys(validateOutreach(draft)).length === 0,
    budget: Object.keys(validateBudget(draft, ceilings)).length === 0,
  };
}
