/**
 * The WhatsApp approved-template registry (brief §45, design 05 §3.5).
 *
 * Outside the 24-hour customer service window WhatsApp accepts only a
 * pre-approved template, and every template send is priced by its category
 * (MARKETING, UTILITY, AUTHENTICATION -- per-message pricing since July 2025,
 * 01 §5). This module holds the pure half:
 *
 *   * normalising what Twilio Content and Meta's Graph API return into one row;
 *   * resolving a follow-up step's variable map against the lead's merge values;
 *   * the send-time choice: a template is used only if it is APPROVED, belongs
 *     to the transport this workspace actually sends through, and every
 *     variable it declares has a value. Anything else refuses the send -- free
 *     text outside the window is never the fallback.
 *
 * Pure: no `server-only`, relative imports with explicit `.ts`.
 */

import { MERGE_FIELD_DEFINITIONS } from "./merge-fields.ts";

export const TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_STATUSES = [
  "APPROVED",
  "PENDING",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "UNKNOWN",
] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export type TemplateProvider = "twilio" | "meta";

/** One registry row, as stored in `whatsapp_templates`. */
export type WhatsAppTemplateRecord = {
  id: string;
  businessId: string | null;
  provider: TemplateProvider;
  externalId: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  body: string | null;
  variables: string[];
};

/** What a sync writes (no id yet). */
export type TemplateUpsert = Omit<WhatsAppTemplateRecord, "id">;

/** What the transport needs to send one template, and what is recorded for cost. */
export type OutboundTemplate = {
  templateId: string;
  provider: TemplateProvider;
  /** Twilio ContentSid, or Meta template name. */
  externalId: string;
  name: string;
  language: string;
  category: TemplateCategory;
  /** Variable key -> value, in the template's declared order. */
  variables: Record<string, string>;
  /** Positional values, for Meta's body parameters. */
  parameters: string[];
};

/* ------------------------------------------------------------- normalise */

export function normaliseCategory(value: unknown): TemplateCategory {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(upper)
    ? (upper as TemplateCategory)
    : // An unrecognised category is priced as the most expensive one, never the cheapest.
      "MARKETING";
}

export function normaliseStatus(value: unknown): TemplateStatus {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  if ((TEMPLATE_STATUSES as readonly string[]).includes(upper)) return upper as TemplateStatus;
  if (upper === "IN_APPEAL" || upper === "RECEIVED" || upper === "UNSUBMITTED") return "PENDING";
  return "UNKNOWN";
}

/** `{{1}}`, `{{ 2 }}`, `{{name}}` -> ["1", "2", "name"], first-appearance order, no repeats. */
export function extractTemplateVariables(body: string | null | undefined): string[] {
  if (!body) return [];
  const seen: string[] = [];
  for (const match of body.matchAll(/\{\{\s*([A-Za-z0-9_]{1,40})\s*\}\}/g)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

/** Numeric keys sort numerically; Meta's positional parameters follow that order. */
export function orderVariables(keys: string[]): string[] {
  return [...new Set(keys)].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isInteger(na) && Number.isInteger(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

type TwilioContent = {
  sid?: string;
  friendly_name?: string;
  language?: string;
  variables?: Record<string, unknown> | null;
  types?: Record<string, { body?: string } | undefined> | null;
  approval_requests?: { name?: string; category?: string; status?: string } | null;
};

/**
 * One item of Twilio's `GET https://content.twilio.com/v1/ContentAndApprovals`.
 * A content item with no WhatsApp approval request is not a WhatsApp template
 * and is dropped: it cannot be sent outside the window.
 */
export function normaliseTwilioContent(item: TwilioContent): TemplateUpsert | null {
  if (!item.sid || !item.approval_requests) return null;
  const approval = item.approval_requests;
  const body =
    item.types?.["twilio/text"]?.body ??
    Object.values(item.types ?? {}).find((type) => typeof type?.body === "string")?.body ??
    null;
  const declared = Object.keys(item.variables ?? {});
  return {
    businessId: null,
    provider: "twilio",
    externalId: item.sid,
    name: (approval.name || item.friendly_name || item.sid).slice(0, 512),
    language: (item.language || "en").slice(0, 20),
    category: normaliseCategory(approval.category),
    status: normaliseStatus(approval.status),
    body: body ? body.slice(0, 4096) : null,
    variables: orderVariables(declared.length ? declared : extractTemplateVariables(body)),
  };
}

type MetaTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: { type?: string; text?: string }[];
};

/** One item of Meta's `GET /{waba-id}/message_templates`. */
export function normaliseMetaTemplate(item: MetaTemplate, businessId: string): TemplateUpsert | null {
  if (!item.name || !item.language) return null;
  const body = item.components?.find((component) => component.type?.toUpperCase() === "BODY")?.text ?? null;
  return {
    businessId,
    provider: "meta",
    // Meta sends by name + language, but the id is what stays stable.
    externalId: (item.id || `${item.name}:${item.language}`).slice(0, 200),
    name: item.name.slice(0, 512),
    language: item.language.slice(0, 20),
    category: normaliseCategory(item.category),
    status: normaliseStatus(item.status),
    body: body ? body.slice(0, 4096) : null,
    variables: orderVariables(extractTemplateVariables(body)),
  };
}

/* ------------------------------------------------------------ variables */

/** Merge fields a follow-up template variable may be filled from. */
export const TEMPLATE_VARIABLE_SOURCES = MERGE_FIELD_DEFINITIONS.filter((field) =>
  field.surfaces.includes("follow-up"),
).map((field) => ({ key: field.key, label: field.label }));

const SOURCE_KEYS = new Set(TEMPLATE_VARIABLE_SOURCES.map((source) => source.key));

export function isTemplateVariableSource(key: string): boolean {
  return SOURCE_KEYS.has(key);
}

/**
 * Fills a template's variables from the step's map (variable -> merge field)
 * and the lead's merge values. A variable with no mapping, an unknown merge
 * field or an empty value is reported missing: a template never goes out with
 * a blank where a name should be.
 */
export function resolveTemplateVariables(
  declared: string[],
  variableMap: Record<string, string>,
  values: Record<string, string>,
): { ok: true; variables: Record<string, string> } | { ok: false; missing: string[] } {
  const variables: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of orderVariables(declared)) {
    const source = variableMap[key];
    const value = source && isTemplateVariableSource(source) ? values[source]?.trim() : "";
    if (!value) missing.push(key);
    else variables[key] = value.slice(0, 1024);
  }
  return missing.length ? { ok: false, missing } : { ok: true, variables };
}

/* ---------------------------------------------------------- send choice */

export type TemplateChoice =
  | { ok: true; template: OutboundTemplate }
  | {
      ok: false;
      reason: "NO_TEMPLATE" | "NOT_APPROVED" | "WRONG_TRANSPORT" | "WRONG_WORKSPACE" | "MISSING_VARIABLES";
      message: string;
    };

/**
 * The send-time decision, taken after the policy engine said REQUIRE_TEMPLATE.
 * Re-read at send time rather than trusted from the queue: a template paused
 * or rejected since the step was queued must not be attempted -- a refused
 * template counts against the number's quality rating like refused free text.
 */
export function chooseTemplateForSend(input: {
  template: WhatsAppTemplateRecord | null;
  businessId: string;
  /** The transport this workspace sends WhatsApp through right now. */
  transport: TemplateProvider;
  /** Stored on the message when it was queued. */
  variables: Record<string, string> | null;
}): TemplateChoice {
  const { template } = input;
  if (!template) {
    return {
      ok: false,
      reason: "NO_TEMPLATE",
      message:
        "The WhatsApp service window has closed and this step has no approved template. Map one in Settings, or contact the lead on another channel.",
    };
  }
  if (template.businessId !== null && template.businessId !== input.businessId) {
    return { ok: false, reason: "WRONG_WORKSPACE", message: "That template belongs to another workspace." };
  }
  if (template.provider !== input.transport) {
    return {
      ok: false,
      reason: "WRONG_TRANSPORT",
      message:
        input.transport === "meta"
          ? "This workspace sends WhatsApp through its own number, so a Twilio template cannot be used. Map one of its own approved templates."
          : "This workspace sends WhatsApp through Twilio, so a template from a WhatsApp Business Account cannot be used.",
    };
  }
  if (template.status !== "APPROVED") {
    return {
      ok: false,
      reason: "NOT_APPROVED",
      message: `The WhatsApp template "${template.name}" is ${template.status.toLowerCase()}, not approved, so it cannot be sent.`,
    };
  }

  const variables = input.variables ?? {};
  const ordered = orderVariables(template.variables);
  const missing = ordered.filter((key) => !variables[key]?.trim());
  if (missing.length) {
    return {
      ok: false,
      reason: "MISSING_VARIABLES",
      message: `The WhatsApp template "${template.name}" needs a value for ${missing.map((key) => `{{${key}}}`).join(", ")}.`,
    };
  }

  const filled: Record<string, string> = {};
  for (const key of ordered) filled[key] = variables[key]!.trim();

  return {
    ok: true,
    template: {
      templateId: template.id,
      provider: template.provider,
      externalId: template.externalId,
      name: template.name,
      language: template.language,
      category: template.category,
      variables: filled,
      parameters: ordered.map((key) => filled[key]),
    },
  };
}

/** Twilio's `ContentVariables` form field: a JSON object of key -> value. */
export function twilioContentVariables(template: OutboundTemplate): string {
  return JSON.stringify(template.variables);
}

/** What the stored body says for a template send, for the conversation view. */
export function templatePreview(body: string | null, variables: Record<string, string>): string | null {
  if (!body) return null;
  return body.replace(/\{\{\s*([A-Za-z0-9_]{1,40})\s*\}\}/g, (whole, key: string) => variables[key] ?? whole);
}
