/**
 * Copilot shapes, tool declarations and pure helpers (V4 §28).
 *
 * No `server-only` and no Supabase import, so the drawer can use these
 * directly. The tool *implementations* live in `tool-service.ts`, which is
 * server-only; this file declares what exists, who may run it, and which
 * actions need a human to say yes.
 */

import { z } from "zod";
import { operationsForCaller } from "../services/registry.ts";
import { isWrite, requiresConfirmation } from "../services/types.ts";

/* ------------------------------------------------------------------- tools */

export type ToolKind = "READ" | "WRITE";

/**
 * Permission scopes, mapped onto the workspace roles the product already has.
 * Copilot inherits the acting user's permissions exactly — there is no
 * "AI override" role and no way to ask for one.
 */
export type ToolScope = "viewer" | "member" | "admin" | "owner";

export type ToolDeclaration = {
  name: string;
  kind: ToolKind;
  /** One line, shown in the Actions tab and in the confirmation dialog. */
  summary: string;
  /** Minimum workspace role required. Re-checked server-side on every call. */
  scope: ToolScope;
  /**
   * High-impact writes cannot execute without an explicit human confirmation
   * carried on the request. Listed here so the drawer knows to ask *before*
   * calling, and enforced again in the tool service so a caller that skips the
   * dialog is refused rather than obeyed.
   */
  requiresConfirmation: boolean;
  /** What the confirmation dialog explains will happen. */
  effect?: string;
  /**
   * True when the tool acts on one record and therefore cannot be run from a
   * bare list with no argument. Declared rather than inferred from the name, so
   * the Actions tab does not have to keep its own list of exceptions in step.
   */
  needsObject?: boolean;
};

/**
 * Tools that are really service-layer operations.
 *
 * The catalogue for a ported domain is *derived* rather than restated. That is
 * the whole point of the service layer: Copilot, MCP and the agent runtime all
 * read the same registry, so a capability cannot exist for one of them and not
 * the others, and a permission cannot be tightened in one place and forgotten
 * in another.
 *
 * A tool here has no implementation in this file — `tool-service.ts` recognises
 * the name and calls `runOperation`.
 */
const SERVICE_TOOLS: ToolDeclaration[] = operationsForCaller("COPILOT").map(
  (operation) => ({
    name: operation.name,
    kind: isWrite(operation.risk) ? "WRITE" : "READ",
    summary: operation.summary,
    scope: operation.minimumRole,
    requiresConfirmation: requiresConfirmation(operation.risk),
    effect: operation.effect,
    // Anything naming a single record needs one selected first.
    needsObject: /\.(get|update|assign|set_status|add_note|archive|restore|flag_attention)$/.test(
      operation.name,
    ),
  }),
);

/**
 * The whole tool surface.
 *
 * Deliberately absent, and not by oversight: there is no SQL tool, no HTTP
 * tool, no "run arbitrary action" tool, and nothing that can send outreach,
 * enable overage, alter a suppression, or edit a locked business fact. Those
 * are outside Copilot's authority entirely, so there is no argument shape that
 * could express them.
 */
export const COPILOT_TOOLS: ToolDeclaration[] = [
  /* ------------------------------------------- service-layer operations
   *
   * Leads live here now. The four hand-written lead tools this replaced each
   * had their own workspace scoping and their own idea of what a result looked
   * like; there is one implementation of each now, shared with MCP and the
   * agent runtime.
   */
  ...SERVICE_TOOLS,

  /* ------------------------------------------------------------- reads */
  {
    name: "getProspects",
    kind: "READ",
    summary: "List sourced prospects",
    scope: "viewer",
    requiresConfirmation: false,
  },
  {
    name: "getCampaign",
    kind: "READ",
    summary: "Read a campaign's configuration",
    scope: "viewer",
    requiresConfirmation: false,
  },
  {
    name: "getCampaignPerformance",
    kind: "READ",
    summary: "Compare campaign performance",
    scope: "viewer",
    requiresConfirmation: false,
  },
  {
    name: "getAnalytics",
    kind: "READ",
    summary: "Read analytics for a period",
    scope: "viewer",
    requiresConfirmation: false,
  },
  {
    name: "getBusinessProfile",
    kind: "READ",
    summary: "Read what ClientTurn knows about the business",
    scope: "viewer",
    requiresConfirmation: false,
  },
  {
    name: "getIntentSignals",
    kind: "READ",
    summary: "Read recent intent signals",
    scope: "viewer",
    requiresConfirmation: false,
  },
  {
    name: "getUsage",
    kind: "READ",
    summary: "Read plan usage and allowances",
    scope: "admin",
    requiresConfirmation: false,
  },
  {
    name: "getAttentionItems",
    kind: "READ",
    summary: "List leads that need attention",
    scope: "viewer",
    requiresConfirmation: false,
  },

  /* ------------------------------------------------------------ writes */
  {
    name: "createSearchSession",
    kind: "WRITE",
    summary: "Start a new prospect search",
    scope: "member",
    requiresConfirmation: false,
  },
  {
    name: "startSourcingRun",
    kind: "WRITE",
    summary: "Run a sourcing search",
    scope: "admin",
    requiresConfirmation: true,
    effect:
      "This spends sourcing allowance and may incur provider costs against your plan.",
  },
  {
    name: "createCampaignDraft",
    kind: "WRITE",
    summary: "Create a campaign draft",
    scope: "admin",
    requiresConfirmation: false,
  },
  {
    name: "pauseCampaign",
    kind: "WRITE",
    summary: "Pause a campaign",
    scope: "admin",
    requiresConfirmation: true,
    effect:
      "No further emails are sent for this campaign. Prospects part-way through the sequence are held where they are and resume if you switch it back on.",
  },
  {
    name: "resumeCampaign",
    kind: "WRITE",
    summary: "Resume a campaign",
    scope: "admin",
    requiresConfirmation: true,
    effect:
      "Sending restarts from where each prospect left off. Every stop condition is re-checked immediately before each send.",
  },
  {
    name: "updateCampaignPriority",
    kind: "WRITE",
    summary: "Change a campaign's priority",
    scope: "admin",
    requiresConfirmation: true,
    effect:
      "Changes which campaign gets budget and sending capacity first when they compete.",
  },
  {
    name: "updateBusinessFact",
    kind: "WRITE",
    summary: "Update a business profile fact",
    scope: "admin",
    requiresConfirmation: true,
    effect:
      "This changes what ClientTurn believes about your business, which affects targeting and message generation. Locked facts cannot be changed this way.",
  },
  {
    name: "createSupportTicket",
    kind: "WRITE",
    summary: "Raise a support ticket",
    scope: "viewer",
    requiresConfirmation: false,
  },
];

const BY_NAME = new Map(COPILOT_TOOLS.map((tool) => [tool.name, tool]));

/**
 * Tool names as the model is shown them, and back again.
 *
 * A provider requires `^[a-zA-Z0-9_-]+$`, and service operations are named
 * `lead.archive`. The mapping has to be reversible, because a call the model
 * makes has to be routed back to the operation it named — a lossy encoding
 * would make some tools unreachable rather than merely ugly.
 */
export function toFunctionName(toolName: string): string {
  return toolName.replace(/\./g, "__");
}

export function fromFunctionName(functionName: string): string {
  return functionName.replace(/__/g, ".");
}

export function copilotTool(name: string): ToolDeclaration | undefined {
  return BY_NAME.get(name);
}

/** Role ordering, mirroring `hasRole` in the session module. */
const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function roleAllows(role: string, scope: ToolScope): boolean {
  return (ROLE_RANK[role] ?? -1) >= ROLE_RANK[scope];
}

/* ------------------------------------------------------------------ chat */

export const COPILOT_TABS = [
  { id: "chat", label: "Chat" },
  { id: "actions", label: "Actions" },
  { id: "insights", label: "Insights" },
  { id: "history", label: "History" },
] as const;

export type CopilotTab = (typeof COPILOT_TABS)[number]["id"];

export type CopilotRole = "USER" | "ASSISTANT" | "TOOL";

export type CopilotMessage = {
  id: string;
  role: CopilotRole;
  content: string;
  createdAt: string;
  /**
   * A short, structured note about any tool results this turn used. Never a
   * raw provider payload, and never model reasoning — there is no column for
   * chain-of-thought and no code path that writes one.
   */
  toolSummary?: {
    tool?: string;
    label?: string;
    /** A domain action the customer can take on this answer. */
    cta?: { tool: string; label: string; objectId?: string };
    /** What ran this turn, in order, with the audit row for each write. */
    steps?: {
      tool: string;
      ok: boolean;
      summary: string;
      entityId?: string | null;
      auditEventId?: string | null;
      warnings?: { code: string; message: string }[];
    }[];
    /**
     * An action Copilot stopped short of, because it needs a person to agree.
     * Carries the exact arguments so the confirmation applies to this call and
     * not to the next one that happens to use the same tool.
     */
    awaiting?: {
      tool: string;
      summary: string;
      effect: string;
      args: Record<string, unknown>;
    } | null;
    correlationId?: string;
  };
};

export type CopilotActionRow = {
  id: string;
  toolName: string;
  kind: ToolKind;
  objectType: string | null;
  objectId: string | null;
  requestSummary: string;
  confirmed: boolean;
  outcome: "PENDING" | "SUCCESS" | "DENIED" | "FAILED";
  errorLabel: string | null;
  actorName: string | null;
  createdAt: string;
};

/* --------------------------------------------------------------- prompts */

/** The example prompts the empty Chat tab offers. */
export const EXAMPLE_PROMPTS = [
  "Find another 100 companies similar to this month's converted customers.",
  "Which leads need attention?",
  "Why is the Hotels campaign outperforming Property Managers?",
  "Draft a new permitted email campaign for facilities managers.",
  "Show prospects with recent expansion intent.",
  "Pause Campaign B.",
  "Summarize this lead and recommend the next action.",
] as const;

/** Shortcut chips beneath the composer. Each is a prompt starter, not a tool. */
export const SHORTCUTS = [
  { id: "search", label: "Search", prompt: "Find prospects matching " },
  { id: "leads", label: "Leads", prompt: "Which leads need attention?" },
  {
    id: "campaigns",
    label: "Campaigns",
    prompt: "How are my campaigns performing?",
  },
  {
    id: "analytics",
    label: "Analytics",
    prompt: "Summarise my analytics for the last 30 days.",
  },
  { id: "create", label: "Create", prompt: "Create a campaign draft for " },
  { id: "settings", label: "Settings", prompt: "What does ClientTurn know about my business?" },
] as const;

/* ---------------------------------------------------------------- schemas */

export const MAX_PROMPT_LENGTH = 2000;

export const askSchema = z.object({
  sessionId: z.uuid().nullable().optional(),
  prompt: z.string().trim().min(2).max(MAX_PROMPT_LENGTH),
  /** The route the drawer was opened from, so answers can be contextual. */
  route: z.string().trim().max(200).optional(),
  /** A record the user has open, if any. Never a workspace id. */
  focus: z
    .object({
      type: z.enum(["LEAD", "PROSPECT", "CAMPAIGN"]),
      id: z.uuid(),
    })
    .nullable()
    .optional(),
  /**
   * A confirmation the person just gave, carried back with the next message.
   *
   * It names both the tool and the exact arguments. Matching on the tool alone
   * would let a model obtain agreement to archive one lead and then spend that
   * agreement on a different one.
   */
  confirmed: z
    .object({
      tool: z.string().trim().max(80),
      args: z.record(z.string(), z.unknown()),
    })
    .nullable()
    .optional(),
});

export const runToolSchema = z.object({
  sessionId: z.uuid().nullable().optional(),
  tool: z.string().trim().min(1).max(64),
  /** Tool-specific arguments; each tool parses its own shape. */
  args: z.record(z.string(), z.unknown()).default({}),
  /** True only when a human pressed Confirm on the dialog for this action. */
  confirmed: z.boolean().default(false),
});
