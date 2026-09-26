import { z } from "zod";

/**
 * AI Behaviour settings. Deliberately thin — no temperature, tokens, model
 * IDs, system prompts or confidence thresholds are ever exposed here; those
 * stay internal to src/lib/ai/ and src/lib/agent/.
 *
 * Two layers live in this file and they are not the same thing:
 *
 *   * `enabled` / `tone` / `allowAiReply` / `allowAiInterpretation` govern the
 *     *assist* layer — AI rewording a message ClientTurn had already decided
 *     to send, and AI interpreting an answer the deterministic matcher could
 *     not parse.
 *   * `agentMode` and the fields under it govern the *conversation agent* —
 *     an actor that decides what to say. It is off by default in every
 *     workspace, and it is gated by `enabled` as well, so turning AI assist
 *     off turns the agent off with it.
 */

export const AI_TONE_OPTIONS = ["professional", "friendly", "direct"] as const;
export const AI_REPLY_LENGTH_OPTIONS = ["short", "normal"] as const;

export const AGENT_MODE_OPTIONS = [
  {
    value: "OFF" as const,
    label: "Off",
    description: "Replies follow your configured follow-up and qualification steps only.",
  },
  {
    value: "SUGGEST_ONLY" as const,
    label: "Suggest replies",
    description:
      "The assistant drafts a reply and notifies you. Nothing is sent until someone approves it.",
  },
  {
    value: "AUTO_REPLY" as const,
    label: "Reply automatically",
    description:
      "The assistant answers, qualifies and offers booking on its own, and passes anything it should not handle to your team.",
  },
];

export const AGENT_CHANNEL_OPTIONS = [
  { value: "sms" as const, label: "SMS" },
  { value: "whatsapp" as const, label: "WhatsApp" },
  { value: "email" as const, label: "Email" },
];

export type AgentModeValue = (typeof AGENT_MODE_OPTIONS)[number]["value"];
export type AgentChannelValue = (typeof AGENT_CHANNEL_OPTIONS)[number]["value"];

/**
 * The `integrations.provider_type` of a workspace's own mailbox (migration
 * 0038/0039; `src/lib/email/store.ts`). The send path (`channelState`) reads
 * this same type, so the settings form and the sender agree on what
 * "connected" means. It used to read 'smtp_mailbox', a type no row ever has,
 * which left the Email channel permanently un-tickable.
 */
export const EMAIL_MAILBOX_PROVIDER_TYPE = "imap_smtp";

/** Mirrors `UNHEALTHY` in the send path: a mailbox in these states cannot send. */
const UNUSABLE_MAILBOX_STATUSES = new Set(["DISCONNECTED", "ACTION_REQUIRED"]);

/** Whether a mailbox integration row (or its absence) can send email. */
export function isMailboxUsable(row: { status: string | null } | null | undefined): boolean {
  if (!row) return false;
  return !UNUSABLE_MAILBOX_STATUSES.has(row.status ?? "");
}

/**
 * Whether the assistant may be offered a channel. SMS always has the platform
 * sender; WhatsApp needs the plan; email needs the workspace's own mailbox,
 * because email has no platform fallback sender.
 */
export function agentChannelAvailable(
  channel: AgentChannelValue,
  availability: { whatsappEnabled: boolean; emailConnected: boolean },
): boolean {
  if (channel === "whatsapp") return availability.whatsappEnabled;
  if (channel === "email") return availability.emailConnected;
  return true;
}

/**
 * Why a set of assistant settings cannot be saved, or null. Shared by the form
 * (for a message before the round trip) and the server action (the authority).
 */
export function agentSettingsProblem(settings: {
  enabled: boolean;
  agentMode: AgentModeValue;
  agentChannels: readonly AgentChannelValue[];
}): string | null {
  if (settings.enabled && settings.agentMode !== "OFF" && settings.agentChannels.length === 0) {
    return "Choose at least one channel for the assistant to work on.";
  }
  return null;
}

/**
 * What the assist-layer controls actually do, worded from the code that reads
 * them (`restyleMessage` and `matchAnswerWithAi` in src/lib/jobs/handlers, the
 * agent context in src/lib/agent/context.ts).
 */
export const AI_ASSIST_FIELD_COPY = {
  replyLength: {
    label: "Reply length",
    hint: "Guidance the AI follows when it writes a reply or rewords a message. A preference, not a hard limit.",
    options: { short: "Short", normal: "Normal" } as Record<(typeof AI_REPLY_LENGTH_OPTIONS)[number], string>,
  },
  allowAiReply: {
    label: "Let AI reword automatic messages",
    hint:
      "Your rules still decide what is said. AI may only adjust the wording and tone of qualification questions that have no answer options, the handover reply, and messages you ask it to polish. Every fact, name and link must survive, and the original text is sent if the reworded version fails a check. Follow-up sequence steps are sent exactly as written.",
  },
  allowAiInterpretation: {
    label: "Let AI interpret unclear answers",
    hint:
      "When a reply to a qualification question does not match any of your configured answers, AI suggests which answer it means. The suggestion is re-checked against your options, and if it still does not match the answer is left for review. Your rules make the qualification decision.",
  },
} as const;

export type AiBehaviourSettings = {
  /** Master on/off switch — business_settings.ai_assist_enabled. */
  enabled: boolean;
  tone: (typeof AI_TONE_OPTIONS)[number];
  replyLength: (typeof AI_REPLY_LENGTH_OPTIONS)[number];
  businessDescription: string;
  handoverInstruction: string;
  allowAiReply: boolean;
  allowAiInterpretation: boolean;
  /** Conversation agent. OFF unless a workspace deliberately turns it on. */
  agentMode: AgentModeValue;
  agentChannels: AgentChannelValue[];
  /** Send a REVIEW qualification result to a person rather than replying. */
  agentHandoverOnReview: boolean;
  /** Let the agent answer general service questions, not only qualify. */
  agentAnswerServiceQuestions: boolean;
};

export const saveAiBehaviourSchema = z.object({
  enabled: z.boolean(),
  tone: z.enum(AI_TONE_OPTIONS),
  replyLength: z.enum(AI_REPLY_LENGTH_OPTIONS),
  businessDescription: z.string().max(600).default(""),
  handoverInstruction: z.string().max(300).default(""),
  allowAiReply: z.boolean(),
  allowAiInterpretation: z.boolean(),
  agentMode: z.enum(["OFF", "SUGGEST_ONLY", "AUTO_REPLY"]).default("OFF"),
  agentChannels: z.array(z.enum(["sms", "whatsapp", "email"])).max(3).default([]),
  agentHandoverOnReview: z.boolean().default(true),
  agentAnswerServiceQuestions: z.boolean().default(true),
});

export const DEFAULT_AI_BEHAVIOUR: AiBehaviourSettings = {
  enabled: false,
  tone: "professional",
  replyLength: "short",
  businessDescription: "",
  handoverInstruction: "",
  allowAiReply: false,
  allowAiInterpretation: true,
  agentMode: "OFF",
  agentChannels: ["sms", "whatsapp"],
  agentHandoverOnReview: true,
  agentAnswerServiceQuestions: true,
};

/**
 * True when a settings change lets the assistant do more without a person:
 * turning it on in auto-reply, moving to AUTO_REPLY, switching on AI-worded
 * sends, or removing hand-over on review. Exported for tests.
 */
export function widensAutonomy(before: Pick<AiBehaviourSettings, "enabled" | "agentMode" | "allowAiReply" | "agentHandoverOnReview">,
  next: Pick<AiBehaviourSettings, "enabled" | "agentMode" | "allowAiReply" | "agentHandoverOnReview">): boolean {
  const autoBefore = before.enabled && before.agentMode === "AUTO_REPLY";
  const autoAfter = next.enabled && next.agentMode === "AUTO_REPLY";
  if (autoAfter && !autoBefore) return true;
  if (next.allowAiReply && !before.allowAiReply) return true;
  if (before.agentHandoverOnReview && !next.agentHandoverOnReview) return true;
  return false;
}
