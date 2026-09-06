/**
 * The canonical merge-field registry (V4 §19.9).
 *
 * Before this file there were three divergent lists — one in
 * `lib/automation/scheduler.ts` for warm follow-up, one in
 * `lib/outreach/campaign-draft.ts` for cold sequences, and a picker list in
 * `lib/follow-up/types.ts` — which meant a token could be offered on one
 * surface and rejected on another. Everything now derives from here.
 *
 * Two rules the registry exists to enforce:
 *
 *  1. **Tokens are data, never code.** A template is scanned for a fixed
 *     pattern and each match is looked up in this table. There is no dynamic
 *     resolution of arbitrary column names, so a template can never be made to
 *     read a field it was not granted.
 *
 *  2. **A token that cannot be filled does not ship.** Every field declares
 *     whether it has a safe fallback. A required field with no fallback and no
 *     value pauses the step rather than sending `{{first_name}}` to a stranger.
 *
 * Pure — no `server-only`, no Supabase — so it is unit-testable and safe in a
 * client bundle.
 */

/** Where a token is offered. A field may be valid in one surface only. */
export type MergeSurface = "follow-up" | "cold-outreach" | "reactivation";

export type MergeFieldDefinition = {
  /** The bare token name, without braces. */
  key: string;
  label: string;
  /** Shown in the picker so the customer knows what will be substituted. */
  hint: string;
  /**
   * What to use when the source value is missing. `null` means there is no
   * safe fallback: the step pauses rather than sending something wrong.
   */
  fallback: string | null;
  surfaces: MergeSurface[];
};

export const MERGE_FIELD_DEFINITIONS: MergeFieldDefinition[] = [
  {
    key: "first_name",
    label: "First name",
    hint: "The recipient's first name",
    // "there" reads naturally in "Hi there," which is the only place a first
    // name appears in the seeded templates.
    fallback: "there",
    surfaces: ["follow-up", "cold-outreach", "reactivation"],
  },
  {
    key: "last_name",
    label: "Last name",
    hint: "The recipient's last name",
    fallback: "",
    surfaces: ["follow-up", "reactivation"],
  },
  {
    key: "full_name",
    label: "Full name",
    hint: "The recipient's full name",
    fallback: "there",
    surfaces: ["follow-up", "reactivation"],
  },
  {
    key: "business_name",
    label: "Business name",
    hint: "Your business name",
    fallback: null,
    surfaces: ["follow-up", "cold-outreach", "reactivation"],
  },
  {
    key: "company_name",
    label: "Company name",
    hint: "The prospect's company name",
    fallback: null,
    surfaces: ["cold-outreach"],
  },
  {
    key: "service_name",
    label: "Service",
    hint: "The service the recipient asked about",
    fallback: "your enquiry",
    surfaces: ["follow-up", "cold-outreach", "reactivation"],
  },
  {
    key: "booking_link",
    label: "Booking link",
    hint: "Your configured booking destination",
    fallback: null,
    surfaces: ["follow-up", "cold-outreach", "reactivation"],
  },
  {
    key: "conversion_link",
    label: "Conversion link",
    hint: "The destination for this campaign's conversion goal",
    fallback: null,
    surfaces: ["cold-outreach"],
  },
  {
    key: "business_phone",
    label: "Business phone",
    hint: "Your business phone number",
    fallback: null,
    surfaces: ["follow-up", "cold-outreach", "reactivation"],
  },
  {
    key: "sender_name",
    label: "Sender name",
    hint: "The display name on the sending identity",
    fallback: null,
    surfaces: ["cold-outreach"],
  },
  {
    key: "location",
    label: "Location",
    hint: "The prospect's town or city",
    fallback: "your area",
    surfaces: ["cold-outreach"],
  },
];

export type MergeFieldKey = (typeof MERGE_FIELD_DEFINITIONS)[number]["key"];

const BY_KEY = new Map(MERGE_FIELD_DEFINITIONS.map((f) => [f.key, f]));

/** Case-insensitive, whitespace-tolerant: `{{ First_Name }}` is one token. */
export const MERGE_TOKEN_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export function mergeField(key: string): MergeFieldDefinition | undefined {
  return BY_KEY.get(key.toLowerCase());
}

export function fieldsForSurface(surface: MergeSurface): MergeFieldDefinition[] {
  return MERGE_FIELD_DEFINITIONS.filter((f) => f.surfaces.includes(surface));
}

/** Every token a template uses, lower-cased and de-duplicated. */
export function tokensIn(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(MERGE_TOKEN_PATTERN)) {
    const name = match[1]?.toLowerCase();
    if (name) found.add(name);
  }
  return [...found];
}

/**
 * Tokens this surface cannot fill. Used at save time to refuse a template, and
 * again at send time as a second line of defence.
 */
export function unknownTokens(template: string, surface: MergeSurface): string[] {
  return tokensIn(template).filter((token) => {
    const field = mergeField(token);
    return !field || !field.surfaces.includes(surface);
  });
}

export type RenderOutcome =
  | { ok: true; text: string }
  /** At least one required field had no value and no fallback. */
  | { ok: false; missing: string[] };

/**
 * Resolve a template.
 *
 * A field with a fallback quietly uses it. A field without one is reported,
 * and the caller must pause the step — this function never emits a literal
 * `{{token}}` to a recipient.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string | null | undefined>,
  surface: MergeSurface,
): RenderOutcome {
  const missing: string[] = [];

  const text = template.replace(MERGE_TOKEN_PATTERN, (match, raw: string) => {
    const key = raw.toLowerCase();
    const field = mergeField(key);

    if (!field || !field.surfaces.includes(surface)) {
      missing.push(key);
      return match;
    }

    const value = values[key];
    if (value !== undefined && value !== null && value.trim() !== "") {
      return value;
    }

    if (field.fallback === null) {
      missing.push(key);
      return match;
    }
    return field.fallback;
  });

  return missing.length > 0
    ? { ok: false, missing: [...new Set(missing)] }
    : { ok: true, text };
}

/**
 * A best-effort render for previews only.
 *
 * Never use this on a send path: it leaves unresolvable tokens visible on
 * purpose, so the editor can show the customer exactly which ones still need a
 * value.
 */
export function renderPreview(
  template: string,
  values: Record<string, string | null | undefined>,
  surface: MergeSurface,
): string {
  const outcome = renderTemplate(template, values, surface);
  if (outcome.ok) return outcome.text;
  return template.replace(MERGE_TOKEN_PATTERN, (match, raw: string) => {
    const key = raw.toLowerCase();
    const field = mergeField(key);
    if (!field || !field.surfaces.includes(surface)) return match;
    const value = values[key];
    if (value !== undefined && value !== null && value.trim() !== "") return value;
    return field.fallback ?? match;
  });
}
