/**
 * The identity of a `lead_sources` row (B11).
 *
 * A lead source is one *attribution tuple* — provider, page, form, campaign,
 * ad set and ad — not one form. Keying on (provider, form) alone made every
 * lead from a form inherit the first lead's campaign, ad set and ad, which is
 * exactly the campaign-level attribution the product promises. Display names
 * (campaign_name, ad_name, …) are deliberately not part of the key: a renamed
 * campaign is the same campaign.
 *
 * The matching unique index is `lead_sources_attribution_key` (migration
 * 0114, NULLS NOT DISTINCT), so the lookup here and the database agree on what
 * "the same source" means. Pure, and free of `server-only`, so it is testable.
 */

export const ATTRIBUTION_COLUMNS = [
  "provider",
  "page_id",
  "form_id",
  "campaign_id",
  "adset_id",
  "ad_id",
] as const;

export type AttributionColumn = (typeof ATTRIBUTION_COLUMNS)[number];
export type AttributionTuple = { provider: string } & Record<
  Exclude<AttributionColumn, "provider">,
  string | null
>;

function id(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function attributionTuple(source: {
  provider: string;
  pageId?: string | null;
  formId?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
}): AttributionTuple {
  return {
    provider: source.provider,
    page_id: id(source.pageId),
    form_id: id(source.formId),
    campaign_id: id(source.campaignId),
    adset_id: id(source.adsetId),
    ad_id: id(source.adId),
  };
}

export function sameAttribution(a: AttributionTuple, b: AttributionTuple): boolean {
  return ATTRIBUTION_COLUMNS.every((column) => a[column] === b[column]);
}

/**
 * Applies a null-safe equality filter for every tuple column: `IS NULL` for a
 * missing id, `=` otherwise. `= NULL` never matches in SQL, so using `eq` for
 * a null would miss the row and insert a duplicate.
 */
export function applyAttributionFilter<
  Q extends { eq(column: string, value: string): Q; is(column: string, value: null): Q },
>(query: Q, tuple: AttributionTuple): Q {
  let next = query;
  for (const column of ATTRIBUTION_COLUMNS) {
    const value = tuple[column];
    next = value === null ? next.is(column, null) : next.eq(column, value);
  }
  return next;
}
