/**
 * `assertVoiceAllowed(ctx)`: may this workspace place (or answer with) a live
 * AI call at all? Pure over a snapshot the caller assembles server-side from
 * the subscription, `can()` capabilities, the minute balance, admin kill
 * switches, voice settings and the number record.
 *
 * Called on EVERY voice entry point (outbound dial, inbound answer, call-back,
 * test call, MCP, API), and again by the dial job immediately before dialling.
 *
 * OD-2 packaging (gap map "Owner decision OD-2"):
 *   - Starter and Growth: voice is an add-on only (minute packs plus a
 *     dedicated number item).
 *   - Pro: a £100 voice subscription item (200 included minutes plus the
 *     number) on by default and removable. Pro without the item may still buy
 *     packs, as may any paid plan ("the add-on on any paid plan").
 *   - Enterprise: contract; allowed when the capability is granted.
 *   - Trials, demos and free accounts never place a live call.
 *
 * Every denial maps to one of the product states every route implements
 * (CLAUDE.md): plan-limit-reached, integration-required, or error (an admin
 * kill switch is a service pause, shown as the error state with its reason).
 */

import { identityReadiness, type IdentityProblem } from "./identity.ts";

/** Declared in precedence order: the first that applies is `reason`. */
export const VOICE_DENIAL_REASONS = [
  "KILL_SWITCH_PLATFORM",
  "KILL_SWITCH_WORKSPACE",
  "TRIAL_ACCOUNT",
  "DEMO_ACCOUNT",
  "FREE_ACCOUNT",
  "SUBSCRIPTION_INACTIVE",
  "CAPABILITY_MISSING",
  "NO_VOICE_PACKAGE",
  "NO_MINUTES",
  "INSUFFICIENT_MINUTES",
  "VOICE_DISABLED_IN_SETTINGS",
  "AI_ASSISTANT_OFF",
  "IDENTITY_INCOMPLETE",
  "NO_NUMBER",
] as const;
export type VoiceDenialReason = (typeof VOICE_DENIAL_REASONS)[number];

export type ProductState = "plan-limit-reached" | "integration-required" | "error";

export const DENIAL_PRODUCT_STATE: Readonly<Record<VoiceDenialReason, ProductState>> = {
  TRIAL_ACCOUNT: "plan-limit-reached",
  DEMO_ACCOUNT: "plan-limit-reached",
  FREE_ACCOUNT: "plan-limit-reached",
  SUBSCRIPTION_INACTIVE: "plan-limit-reached",
  CAPABILITY_MISSING: "plan-limit-reached",
  NO_VOICE_PACKAGE: "plan-limit-reached",
  NO_MINUTES: "plan-limit-reached",
  INSUFFICIENT_MINUTES: "plan-limit-reached",
  KILL_SWITCH_PLATFORM: "error",
  KILL_SWITCH_WORKSPACE: "error",
  VOICE_DISABLED_IN_SETTINGS: "integration-required",
  AI_ASSISTANT_OFF: "integration-required",
  IDENTITY_INCOMPLETE: "integration-required",
  NO_NUMBER: "integration-required",
};

export type PlanKey = "trial" | "starter" | "growth" | "pro" | "enterprise" | "free";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "none";

export type VoiceEntitlementSnapshot = {
  plan: PlanKey;
  subscriptionStatus: SubscriptionStatus;
  isDemoWorkspace: boolean;
  /** `can(business, 'voice_sales_enabled')`, plan row plus grants. */
  voiceCapability: boolean;
  packaging: {
    /** The Pro £100 voice subscription item is active. */
    proVoiceItem: boolean;
    /** Any voice minute pack has been bought (balance may be zero). */
    addonPacksHeld: boolean;
    /** The £11.99 dedicated-number item (Starter/Growth, or Pro without the item). */
    dedicatedNumberItem: boolean;
  };
  minutes: { includedRemainingSec: number; packRemainingSec: number };
  killSwitch: { platform: boolean; workspace: boolean };
  settings: {
    voiceEnabled: boolean;
    /**
     * The workspace's AI assistant is on (business_settings.ai_assist_enabled,
     * the plan's AI allowance and an agent mode other than OFF). Every call
     * tool is gated on it (voice/tools/core.ts), so a call placed while it is
     * off can do nothing (second live call, 2026-09-28: every tool refused).
     * Absent = not known here (not blocked); false blocks the dial.
     */
    aiAssistantOn?: boolean;
  };
  identity: {
    callingAsName?: string | null;
    legalEntityName?: string | null;
    identificationContact?: string | null;
    personaName?: string | null;
  };
  /** Provisioning state of the workspace's dedicated number, if any. */
  number: { state: string; e164: string | null } | null;
};

export type VoiceEntitlementDecision =
  | { allowed: true; source: "PRO_VOICE_ITEM" | "ADDON" | "ENTERPRISE"; availableSec: number }
  | {
      allowed: false;
      reason: VoiceDenialReason;
      productState: ProductState;
      /** Every reason that applies, in precedence order (the first is `reason`). */
      reasons: VoiceDenialReason[];
      identityProblems?: IdentityProblem[];
    };

export type VoiceEntryPoint = "OUTBOUND_DIAL" | "INBOUND_ANSWER" | "CALLBACK" | "TEST_CALL" | "MCP" | "API";

const ACTIVE_STATUSES: readonly SubscriptionStatus[] = ["active"];
const PAID_PLANS: readonly PlanKey[] = ["starter", "growth", "pro", "enterprise"];

/**
 * @param requiredSec the reservation this call needs (budget.ts). Omit to ask
 *        only "is voice usable at all" (e.g. for the settings page).
 */
export function assertVoiceAllowed(
  ctx: VoiceEntitlementSnapshot,
  opts: { requiredSec?: number; entryPoint?: VoiceEntryPoint } = {},
): VoiceEntitlementDecision {
  const reasons: VoiceDenialReason[] = [];
  let identityProblems: IdentityProblem[] | undefined;

  // Kill switches first: an admin pause outranks everything and names itself.
  if (ctx.killSwitch.platform) reasons.push("KILL_SWITCH_PLATFORM");
  if (ctx.killSwitch.workspace) reasons.push("KILL_SWITCH_WORKSPACE");

  // Account type. Never a live call on a trial, demo or free workspace,
  // whatever plan is being trialled.
  if (ctx.isDemoWorkspace) reasons.push("DEMO_ACCOUNT");
  if (ctx.plan === "trial" || ctx.subscriptionStatus === "trialing") reasons.push("TRIAL_ACCOUNT");
  if (ctx.plan === "free") reasons.push("FREE_ACCOUNT");
  const paid = PAID_PLANS.includes(ctx.plan);
  if (paid && ctx.subscriptionStatus !== "trialing" && !ACTIVE_STATUSES.includes(ctx.subscriptionStatus)) {
    reasons.push("SUBSCRIPTION_INACTIVE");
  }

  // Capability and packaging.
  if (!ctx.voiceCapability) reasons.push("CAPABILITY_MISSING");
  let source: "PRO_VOICE_ITEM" | "ADDON" | "ENTERPRISE" | null = null;
  if (ctx.plan === "pro" && ctx.packaging.proVoiceItem) source = "PRO_VOICE_ITEM";
  else if (ctx.plan === "enterprise" && ctx.voiceCapability) source = "ENTERPRISE";
  else if (paid && ctx.packaging.addonPacksHeld) source = "ADDON";
  if (!source && paid) reasons.push("NO_VOICE_PACKAGE");

  // Minutes (prepaid only, no overage).
  const available = Math.max(0, ctx.minutes.includedRemainingSec) + Math.max(0, ctx.minutes.packRemainingSec);
  if (available <= 0) reasons.push("NO_MINUTES");
  else if (opts.requiredSec != null && available < opts.requiredSec) reasons.push("INSUFFICIENT_MINUTES");

  // Readiness (integration-required).
  if (!ctx.settings.voiceEnabled) reasons.push("VOICE_DISABLED_IN_SETTINGS");
  if (ctx.settings.aiAssistantOn === false) reasons.push("AI_ASSISTANT_OFF");
  const id = identityReadiness(ctx.identity);
  if (!id.ready) {
    reasons.push("IDENTITY_INCOMPLETE");
    identityProblems = id.problems;
  }
  // Every package needs an ACTIVE dedicated number (the Pro item includes one;
  // an add-on workspace must also hold the separately billed number item).
  const numberActive = ctx.number != null && ctx.number.state === "ACTIVE" && !!ctx.number.e164;
  if (!numberActive || (source === "ADDON" && !ctx.packaging.dedicatedNumberItem)) reasons.push("NO_NUMBER");

  if (reasons.length === 0 && source) return { allowed: true, source, availableSec: available };
  const precedence = VOICE_DENIAL_REASONS.filter((r) => reasons.includes(r));
  const reason = precedence[0] ?? "CAPABILITY_MISSING";
  return {
    allowed: false,
    reason,
    productState: DENIAL_PRODUCT_STATE[reason],
    reasons: precedence.length ? precedence : [reason],
    ...(identityProblems ? { identityProblems } : {}),
  };
}
