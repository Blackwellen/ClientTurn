/**
 * The voice agent's tools (voice phase P3): names, argument schemas and the
 * Retell custom-function definitions. Pure, so the route handler, the tool
 * core, the QA simulator and `scripts/retell-setup.mjs` all read one list.
 *
 * Retell shapes, verified against docs.retellai.com on 2026-09-27
 * (api-references/create-retell-llm, build/single-multi-prompt/custom-function):
 *   general_tools[]: { type: "custom", name (<= 64, [a-zA-Z0-9_-]), description,
 *     url, method, parameters (JSON Schema, type object, properties required),
 *     speak_during_execution, speak_after_execution, execution_message_description,
 *     timeout_ms (1,000..600,000), max_retry (0..5) }
 *   request to `url`: POST { name, call: { call_id, metadata, ... }, args },
 *     header X-Retell-Signature. Response: any 2xx; the body is given to the
 *     LLM as a string, capped at 15,000 characters.
 *   dynamic variables: {{name}} in the prompt and begin message; values are
 *     strings; {{session_duration}} is a system variable.
 *
 * UNVERIFIED: that the custom-function signature uses the same
 * `v=<ms>,d=<hex>` format and key as webhooks (the docs say "an HMAC-SHA256
 * signature of the request body"; we verify it exactly as the webhook one).
 * Whether {{session_duration}} is re-evaluated on every turn.
 *
 * Every tool is idempotent per (call id, tool call id): Retell's retry of the
 * same invocation is answered from the stored result (voice_tool_calls, 0162).
 */

import { z } from "zod";
import { renderListenFor } from "../speech-intents.ts";

export const VOICE_TOOL_NAMES = [
  "record_fact",
  "check_availability",
  "book_meeting",
  "calculate_quote",
  "send_quote",
  "send_checkout_link",
  "send_booking_link",
  "transfer_to_human",
  "schedule_callback",
  "opt_out",
  "log_objection",
  "end_call_summary",
  "get_call_status",
] as const;
export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number];

export function isVoiceToolName(value: string): value is VoiceToolName {
  return (VOICE_TOOL_NAMES as readonly string[]).includes(value);
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const VOICE_TOOL_ARGS = {
  record_fact: z.object({
    /** A qualification dimension or a configured question's key, as named in the brief. */
    dimension: z.string().trim().min(2).max(60).regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/),
    /** What the lead said, in their words. */
    value: text(300),
    /** The lead confirmed it back (numbers and emails read back, §20). */
    confirmed: z.boolean().default(false),
  }),
  check_availability: z.object({
    /** A day the lead asked about, YYYY-MM-DD, or none for the next available. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    day_part: z.enum(["morning", "afternoon", "evening"]).nullable().optional(),
  }),
  book_meeting: z.object({
    /** Exactly one of the times check_availability returned, ISO 8601. */
    start_iso: z.string().datetime({ offset: true }),
    note: z.string().trim().max(300).optional(),
  }),
  calculate_quote: z.object({
    /** Catalogue items the lead asked for, by the names in the approved offer lines. */
    items: z.array(z.object({ name: text(120), quantity: z.number().int().min(1).max(10000).default(1) })).min(1).max(10),
  }),
  send_quote: z.object({
    /** The quote reference calculate_quote returned. */
    quote_ref: text(80),
    channel: z.enum(["email", "sms"]).default("email"),
  }),
  send_checkout_link: z.object({
    /** The product the lead chose, by its approved name. */
    item: text(120),
    channel: z.enum(["sms", "email"]).default("sms"),
  }),
  send_booking_link: z.object({
    /** "Just email me": the business's own booking link, by text or email, so they can pick a time. */
    channel: z.enum(["sms", "email"]).default("sms"),
  }),
  transfer_to_human: z.object({
    reason: z.enum(["ASKED_FOR_PERSON", "LEGAL_OR_CONTRACT", "STUCK", "COMPLAINT"]),
  }),
  schedule_callback: z.object({
    /** When they asked to be called, ISO 8601, or null for "a colleague will arrange it". */
    at_iso: z.string().datetime({ offset: true }).nullable().optional(),
    /** Who calls: the AI again (only with consent) or a person. */
    by: z.enum(["AI", "PERSON"]).default("PERSON"),
    note: z.string().trim().max(300).optional(),
  }),
  opt_out: z.object({
    scope: z.enum(["CALLS", "ALL"]).default("CALLS"),
  }),
  log_objection: z.object({
    /** A sales-library objection key (PRICE, TIMING, ...) or the business's own "custom:..." key. */
    key: z.string().trim().min(2).max(80).regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/),
    excerpt: z.string().trim().max(300).optional(),
    handled: z.enum(["RESOLVED", "PARTIALLY_RESOLVED", "UNRESOLVED", "ESCALATED", "LOST"]).default("UNRESOLVED"),
  }),
  end_call_summary: z.object({
    summary: text(1200),
    disposition: z.enum([
      "CONVERSATION",
      "MEETING_BOOKED",
      "CHECKOUT_LINK_SENT",
      "QUOTE_REQUESTED",
      "CALLBACK_REQUESTED",
      "NOT_INTERESTED",
      "WRONG_PERSON",
      "OPTED_OUT",
      "TRANSFERRED_TO_HUMAN",
      // A voicemail greeting or phone menu reached the model (speech-intents.ts).
      "VOICEMAIL",
    ]),
    next_step: z.string().trim().max(300).optional(),
  }),
  get_call_status: z.object({}),
} as const satisfies Record<VoiceToolName, z.ZodType>;

export type VoiceToolArgs<N extends VoiceToolName> = z.infer<(typeof VOICE_TOOL_ARGS)[N]>;

/* ----------------------------------------------------- Retell definitions */

type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

const DESCRIPTIONS: Record<VoiceToolName, string> = {
  record_fact: "Save something the lead told you about their needs, after reading back any number or email. Use the dimension name from the brief. A silent note: carry straight on with your next line and never read the note aloud.",
  check_availability: "Get real meeting times from the business's calendar. Offer only times this returns.",
  book_meeting: "Book the meeting at one of the exact times check_availability returned, once the lead has chosen it.",
  calculate_quote: "Price the items the lead asked for from the business's catalogue. Say only the figures this returns.",
  send_quote: "Send the priced quote to the lead by email or text. Only after they agree to receive it.",
  send_checkout_link: "Text or email the lead the approved checkout link for the item they chose.",
  send_booking_link: "Text or email the lead the business's booking link, when they ask you to send something instead of booking now.",
  transfer_to_human: "Put the call through to a person at the business. Only when the brief allows it.",
  schedule_callback: "Record when the lead wants to be called back, or that a colleague will arrange it.",
  opt_out: "The lead asked not to be called (or contacted) again. Call this at once.",
  log_objection: "Record an objection the lead raised, with its key. A silent note: carry straight on with your next line and never read the note aloud.",
  end_call_summary: "Before the call ends: a short factual summary, the outcome, and the agreed next step.",
  get_call_status: "Check how long the call has run and what the time plan says to do now.",
};

const PARAMETERS: Record<VoiceToolName, JsonSchema> = {
  record_fact: {
    type: "object",
    properties: {
      dimension: { type: "string", description: "The dimension, e.g. TIMING, BUDGET, TEAM_SIZE, CURRENT_SOLUTION." },
      value: { type: "string", description: "What they said, in their words." },
      confirmed: { type: "boolean", description: "True when you read it back and they confirmed it." },
    },
    required: ["dimension", "value"],
  },
  check_availability: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD if they named a day, else omit." },
      day_part: { type: "string", enum: ["morning", "afternoon", "evening"] },
    },
  },
  book_meeting: {
    type: "object",
    properties: {
      start_iso: { type: "string", description: "The exact ISO time check_availability returned." },
      note: { type: "string" },
    },
    required: ["start_iso"],
  },
  calculate_quote: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, quantity: { type: "integer", minimum: 1 } },
          required: ["name"],
        },
      },
    },
    required: ["items"],
  },
  send_quote: {
    type: "object",
    properties: {
      quote_ref: { type: "string", description: "The quote_ref calculate_quote returned." },
      channel: { type: "string", enum: ["email", "sms"] },
    },
    required: ["quote_ref"],
  },
  send_checkout_link: {
    type: "object",
    properties: {
      item: { type: "string", description: "The approved product name." },
      channel: { type: "string", enum: ["sms", "email"] },
    },
    required: ["item"],
  },
  send_booking_link: {
    type: "object",
    properties: { channel: { type: "string", enum: ["sms", "email"] } },
  },
  transfer_to_human: {
    type: "object",
    properties: { reason: { type: "string", enum: ["ASKED_FOR_PERSON", "LEGAL_OR_CONTRACT", "STUCK", "COMPLAINT"] } },
    required: ["reason"],
  },
  schedule_callback: {
    type: "object",
    properties: {
      at_iso: { type: "string", description: "When they asked to be called, ISO 8601, if they gave a time." },
      by: { type: "string", enum: ["AI", "PERSON"] },
      note: { type: "string" },
    },
  },
  opt_out: {
    type: "object",
    properties: { scope: { type: "string", enum: ["CALLS", "ALL"], description: "CALLS for no more calls; ALL for no contact at all." } },
  },
  log_objection: {
    type: "object",
    properties: {
      key: { type: "string", description: "PRICE, BUDGET, TIMING, COMPETITOR, EXISTING_PROVIDER, NO_NEED, TRUST, AUTHORITY, SEND_INFORMATION, NOT_INTERESTED, TOO_BUSY, CALL_LATER, RISK, NOT_NOW, ..." },
      excerpt: { type: "string" },
      handled: { type: "string", enum: ["RESOLVED", "PARTIALLY_RESOLVED", "UNRESOLVED", "ESCALATED", "LOST"] },
    },
    required: ["key"],
  },
  end_call_summary: {
    type: "object",
    properties: {
      summary: { type: "string" },
      disposition: {
        type: "string",
        enum: ["CONVERSATION", "MEETING_BOOKED", "CHECKOUT_LINK_SENT", "QUOTE_REQUESTED", "CALLBACK_REQUESTED", "NOT_INTERESTED", "WRONG_PERSON", "OPTED_OUT", "TRANSFERRED_TO_HUMAN", "VOICEMAIL"],
      },
      next_step: { type: "string" },
    },
    required: ["summary", "disposition"],
  },
  get_call_status: { type: "object", properties: {} },
};

/** Tools whose work is slow enough to say a holding line while it runs. */
const SPEAK_DURING: ReadonlySet<VoiceToolName> = new Set(["check_availability", "book_meeting", "calculate_quote", "send_quote", "send_checkout_link", "send_booking_link"]);

export const VOICE_TOOL_PATH_PREFIX = "/api/voice/tools";
export const VOICE_TOOL_TIMEOUT_MS = 8000;

export type RetellCustomTool = {
  type: "custom";
  name: VoiceToolName;
  description: string;
  url: string;
  method: "POST";
  parameters: JsonSchema;
  speak_during_execution: boolean;
  speak_after_execution: boolean;
  execution_message_description?: string;
  timeout_ms: number;
  max_retry: number;
};

/** The Retell general_tools entries, pointing at `${base}/api/voice/tools/<name>`. */
export function retellCustomTools(baseUrl: string): RetellCustomTool[] {
  const base = baseUrl.replace(/\/+$/, "");
  return VOICE_TOOL_NAMES.map((name) => ({
    type: "custom",
    name,
    description: DESCRIPTIONS[name],
    url: `${base}${VOICE_TOOL_PATH_PREFIX}/${name}`,
    method: "POST",
    parameters: PARAMETERS[name],
    speak_during_execution: SPEAK_DURING.has(name),
    // Retell: with "speak after execution" off the agent does not carry on
    // after the function returns (docs: off only for fire-and-forget where
    // nothing is said next). record_fact and log_objection are always followed
    // by the agent's next line, so they are ON (dead air otherwise, found in a
    // setup dry run 2026-09-28); their descriptions say never to read the note
    // aloud. Only end_call_summary is off: the call ends after it.
    speak_after_execution: name !== "end_call_summary",
    ...(SPEAK_DURING.has(name) ? { execution_message_description: "A short, natural holding line, such as: one moment while I check that." } : {}),
    timeout_ms: VOICE_TOOL_TIMEOUT_MS,
    // A retry reuses the tool call id, so the endpoint answers it from the
    // stored result; one retry covers a cold start.
    max_retry: 1,
  }));
}

/**
 * The Retell LLM's fixed general prompt. Everything specific to the call
 * arrives as dynamic variables built by `buildVoiceCallBrief`, so the prompt
 * never changes per workspace and one LLM serves every workspace.
 *
 * The LISTEN FOR block (voice QA pass, 2026-09-28) is rendered from
 * `speech-intents.ts` SPOKEN_INTENT_PLAYBOOK: what to hear in misheard,
 * unpunctuated speech (an opt-out, a wrong number, "is this a robot", "just
 * email me", a voicemail, an angry caller) and the tool that answers it. It
 * is the same for every call, so it lives here, not in the bounded per-call
 * brief. So does the recovery when a tool fails or times out.
 */
export const RETELL_GENERAL_PROMPT = [
  "You are a voice assistant for a UK business. You have already spoken the opening line: {{locked_preamble}}",
  "Follow the call brief below exactly. It is your plan for this call, decided before the call by the business's own rules.",
  "{{call_brief}}",
  "{{time_plan}}",
  renderListenFor(),
  "IF A TOOL FAILS OR TIMES OUT. Say sorry once, in a few words. Never retry it more than once and never guess its answer. Offer to send the details by text or email instead (send_booking_link, or schedule_callback by a person with a note of what to send), then carry on or wrap up.",
  "record_fact and log_objection are silent notes, never a turn on their own: always say your next line straight after them.",
  "Tools are how you act. You never promise anything a tool has not confirmed in this call.",
  "The lead's first name is {{lead_first_name}}.",
].join("\n\n");

/** The begin message: the locked OD-1 opener, spoken first and never by the model. */
export const RETELL_BEGIN_MESSAGE = "{{locked_preamble}}";

/** Default values so a test call without variables still reads sensibly. */
export const RETELL_DEFAULT_DYNAMIC_VARIABLES: Record<string, string> = {
  locked_preamble: "",
  call_brief: "End the call politely: there is no plan for this call.",
  time_plan: "",
  lead_first_name: "",
};
