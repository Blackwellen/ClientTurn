/**
 * Which Stripe subscription item is which. Pure: no `server-only`, no Stripe
 * SDK, no I/O, so `tests/voice-subscription-items.test.ts` imports it directly.
 *
 * A ClientTurn subscription can carry more than one item since voice (OD-2):
 * the plan price, the Pro voice item (£100, 200 minutes plus the number) and
 * the dedicated-number item (£11.99). Stripe does not promise any order, so
 * `items.data[0]` is NOT "the plan" -- it used to be read that way, which
 * would have mirrored a voice price as the plan (and so as "trial") the moment
 * a number item was added. Every reader goes through `selectPlanItem`.
 */

/** The fields of a `Stripe.SubscriptionItem` these helpers read. */
export type SubscriptionItemLike = {
  id: string;
  price?: {
    id?: string | null;
    unit_amount?: number | null;
    currency?: string | null;
    recurring?: { interval?: string | null } | null;
  } | null;
  quantity?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
};

/** The voice price ids, from env (`serverEnv.stripe.prices.voice`). */
export type VoicePriceIds = {
  addonMonthly?: string | null;
  numberMonthly?: string | null;
};

function priceIdOf(item: SubscriptionItemLike): string | null {
  const id = item.price?.id;
  return typeof id === "string" && id ? id : null;
}

function isVoicePrice(priceId: string | null, voice: VoicePriceIds | undefined): boolean {
  if (!priceId || !voice) return false;
  return priceId === voice.addonMonthly || priceId === voice.numberMonthly;
}

/**
 * The item that carries the plan: the first item whose price maps to a
 * self-serve plan (`planForPriceId` returns anything but "trial"). When none
 * maps (a legacy or hand-made price), the first item that is not a known voice
 * item, so the mirror still records a price; null when there is nothing but
 * voice items, or nothing at all.
 */
export function selectPlanItem<T extends SubscriptionItemLike>(
  items: readonly T[] | null | undefined,
  planForPriceId: (priceId: string | null | undefined) => string,
  voicePriceIds?: VoicePriceIds,
): T | null {
  const list = items ?? [];
  for (const item of list) {
    const priceId = priceIdOf(item);
    if (priceId && !isVoicePrice(priceId, voicePriceIds) && planForPriceId(priceId) !== "trial") return item;
  }
  for (const item of list) {
    if (!isVoicePrice(priceIdOf(item), voicePriceIds)) return item;
  }
  return null;
}

export type VoiceItem = {
  itemId: string;
  priceId: string;
  /** Unix seconds, as Stripe sends them. */
  periodStart: number | null;
  periodEnd: number | null;
};

export type VoiceItems = {
  /** The Pro £100 voice item (200 included minutes plus the number). */
  proVoice: VoiceItem | null;
  /** The £11.99 dedicated-number item. */
  number: VoiceItem | null;
};

/** The voice items on a subscription, matched by price id (never by position). */
export function voiceItemsOf(
  items: readonly SubscriptionItemLike[] | null | undefined,
  voicePriceIds: VoicePriceIds,
): VoiceItems {
  const found: VoiceItems = { proVoice: null, number: null };
  for (const item of items ?? []) {
    const priceId = priceIdOf(item);
    if (!priceId) continue;
    const entry: VoiceItem = {
      itemId: item.id,
      priceId,
      periodStart: item.current_period_start ?? null,
      periodEnd: item.current_period_end ?? null,
    };
    if (voicePriceIds.addonMonthly && priceId === voicePriceIds.addonMonthly && !found.proVoice) {
      found.proVoice = entry;
    } else if (voicePriceIds.numberMonthly && priceId === voicePriceIds.numberMonthly && !found.number) {
      found.number = entry;
    }
  }
  return found;
}

/* ------------------------------------------------------------ grant plan */

/** Grant keys written for voice items (0151: voice is a grant, never a plan key). */
export const VOICE_ITEM_GRANT_KEYS = {
  salesEnabled: "voice_sales_enabled",
  minutesIncluded: "voice_minutes_included",
  proItem: "voice_pro_item",
  numberItem: "voice_number_item",
} as const;

/** Reason on a grant written because a minute pack was bought. */
export const VOICE_PACK_GRANT_REASON = "VOICE_PACK";

/** Reason on a grant written because a subscription item is present. */
export function stripeItemGrantReason(itemId: string): string {
  return `STRIPE_ITEM:${itemId}`;
}

export type VoiceGrantUpsert = {
  entitlementKey: string;
  numericValue: number | null;
  booleanValue: boolean | null;
  reason: string;
};

export type VoiceGrantChanges = {
  upserts: VoiceGrantUpsert[];
  /** Keys whose STRIPE_ITEM grant must be revoked (the item is gone). */
  revokeKeys: string[];
};

/**
 * The grant writes a subscription's voice items call for. Idempotent by
 * construction: the same items always yield the same rows (upserted on
 * `(business_id, entitlement_key)`), and revocations are conditional on the
 * grant still being live and item-sourced, so a replay changes nothing.
 * A subscription that is deleted (or otherwise over) has no live items.
 */
export function voiceGrantChanges(
  items: VoiceItems,
  options: { ended: boolean; includedMinutes: number },
): VoiceGrantChanges {
  const pro = options.ended ? null : items.proVoice;
  const number = options.ended ? null : items.number;
  const upserts: VoiceGrantUpsert[] = [];
  const revokeKeys: string[] = [];
  const k = VOICE_ITEM_GRANT_KEYS;

  if (pro) {
    const reason = stripeItemGrantReason(pro.itemId);
    upserts.push(
      { entitlementKey: k.salesEnabled, numericValue: 1, booleanValue: true, reason },
      { entitlementKey: k.minutesIncluded, numericValue: options.includedMinutes, booleanValue: null, reason },
      { entitlementKey: k.proItem, numericValue: null, booleanValue: true, reason },
    );
  } else {
    revokeKeys.push(k.salesEnabled, k.minutesIncluded, k.proItem);
  }

  if (number) {
    upserts.push({
      entitlementKey: k.numberItem,
      numericValue: null,
      booleanValue: true,
      reason: stripeItemGrantReason(number.itemId),
    });
  } else {
    revokeKeys.push(k.numberItem);
  }
  return { upserts, revokeKeys };
}

/** Stripe statuses after which a subscription's items grant nothing. */
export function subscriptionEnded(status: string | null | undefined, deleted: boolean): boolean {
  return deleted || status === "canceled" || status === "incomplete_expired";
}
