/**
 * OD-2 (2026-09-27): Pro is sold with voice by default. Pure: which Stripe
 * line items a subscription checkout, a plan change or a "remove voice"
 * carries, so the rules are tested without Stripe (TEST keys only in
 * production code, mocked in tests).
 *
 *   - Pro checkout, monthly: the plan item AND the £100/month voice item
 *     (200 included minutes plus the dedicated number), unless the owner
 *     chose "remove voice" (£399). Starter and Growth: the plan only (voice
 *     there is packs plus the number item, bought from Settings, Voice).
 *   - Pro checkout, annual: the plan only. The voice item has no annual
 *     price (no annual discount on it, OD-2), and a Stripe Checkout
 *     subscription mixing a yearly and a monthly price is UNVERIFIED for this
 *     account, so an annual Pro customer calls with minute packs and the
 *     £11.99 number item from Settings, Voice (the owner is told so).
 *   - A trial checkout carries the voice item too (it is part of the Pro price
 *     charged when the trial ends); no live call is placed during the trial
 *     whatever the items say (voice/entitlement.ts TRIAL_ACCOUNT).
 *   - Upgrading to Pro on a live subscription adds the voice item unless the
 *     owner opted out, or it is already there; the plan item alone is swapped.
 *   - Removing voice deletes only the voice item, prorated; the number is
 *     kept to the period end, then released unless the £11.99 number item is
 *     on the subscription.
 */

export type LineItem = { price: string; quantity: number };

export function includesVoiceByDefault(plan: string, interval: "month" | "year"): boolean {
  return plan === "pro" && interval === "month";
}

export function subscriptionCheckoutItems(input: {
  plan: string;
  interval: "month" | "year";
  planPriceId: string;
  voiceAddonPriceId: string | null;
  /** The owner's choice; absent = the default (voice included on Pro). */
  includeVoice?: boolean;
}): { items: LineItem[]; voiceIncluded: boolean; voiceUnavailableReason: "NOT_PRO" | "ANNUAL" | "OPTED_OUT" | "PRICE_NOT_CONFIGURED" | null } {
  const items: LineItem[] = [{ price: input.planPriceId, quantity: 1 }];
  if (input.plan !== "pro") return { items, voiceIncluded: false, voiceUnavailableReason: "NOT_PRO" };
  if (input.interval !== "month") return { items, voiceIncluded: false, voiceUnavailableReason: "ANNUAL" };
  if (input.includeVoice === false) return { items, voiceIncluded: false, voiceUnavailableReason: "OPTED_OUT" };
  if (!input.voiceAddonPriceId) return { items, voiceIncluded: false, voiceUnavailableReason: "PRICE_NOT_CONFIGURED" };
  return { items: [...items, { price: input.voiceAddonPriceId, quantity: 1 }], voiceIncluded: true, voiceUnavailableReason: null };
}

/**
 * The `items` for an immediate plan change: the plan item's price swapped,
 * and the voice item added when moving onto monthly Pro (unless opted out or
 * already present). Downgrades are scheduled elsewhere (plan-change.ts).
 */
export function planChangeItems(input: {
  planItemId: string;
  targetPriceId: string;
  targetPlan: string;
  interval: "month" | "year";
  existingPriceIds: readonly (string | null)[];
  voiceAddonPriceId: string | null;
  includeVoice?: boolean;
}): { items: ({ id: string; price: string } | LineItem)[]; voiceAdded: boolean } {
  const items: ({ id: string; price: string } | LineItem)[] = [{ id: input.planItemId, price: input.targetPriceId }];
  const already = Boolean(input.voiceAddonPriceId && input.existingPriceIds.includes(input.voiceAddonPriceId));
  const add =
    input.targetPlan === "pro" &&
    input.interval === "month" &&
    input.includeVoice !== false &&
    Boolean(input.voiceAddonPriceId) &&
    !already;
  if (add) items.push({ price: input.voiceAddonPriceId as string, quantity: 1 });
  return { items, voiceAdded: add };
}

export type VoiceRemovalPlan =
  | { ok: true; itemId: string; releaseNumberAt: string | null; keepsNumber: boolean }
  | { ok: false; reason: "NO_VOICE_ITEM" | "NOT_PRO" | "NO_SUBSCRIPTION" };

/** What "remove voice" does to a live Pro subscription. */
export function voiceRemovalPlan(input: {
  plan: string;
  items: readonly { id: string; priceId: string | null; currentPeriodEnd: number | null }[];
  voiceAddonPriceId: string | null;
  numberPriceId: string | null;
}): VoiceRemovalPlan {
  if (!input.items.length) return { ok: false, reason: "NO_SUBSCRIPTION" };
  if (input.plan !== "pro") return { ok: false, reason: "NOT_PRO" };
  const voice = input.items.find((i) => input.voiceAddonPriceId && i.priceId === input.voiceAddonPriceId);
  if (!voice) return { ok: false, reason: "NO_VOICE_ITEM" };
  const keepsNumber = Boolean(input.numberPriceId && input.items.some((i) => i.priceId === input.numberPriceId));
  const end = voice.currentPeriodEnd ? new Date(voice.currentPeriodEnd * 1000).toISOString() : null;
  return { ok: true, itemId: voice.id, releaseNumberAt: keepsNumber ? null : end, keepsNumber };
}
