/**
 * Read models for the assistant surfaces.
 *
 * Pure types and labels, no `server-only` and no Supabase import, so the
 * client components that render handovers, drafts and run history can import
 * from here without pulling the runtime into the browser bundle.
 *
 * Everything exposed here is an *outcome*. Prompts, tool arguments, model
 * reasoning and provider detail deliberately have no representation in these
 * shapes -- there is no field for them to travel in.
 */

import type {
  AgentOutcome,
  AgentRunStatus,
  HandoverPriority,
  HandoverReason,
  LeadIntent,
} from "./types";

export type HandoffStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED";

export const HANDOFF_STATUS_LABEL: Record<HandoffStatus, string> = {
  OPEN: "Needs a person",
  ACKNOWLEDGED: "Being handled",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const HANDOFF_STATUS_TONE: Record<HandoffStatus, string> = {
  OPEN: "danger",
  ACKNOWLEDGED: "warning",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

export const HANDOFF_PRIORITY_LABEL: Record<HandoverPriority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low",
};

/** The factual summary the runtime wrote when it handed over. */
export type HandoffSummaryView = {
  intent: string | null;
  service: string | null;
  qualificationStatus: string | null;
  keyAnswers: { question: string; value: string }[];
  bookingIntent: boolean;
  unresolvedIssue: string | null;
  sentiment: string | null;
  summary: string | null;
};

export type HandoffRow = {
  id: string;
  leadId: string;
  leadName: string;
  conversationId: string | null;
  reason: HandoverReason;
  reasonLabel: string;
  priority: HandoverPriority;
  status: HandoffStatus;
  summary: HandoffSummaryView;
  assignedUserId: string | null;
  assigneeName: string | null;
  resolutionNote: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

/** A suggest-only reply waiting for a person. */
export type AgentDraftRow = {
  id: string;
  conversationId: string;
  leadId: string;
  channel: string;
  body: string;
  createdAt: string;
  /** The run that produced it, for the activity trail. */
  agentRunId: string | null;
};

export type AgentRunRow = {
  id: string;
  triggerEventType: string;
  mode: string;
  status: AgentRunStatus;
  outcome: AgentOutcome | null;
  intent: LeadIntent | null;
  /** Customer-facing wording; never a confidence number. */
  outcomeLabel: string;
  errorCode: string | null;
  durationMs: number | null;
  createdAt: string;
};

/** Everything the assistant panel needs for one conversation. */
export type ConversationAgentState = {
  conversationId: string;
  leadId: string | null;
  owner: "AI_ACTIVE" | "HUMAN_ACTIVE" | "HANDED_OVER" | "CLOSED";
  /** Whether the workspace has the agent switched on for this channel at all. */
  agentEnabledHere: boolean;
  agentMode: "OFF" | "SUGGEST_ONLY" | "AUTO_REPLY";
  openHandoff: HandoffRow | null;
  pendingDrafts: AgentDraftRow[];
  recentRuns: AgentRunRow[];
};

export const OWNER_LABEL: Record<ConversationAgentState["owner"], string> = {
  AI_ACTIVE: "Assistant is handling this",
  HUMAN_ACTIVE: "You are handling this",
  HANDED_OVER: "Waiting for your team",
  CLOSED: "Closed",
};

export const OWNER_TONE: Record<ConversationAgentState["owner"], string> = {
  AI_ACTIVE: "accent",
  HUMAN_ACTIVE: "info",
  HANDED_OVER: "warning",
  CLOSED: "neutral",
};

export type AgentActionResult = { ok: true } | { ok: false; error: string };
