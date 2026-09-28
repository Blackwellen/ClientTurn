/**
 * Automation rules (gap map §45): "when this happens, do that".
 *
 * A rule is one trigger (an automation event type), optional conditions, and
 * up to five actions. Each action runs an EXISTING service operation through
 * the runtime with caller AUTOMATION (lib/automation/rule-runner.ts), on the
 * authority of the owner or admin who enabled the rule. Nothing here is a new
 * way to act: the permission, capability, eligibility, confirmation and audit
 * rules are the ones every other caller meets, plus the AI permissions an
 * owner set for unattended work (Settings -> AI & selling -> What the AI may
 * do), because a rule is unattended work.
 *
 * An action that may not run is recorded as SKIPPED with its reason, never
 * dropped (`planAction`, and the runner maps an operation's refusal the same
 * way).
 *
 * Pure: zod and relative imports only, so the catalogue, the schemas and every
 * gate are asserted in tests/automation-rules.test.ts, and the builder UI
 * imports the same catalogue.
 */

import { z } from "zod";
import type { AutomationEventType } from "./event-types.ts";
import type { AiPermission } from "../commercial/ai-permissions.ts";
import { serviceOperation } from "../services/registry.ts";
import { roleMeets, type BusinessRoleName, type RiskClass } from "../services/types.ts";
import { renderTemplate } from "./scheduler.ts";
import { SEMANTIC_META, type PipelineSemantic } from "../opportunities/pipeline-semantics.ts";
import type { OpenStage } from "../opportunities/stages.ts";

/* ================================================================ triggers */

export type TriggerSubject = "lead" | "quote" | "invoice" | "workspace";

export type TriggerMeta = {
  type: AutomationEventType;
  label: string;
  description: string;
  subject: TriggerSubject;
  /** A number in the payload a rule may set a floor on ("at least"). */
  threshold?: { key: string; label: string; min: number; max: number; defaultValue: number; unit: string };
};

export type TriggerGroup = { key: string; label: string; triggers: TriggerMeta[] };

export const TRIGGER_GROUPS: readonly TriggerGroup[] = [
  {
    key: "leads",
    label: "Leads and conversations",
    triggers: [
      { type: "lead.created", label: "A new lead arrives", description: "From any connected source, a form or an import.", subject: "lead" },
      { type: "lead.replied", label: "A lead replies", description: "Any inbound message from the lead.", subject: "lead" },
      { type: "qualification.qualified", label: "A lead qualifies", description: "Your qualification rules found the lead a fit.", subject: "lead" },
      {
        type: "intent.threshold_exceeded",
        label: "Buying intent passes a level",
        description: "The lead's intent score changed and is at or above the level you set.",
        subject: "lead",
        threshold: { key: "score", label: "Intent score at least", min: 1, max: 100, defaultValue: 70, unit: "" },
      },
      { type: "objection.detected", label: "An objection is raised", description: "In a reply or on a call.", subject: "lead" },
      { type: "human.requested", label: "The lead asks for a person", description: "In a message, or by asking to be transferred on a call.", subject: "lead" },
      { type: "reactivation.succeeded", label: "A reactivation works", description: "A lead in a reactivation campaign replied or booked.", subject: "lead" },
    ],
  },
  {
    key: "calls",
    label: "Calls",
    triggers: [
      { type: "voice.lead_eligible", label: "A lead can be called", description: "The lead asked to be called, so there is a basis to phone them. Calling hours and your Voice settings still apply.", subject: "lead" },
      { type: "call.requested", label: "An AI call is requested", description: "A call was queued for the lead.", subject: "lead" },
      { type: "call.started", label: "An AI call starts dialling", description: "The call is being placed.", subject: "lead" },
      { type: "call.answered", label: "An AI call is answered", description: "The lead picked up.", subject: "lead" },
      { type: "call.missed", label: "An AI call is missed", description: "No answer, or the line was busy.", subject: "lead" },
      { type: "call.voicemail", label: "A call reaches voicemail", description: "The call went to voicemail.", subject: "lead" },
      { type: "call.qualified", label: "A call moves the lead forward", description: "A booking, a checkout link, a quote request, or a conversation that captured facts.", subject: "lead" },
    ],
  },
  {
    key: "bookings",
    label: "Bookings",
    triggers: [
      { type: "booking.created", label: "A meeting is booked", description: "A booking was confirmed.", subject: "lead" },
      { type: "booking.completed", label: "A meeting takes place", description: "A booked meeting was marked completed.", subject: "lead" },
      { type: "booking.cancelled", label: "A meeting is cancelled", description: "A booking was cancelled.", subject: "lead" },
    ],
  },
  {
    key: "quotes",
    label: "Quotes and signatures",
    triggers: [
      { type: "quote.requested", label: "A quote is requested", description: "The lead asked for a quote, in a message or on a call.", subject: "lead" },
      { type: "quote.created", label: "A quote is drafted", description: "A draft quote was created.", subject: "quote" },
      { type: "quote.approved", label: "A quote is approved", description: "An owner or admin approved a quote.", subject: "quote" },
      { type: "quote.sent", label: "A quote is sent", description: "The quote was frozen and sent to the customer.", subject: "quote" },
      { type: "quote.viewed", label: "A quote is opened", description: "The customer opened the quote page.", subject: "quote" },
      { type: "quote.accepted", label: "A quote is accepted", description: "The customer accepted the quote.", subject: "quote" },
      { type: "quote.expired", label: "A quote expires", description: "A sent quote passed its valid-until date.", subject: "quote" },
      { type: "signature.completed", label: "A quote is signed", description: "The customer signed the quote.", subject: "quote" },
    ],
  },
  {
    key: "money",
    label: "Invoices and payments",
    triggers: [
      { type: "invoice.created", label: "An invoice is drafted", description: "An invoice was drafted from a signed quote.", subject: "invoice" },
      { type: "invoice.issued", label: "An invoice is issued", description: "An invoice was numbered and sent.", subject: "invoice" },
      { type: "invoice.paid", label: "An invoice is paid", description: "An invoice was paid in full.", subject: "invoice" },
      { type: "invoice.overdue", label: "An invoice is overdue", description: "An issued invoice passed its due date unpaid.", subject: "invoice" },
      { type: "payment.direct_sale", label: "A direct sale is paid", description: "A payment through an approved checkout link was confirmed.", subject: "lead" },
    ],
  },
  {
    key: "usage",
    label: "Budgets and usage",
    triggers: [
      {
        type: "voice.budget_threshold",
        label: "Voice minutes run low",
        description: "A call took the workspace across 75%, 90% or 100% of its voice minutes.",
        subject: "workspace",
        threshold: { key: "percentUsed", label: "Used at least", min: 75, max: 100, defaultValue: 90, unit: "%" },
      },
      { type: "usage.exhausted", label: "An allowance runs out", description: "Voice minutes, or the SMS or WhatsApp allowance, reached 100%.", subject: "workspace" },
    ],
  },
];

export const TRIGGERS: readonly TriggerMeta[] = TRIGGER_GROUPS.flatMap((group) => group.triggers);
export const TRIGGER_TYPES = TRIGGERS.map((t) => t.type) as [AutomationEventType, ...AutomationEventType[]];

export function triggerMeta(type: string): TriggerMeta | null {
  return TRIGGERS.find((t) => t.type === type) ?? null;
}

/* ================================================================= actions */

export const ACTION_TYPES = [
  "place_ai_call",
  "schedule_call",
  "send_message",
  "book_meeting",
  "create_quote",
  "request_approval",
  "send_quote",
  "request_signature",
  "create_invoice",
  "send_payment_link",
  "route_to_human",
  "change_stage",
  "add_tag",
  "update_score",
  "start_nurture",
  "notify_team",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** What an action needs to act on, resolved from the event by the runner. */
export type ActionNeed = "lead" | "quote" | "opportunity" | "workspace";

export type ActionMeta = {
  label: string;
  group: "calls" | "messages" | "quotes" | "money" | "pipeline";
  description: string;
  /** The service operation it runs. Every one lists AUTOMATION in `callers`. */
  operation: string;
  needs: ActionNeed;
  /** The owner's "What the AI may do" switch that must be on. */
  aiPermission?: AiPermission;
  /** Plan capabilities that must be on (billing/capability-rules.ts). */
  capabilities?: readonly string[];
};

export const ACTION_META: Record<ActionType, ActionMeta> = {
  place_ai_call: {
    label: "Place an AI call",
    group: "calls",
    description: "The AI voice agent phones the lead, only if they can be called (consent, calling hours, suppression, your Voice settings and minutes).",
    operation: "voice.request_call",
    needs: "lead",
    aiPermission: "call",
    capabilities: ["voice_enabled"],
  },
  schedule_call: {
    label: "Schedule an AI call",
    group: "calls",
    description: "The same call, placed after a wait you choose. Everything is re-checked when the wait ends.",
    operation: "voice.request_call",
    needs: "lead",
    aiPermission: "call",
    capabilities: ["voice_enabled"],
  },
  send_message: {
    label: "Send a message",
    group: "messages",
    description: "An SMS or WhatsApp message to the lead, held to the same stop conditions as follow-up: not after they replied, booked or were taken over. Opt-out, suppression, quiet hours and your plan still apply.",
    operation: "message.send",
    needs: "lead",
  },
  book_meeting: {
    label: "Invite them to book",
    group: "messages",
    description: "Sends your booking link so the lead picks a time. A rule never picks a time for them.",
    operation: "message.send",
    needs: "lead",
    aiPermission: "book",
  },
  create_quote: {
    label: "Draft a quote",
    group: "quotes",
    description: "Drafts a quote for the lead's deal from one catalogue item. Prices come from your catalogue; your approval rules apply.",
    operation: "quote.create",
    needs: "opportunity",
    aiPermission: "create_quote",
    capabilities: ["quote_builder_enabled"],
  },
  request_approval: {
    label: "Ask for approval",
    group: "quotes",
    description: "Sends the quote to an owner or admin to approve.",
    operation: "quote.submit_for_approval",
    needs: "quote",
    capabilities: ["quote_builder_enabled", "quote_approval_enabled"],
  },
  send_quote: {
    label: "Send the quote",
    group: "quotes",
    description: "Freezes the quote and emails the customer a private link. Refused while approval is outstanding.",
    operation: "quote.send",
    needs: "quote",
    aiPermission: "send_quote",
    capabilities: ["quote_builder_enabled"],
  },
  request_signature: {
    label: "Ask for a signature",
    group: "quotes",
    description: "Re-sends the quote link, which opens on the signature step.",
    operation: "quote.send",
    needs: "quote",
    aiPermission: "request_signature",
    capabilities: ["quote_builder_enabled", "esign_enabled"],
  },
  create_invoice: {
    label: "Raise the invoices",
    group: "money",
    description: "Drafts the invoices for an accepted or signed quote's payment schedule.",
    operation: "invoice.create_from_quote",
    needs: "quote",
    aiPermission: "create_invoice",
    capabilities: ["invoicing_enabled"],
  },
  send_payment_link: {
    label: "Send a payment link",
    group: "money",
    description: "Texts one of your approved checkout links, with its approved wording.",
    operation: "message.send",
    needs: "lead",
    aiPermission: "send_payment_link",
    capabilities: ["direct_close_enabled"],
  },
  route_to_human: {
    label: "Hand to a person",
    group: "pipeline",
    description: "Stops automated follow-up and flags the lead for your team.",
    operation: "lead.takeover",
    needs: "lead",
  },
  change_stage: {
    label: "Move the deal",
    group: "pipeline",
    description: "Moves the lead's open deal forward to the stage your pipeline mapping gives this step. Never backwards.",
    operation: "opportunity.set_stage",
    needs: "opportunity",
  },
  add_tag: {
    label: "Add a tag",
    group: "pipeline",
    description: "Adds a label to the lead.",
    operation: "lead.add_tag",
    needs: "lead",
  },
  update_score: {
    label: "Re-score the lead",
    group: "pipeline",
    description: "Re-scores the lead now from what is known about it.",
    operation: "lead.rescore",
    needs: "lead",
  },
  start_nurture: {
    label: "Add to a nurture campaign",
    group: "pipeline",
    description: "Adds the lead to a draft, scheduled or paused reactivation campaign. Nothing is sent until that campaign runs.",
    operation: "campaign.add_lead",
    needs: "lead",
  },
  notify_team: {
    label: "Notify your team",
    group: "pipeline",
    description: "An in-app notification (and email, per each person's notification settings) with your message.",
    operation: "team.notify",
    needs: "workspace",
  },
};

export const ACTION_GROUPS: readonly { key: ActionMeta["group"]; label: string }[] = [
  { key: "calls", label: "Calls" },
  { key: "messages", label: "Messages" },
  { key: "quotes", label: "Quotes" },
  { key: "money", label: "Invoices and payments" },
  { key: "pipeline", label: "Pipeline and people" },
];

/** Deal steps a rule may move a deal to. Closing a deal is left to payments and people. */
export const STAGE_ACTION_SEMANTICS = [
  "CONTACTED",
  "QUALIFIED",
  "QUOTED",
  "BOOKING_PENDING",
  "BOOKED",
  "NEGOTIATION",
  "ACCEPTED",
  "PAYMENT_PENDING",
] as const satisfies readonly PipelineSemantic[];

export const TAG_PATTERN = /^[A-Z][A-Z_]{1,49}$/;
export const DEFAULT_BOOKING_MESSAGE = "Hi {{first_name}}, you can pick a time that suits you here: {{booking_link}}";

const channel = z.enum(["sms", "whatsapp"]);
const body = z.string().trim().min(1).max(1200);

export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place_ai_call"), route: z.enum(["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION"]).default("QUALIFICATION") }),
  z.object({
    type: z.literal("schedule_call"),
    route: z.enum(["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION"]).default("QUALIFICATION"),
    delayMinutes: z.number().int().min(5).max(10_080),
  }),
  z.object({ type: z.literal("send_message"), channel: channel.default("sms"), body }),
  z.object({ type: z.literal("book_meeting"), channel: channel.default("sms"), body: body.default(DEFAULT_BOOKING_MESSAGE) }),
  z.object({
    type: z.literal("create_quote"),
    itemId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/, "Pick a catalogue item"),
    quantity: z.number().positive().max(100_000).default(1),
  }),
  z.object({ type: z.literal("request_approval") }),
  z.object({ type: z.literal("send_quote") }),
  z.object({ type: z.literal("request_signature") }),
  z.object({ type: z.literal("create_invoice") }),
  z.object({ type: z.literal("send_payment_link"), checkoutLinkId: z.string().trim().min(1).max(80), channel: channel.default("sms") }),
  z.object({ type: z.literal("route_to_human") }),
  z.object({ type: z.literal("change_stage"), semantic: z.enum(STAGE_ACTION_SEMANTICS) }),
  z.object({ type: z.literal("add_tag"), tag: z.string().trim().toUpperCase().regex(TAG_PATTERN, "Capital letters and underscores, 2-50 characters") }),
  z.object({ type: z.literal("update_score") }),
  z.object({ type: z.literal("start_nurture"), campaignId: z.uuid() }),
  z.object({ type: z.literal("notify_team"), title: z.string().trim().min(2).max(120), body: z.string().trim().max(500).default("") }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

/* ============================================================== the rule */

export const RULE_FREQUENCIES = ["ONCE_PER_LEAD", "ONCE_PER_DAY", "EVERY_TIME"] as const;
export type RuleFrequency = (typeof RULE_FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<RuleFrequency, string> = {
  ONCE_PER_LEAD: "Once per lead, ever",
  ONCE_PER_DAY: "At most once a day per lead",
  EVERY_TIME: "Every time (capped at 10 a day per lead)",
};

/** The hard ceiling for EVERY_TIME, so a rule whose action causes its own trigger cannot loop. */
export const EVERY_TIME_DAILY_CAP = 10;

/** leads.status (0003). */
export const LEAD_STATUSES_FOR_CONDITIONS = ["NEW", "CONTACTED", "RESPONDED", "QUALIFIED", "BOOKED", "WON", "LOST"] as const;

export const ruleConditionsSchema = z
  .object({
    leadStatusIn: z.array(z.enum(LEAD_STATUSES_FOR_CONDITIONS)).max(8).default([]),
    minValue: z.number().min(0).max(100_000).nullable().default(null),
  })
  .default({ leadStatusIn: [], minValue: null });
export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

export const MAX_RULE_ACTIONS = 5;

export const ruleInputSchema = z
  .object({
    id: z.uuid().nullable().default(null),
    name: z.string().trim().min(2).max(80),
    trigger: z.enum(TRIGGER_TYPES),
    conditions: ruleConditionsSchema,
    actions: z.array(ruleActionSchema).min(1).max(MAX_RULE_ACTIONS),
    frequency: z.enum(RULE_FREQUENCIES).default("ONCE_PER_DAY"),
    enabled: z.boolean().default(false),
    /**
     * The person enabling a rule whose actions reach a customer (a call, a
     * message, a quote) says so explicitly. That is the standing confirmation
     * the runtime needs for an EXTERNAL operation; without it those actions
     * are skipped with a reason.
     */
    acknowledgeExternal: z.boolean().default(false),
  })
  .superRefine((rule, ctx) => {
    const trigger = triggerMeta(rule.trigger);
    if (trigger) {
      rule.actions.forEach((action, index) => {
        if (!actionFitsTrigger(action.type, trigger)) {
          ctx.addIssue({
            code: "custom",
            path: ["actions", index, "type"],
            message: `"${trigger.label}" is about the workspace, not a lead, so "${ACTION_META[action.type].label}" has nothing to act on.`,
          });
        }
      });
    }
    if (rule.enabled && rule.actions.some((a) => actionRisk(a.type) === "EXTERNAL") && !rule.acknowledgeExternal) {
      ctx.addIssue({
        code: "custom",
        path: ["acknowledgeExternal"],
        message: "Confirm that this rule may contact customers without asking each time.",
      });
    }
  });
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** A workspace-level trigger (budgets, usage) has no lead: only a team notification fits it. */
export function actionFitsTrigger(type: ActionType, trigger: Pick<TriggerMeta, "subject">): boolean {
  return trigger.subject === "workspace" ? ACTION_META[type].needs === "workspace" : true;
}

export function actionRisk(type: ActionType): RiskClass {
  return (serviceOperation(ACTION_META[type].operation)?.risk ?? "RESTRICTED") as RiskClass;
}

/** Actions that contact a customer, so need the author's standing confirmation. */
export function contactsCustomer(type: ActionType): boolean {
  return actionRisk(type) === "EXTERNAL";
}

/* =============================================================== gates */

export type RuleSubjectRefs = {
  leadId: string | null;
  quoteId: string | null;
  invoiceId: string | null;
  opportunityId: string | null;
};

export type ActionGate = {
  /** The rule author's live role; null when they left the workspace. */
  authorRole: BusinessRoleName | null;
  /** The rule was enabled with `acknowledgeExternal`. */
  standingConfirmation: boolean;
  aiPermissions: Readonly<Record<AiPermission, boolean>>;
  /** Plan capabilities by key, plus `voice_enabled`. Missing = off. */
  capabilities: Readonly<Record<string, boolean>>;
  /** A maintenance message when platform writes are paused. */
  maintenance: string | null;
  bookingLink: string | null;
  /** Approved checkout links, with the URL already tracked for this send. */
  checkoutLinks: readonly { id: string; url: string; label: string; priceText: string }[];
  /** Merge values for message bodies ({{first_name}}, {{business_name}} ...). */
  mergeValues: Readonly<Record<string, string>>;
  /** The stage each deal step lands on for this lead's open deal (runner, via the pipeline map). */
  stageFor: Readonly<Partial<Record<PipelineSemantic, OpenStage | null>>>;
};

export type SkipCode =
  | "NO_LEAD"
  | "NO_QUOTE"
  | "NO_OPPORTUNITY"
  | "AUTHOR_GONE"
  | "ROLE"
  | "AI_PERMISSION"
  | "CAPABILITY"
  | "NOT_CONFIRMED"
  | "MAINTENANCE"
  | "NO_BOOKING_LINK"
  | "NO_CHECKOUT_LINK"
  | "NO_STAGE"
  | "RISK"
  | "REFUSED";

export type ActionPlan =
  | { kind: "RUN"; operation: string; args: Record<string, unknown>; confirmed: boolean; delayMinutes: number }
  | { kind: "SKIP"; code: SkipCode; reason: string };

const CAPABILITY_LABEL: Record<string, string> = {
  voice_enabled: "AI calling is not on for this workspace (Settings -> Voice).",
  quote_builder_enabled: "Quotes are not on your plan.",
  quote_approval_enabled: "Quote approvals are not on your plan.",
  esign_enabled: "E-signature is not on your plan.",
  invoicing_enabled: "Invoicing is not on your plan.",
  direct_close_enabled: "Direct close is not on your plan.",
};

function skip(code: SkipCode, reason: string): ActionPlan {
  return { kind: "SKIP", code, reason };
}

/**
 * Decides whether one action may run and with what arguments. Every gate the
 * runtime would apply is also applied inside the operation, so this is the
 * early, explainable refusal; the runtime's own refusal is recorded the same
 * way (see `skipFromRefusal`).
 */
export function planAction(action: RuleAction, subject: RuleSubjectRefs, gate: ActionGate): ActionPlan {
  const meta = ACTION_META[action.type];
  const declaration = serviceOperation(meta.operation);
  if (!declaration) return skip("REFUSED", "That action is not available.");
  const risk = declaration.risk as RiskClass;

  // Money-moving, irreversible or safety-overriding operations are never a rule's to run.
  if (risk === "FINANCIAL" || risk === "DESTRUCTIVE" || risk === "RESTRICTED" || risk === "BULK_EXTERNAL") {
    return skip("RISK", "Automations never spend money, delete or override a safety rule.");
  }
  if (gate.maintenance) return skip("MAINTENANCE", gate.maintenance);
  if (!gate.authorRole) return skip("AUTHOR_GONE", "The person who turned this rule on is no longer in the workspace. An owner or admin needs to turn it on again.");
  if (!roleMeets(gate.authorRole, declaration.minimumRole as BusinessRoleName)) {
    return skip("ROLE", `The person who turned this rule on is no longer allowed to ${declaration.summary.toLowerCase()}.`);
  }
  for (const capability of meta.capabilities ?? []) {
    if (!gate.capabilities[capability]) return skip("CAPABILITY", CAPABILITY_LABEL[capability] ?? "That is not on your plan.");
  }
  if (meta.aiPermission && !gate.aiPermissions[meta.aiPermission]) {
    return skip("AI_PERMISSION", `"${meta.label}" needs the "${meta.aiPermission.replace(/_/g, " ")}" switch in Settings -> AI & selling -> What the AI may do.`);
  }
  if (risk === "EXTERNAL" && !gate.standingConfirmation) {
    return skip("NOT_CONFIRMED", "This action contacts a customer, and the rule was not turned on with permission to do that unattended.");
  }

  const needLead = () => (subject.leadId ? null : skip("NO_LEAD", "This event has no lead to act on."));
  const needQuote = () => (subject.quoteId ? null : skip("NO_QUOTE", "This event has no quote to act on."));
  const confirmed = risk === "EXTERNAL";
  const run = (args: Record<string, unknown>, delayMinutes = 0): ActionPlan => ({
    kind: "RUN",
    operation: meta.operation,
    args,
    confirmed,
    delayMinutes,
  });
  const render = (template: string) => renderTemplate(template, gate.mergeValues);

  switch (action.type) {
    case "place_ai_call":
      return needLead() ?? run({ leadId: subject.leadId, route: action.route });
    case "schedule_call":
      return needLead() ?? run({ leadId: subject.leadId, route: action.route }, action.delayMinutes);
    case "send_message":
      return needLead() ?? run({ leadId: subject.leadId, channel: action.channel, body: render(action.body).slice(0, 1200) });
    case "book_meeting": {
      const missing = needLead();
      if (missing) return missing;
      if (!gate.bookingLink) return skip("NO_BOOKING_LINK", "There is no booking link to send. Connect a calendar or set a booking link first.");
      const text = action.body.includes("{{booking_link}}") ? action.body : `${action.body} {{booking_link}}`;
      return run({ leadId: subject.leadId, channel: action.channel, body: render(text).slice(0, 1200) });
    }
    case "send_payment_link": {
      const missing = needLead();
      if (missing) return missing;
      const link = gate.checkoutLinks.find((candidate) => candidate.id === action.checkoutLinkId);
      if (!link) return skip("NO_CHECKOUT_LINK", "That checkout link is no longer one of your approved links.");
      const name = gate.mergeValues.first_name ? `Hi ${gate.mergeValues.first_name}, ` : "";
      // Only the approved wording: the label and price text the owner wrote.
      return run({ leadId: subject.leadId, channel: action.channel, body: `${name}here is the secure payment link for ${link.label} (${link.priceText}): ${link.url}`.slice(0, 1200) });
    }
    case "create_quote":
      if (!subject.opportunityId) return skip("NO_OPPORTUNITY", "The lead has no open deal to quote against.");
      return run({
        opportunityId: subject.opportunityId,
        lines: [{ lineId: "line-1", kind: "ITEM", itemId: action.itemId, quantity: action.quantity, optionIds: [] }],
      });
    case "request_approval":
      return needQuote() ?? run({ quoteId: subject.quoteId });
    case "send_quote":
    case "request_signature":
      return needQuote() ?? run({ quoteId: subject.quoteId, channel: "email" });
    case "create_invoice":
      return needQuote() ?? run({ quoteId: subject.quoteId, autoIssue: true });
    case "route_to_human":
      return needLead() ?? run({ leadId: subject.leadId });
    case "change_stage": {
      if (!subject.opportunityId) return skip("NO_OPPORTUNITY", "The lead has no open deal to move.");
      const stage = gate.stageFor[action.semantic] ?? null;
      if (!stage) {
        return skip("NO_STAGE", `${SEMANTIC_META[action.semantic].label} does not move this deal: it is mapped to no stage, the deal's motion has none, or the deal is already past it.`);
      }
      return run({ opportunityId: subject.opportunityId, stage });
    }
    case "add_tag":
      return needLead() ?? run({ leadId: subject.leadId, tag: action.tag, reason: "Added by an automation rule" });
    case "update_score":
      return needLead() ?? run({ leadId: subject.leadId });
    case "start_nurture":
      return needLead() ?? run({ campaignId: action.campaignId, leadId: subject.leadId });
    case "notify_team":
      return run({
        title: render(action.title).slice(0, 120),
        body: render(action.body).slice(0, 500),
        leadId: subject.leadId,
      });
  }
}

/** A runtime refusal, as the run history records it. Retryable ones fail instead. */
export function outcomeFromRefusal(code: string): "SKIPPED" | "FAILED" {
  return code === "UNAVAILABLE" || code === "PROVIDER_FAILED" ? "FAILED" : "SKIPPED";
}

/* ======================================================== when it fires */

/** Whether the rule's conditions hold for this event. */
export function conditionsMatch(
  conditions: RuleConditions,
  trigger: string,
  context: { leadStatus: string | null; payload: Record<string, unknown> },
): { ok: true } | { ok: false; reason: string } {
  if (conditions.leadStatusIn.length > 0) {
    if (!context.leadStatus || !(conditions.leadStatusIn as readonly string[]).includes(context.leadStatus)) {
      return { ok: false, reason: `The lead's status (${context.leadStatus ?? "none"}) is not one the rule runs for.` };
    }
  }
  const threshold = triggerMeta(trigger)?.threshold;
  if (threshold && conditions.minValue !== null) {
    const value = Number(context.payload[threshold.key]);
    if (!Number.isFinite(value) || value < conditions.minValue) {
      return { ok: false, reason: `${threshold.label} ${conditions.minValue}${threshold.unit}: this event was ${Number.isFinite(value) ? value : "unknown"}.` };
    }
  }
  return { ok: true };
}

/**
 * Whether the rule may fire again for this lead, given when it last fired for
 * them (newest first). Workspace-level rules count per workspace.
 */
export function frequencyAllows(frequency: RuleFrequency, previousFires: readonly Date[], now: Date): { ok: true } | { ok: false; reason: string } {
  const dayAgo = now.getTime() - 86_400_000;
  const today = previousFires.filter((at) => at.getTime() > dayAgo).length;
  if (frequency === "ONCE_PER_LEAD" && previousFires.length > 0) return { ok: false, reason: "This rule already ran for this lead, and runs once per lead." };
  if (frequency === "ONCE_PER_DAY" && today > 0) return { ok: false, reason: "This rule already ran for this lead in the last 24 hours." };
  if (frequency === "EVERY_TIME" && today >= EVERY_TIME_DAILY_CAP) {
    return { ok: false, reason: `This rule reached its cap of ${EVERY_TIME_DAILY_CAP} runs for this lead in 24 hours.` };
  }
  return { ok: true };
}

/** One sentence describing a rule, for the list. */
export function describeRule(rule: { trigger: string; actions: readonly { type: ActionType }[] }): string {
  const trigger = triggerMeta(rule.trigger)?.label ?? rule.trigger;
  const actions = rule.actions.map((a) => ACTION_META[a.type].label.toLowerCase());
  return `When ${trigger.charAt(0).toLowerCase()}${trigger.slice(1)}: ${actions.join(", then ")}.`;
}
