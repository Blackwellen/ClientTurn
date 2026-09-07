"use server";

import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTool, type ToolContext } from "./tool-service";
import {
  askSchema,
  runToolSchema,
  type CopilotActionRow,
  type CopilotMessage,
} from "./types";
import { buildInsights, type CopilotInsight } from "./insights";

/**
 * Copilot server actions (V4 §28).
 *
 * The workspace and the acting role are always resolved from the session.
 * Nothing here accepts a `businessId`, a `role` or a `userId` from the browser,
 * so a crafted request cannot widen its own permissions or reach another
 * tenant's data.
 */

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: string): Result<never> {
  return { ok: false, error };
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/* --------------------------------------------------------------- sessions */

async function resolveSession(
  businessId: string,
  userId: string,
  sessionId: string | null | undefined,
  originPath: string | undefined,
): Promise<string | null> {
  const admin = createAdminClient();

  if (sessionId) {
    // A session id is only usable by the person whose session it is: a Copilot
    // conversation is private even from colleagues in the same workspace.
    const { data } = await admin
      .from("copilot_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return data.id;
  }

  const { data: created } = await admin
    .from("copilot_sessions")
    .insert({
      business_id: businessId,
      user_id: userId,
      origin_path: originPath ?? null,
    })
    .select("id")
    .single();

  return created?.id ?? null;
}

async function appendMessage(input: {
  sessionId: string;
  businessId: string;
  role: "USER" | "ASSISTANT" | "TOOL";
  content: string;
  toolSummary?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("copilot_messages")
    .insert({
      session_id: input.sessionId,
      business_id: input.businessId,
      role: input.role,
      content: input.content,
      // Visible content and a short structured note only. There is no column
      // for model reasoning, and nothing writes one.
      tool_summary: (input.toolSummary ?? {}) as never,
    })
    .select("id, role, content, tool_summary, created_at")
    .single();

  await admin
    .from("copilot_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", input.sessionId);

  return data;
}

/* -------------------------------------------------------------------- ask */

/**
 * A turn of conversation.
 *
 * Deliberately grounded: the answer is assembled from real tool results rather
 * than generated free-form, so Copilot cannot invent a figure, a campaign or a
 * company fact. Where a question cannot be answered from the tools available,
 * it says so rather than guessing.
 */
export async function askCopilot(input: unknown): Promise<
  Result<{ sessionId: string; messages: CopilotMessage[] }>
> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return fail("Ask a question between 2 and 2,000 characters.");

  const workspace = await requireWorkspace();

  const sessionId = await resolveSession(
    workspace.businessId,
    workspace.userId,
    parsed.data.sessionId,
    parsed.data.route,
  );
  if (!sessionId) return fail("Copilot could not start a session.");

  await appendMessage({
    sessionId,
    businessId: workspace.businessId,
    role: "USER",
    content: parsed.data.prompt,
  });

  const context: ToolContext = {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    sessionId,
  };

  const answer = await answerFrom(context, parsed.data.prompt);

  const assistant = await appendMessage({
    sessionId,
    businessId: workspace.businessId,
    role: "ASSISTANT",
    content: answer.content,
    toolSummary: answer.toolSummary,
  });

  const messages: CopilotMessage[] = assistant
    ? [
        {
          id: assistant.id,
          role: "ASSISTANT",
          content: assistant.content,
          createdAt: assistant.created_at,
          toolSummary: answer.toolSummary as CopilotMessage["toolSummary"],
        },
      ]
    : [];

  return ok({ sessionId, messages });
}

/**
 * Routes a question to the read tools that can answer it and states the
 * finding, the evidence and — where one exists — the action.
 *
 * There is no free-text generation here at all. Every sentence below is built
 * from numbers a tool returned, which is what makes "no fabricated insights"
 * (§28.12) a property of the code rather than a hope about a prompt.
 */
async function answerFrom(
  context: ToolContext,
  prompt: string,
): Promise<{ content: string; toolSummary: Record<string, unknown> }> {
  const text = prompt.toLowerCase();

  if (/(need|needs) attention|who should i|follow up with/.test(text)) {
    const result = await runTool(context, "getAttentionItems", {}, false);
    if (result.ok) {
      const rows = result.data as { id: string; attention_reason: string | null }[];
      return {
        content:
          rows.length === 0
            ? "Nothing needs attention right now. Every lead is either progressing or closed."
            : `${rows.length} ${rows.length === 1 ? "lead needs" : "leads need"} attention. The most common reason is "${commonest(rows.map((r) => r.attention_reason ?? "unknown"))}".`,
        toolSummary: {
          tool: "getAttentionItems",
          label: result.summary,
          cta: rows.length > 0 ? { tool: "openLeads", label: "View leads" } : undefined,
        },
      };
    }
  }

  if (/campaign/.test(text) && /(perform|outperform|better|compare|why)/.test(text)) {
    const result = await runTool(context, "getCampaignPerformance", {}, false);
    if (result.ok) {
      const rows = result.data as {
        name: string;
        conversionRate: number | null;
        prospects: number;
        replies: number;
      }[];
      const ranked = rows
        .filter((row) => row.conversionRate !== null && row.prospects > 0)
        .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0));

      if (ranked.length < 2) {
        return {
          content:
            "There is not enough campaign activity yet to compare performance meaningfully.",
          toolSummary: { tool: "getCampaignPerformance", label: result.summary },
        };
      }

      const [best, worst] = [ranked[0], ranked[ranked.length - 1]];
      return {
        content: `"${best.name}" converts at ${pct(best.conversionRate)} against ${pct(worst.conversionRate)} for "${worst.name}". ${best.name} has had ${best.replies} replies from ${best.prospects} prospects. Worth testing ${best.name}'s subject style on ${worst.name}.`,
        toolSummary: {
          tool: "getCampaignPerformance",
          label: result.summary,
          cta: { tool: "createCampaignDraft", label: "Create variant test" },
        },
      };
    }
  }

  if (/analytic|conversion rate|reply rate|how are we doing|performance/.test(text)) {
    const result = await runTool(context, "getAnalytics", { view: "overview" }, false);
    if (result.ok) {
      return {
        content:
          "Here is your last 30 days across the full journey. Every figure comes from the same analytics service the Analytics page uses.",
        toolSummary: {
          tool: "getAnalytics",
          label: result.summary,
          cta: { tool: "openAnalytics", label: "Open Analytics" },
        },
      };
    }
  }

  if (/intent|expansion|signal/.test(text)) {
    const result = await runTool(context, "getIntentSignals", {}, false);
    if (result.ok) {
      const rows = result.data as unknown[];
      return {
        content:
          rows.length === 0
            ? "No live intent signals right now. Intent monitors surface them here as they arrive."
            : `${rows.length} prospects currently carry a live intent signal.`,
        toolSummary: { tool: "getIntentSignals", label: result.summary },
      };
    }
  }

  if (/business|know about|profile|icp/.test(text)) {
    const result = await runTool(context, "getBusinessProfile", {}, false);
    if (result.ok) {
      return {
        content:
          "This is what ClientTurn currently knows about your business. You can edit, verify or lock any fact in Settings → Business Profile.",
        toolSummary: {
          tool: "getBusinessProfile",
          label: result.summary,
          cta: { tool: "openBusinessProfile", label: "Open Business Profile" },
        },
      };
    }
  }

  if (/usage|allowance|limit|billing/.test(text)) {
    const result = await runTool(context, "getUsage", {}, false);
    if (result.ok) {
      return {
        content: "Here is your current usage against your plan allowances.",
        toolSummary: {
          tool: "getUsage",
          label: result.summary,
          cta: { tool: "openBilling", label: "Open Billing & Usage" },
        },
      };
    }
    return {
      content:
        "Usage and allowances are only visible to owners and admins, so I cannot read them for you.",
      toolSummary: { tool: "getUsage", label: "Permission denied" },
    };
  }

  if (/lead|prospect|compan/.test(text)) {
    const result = await runTool(context, "searchLeads", { query: extractQuery(prompt) }, false);
    if (result.ok) {
      const rows = result.data as unknown[];
      return {
        content:
          rows.length === 0
            ? "No leads matched that. Try a name, a company or an email address."
            : `Found ${rows.length} matching ${rows.length === 1 ? "lead" : "leads"}.`,
        toolSummary: { tool: "searchLeads", label: result.summary },
      };
    }
  }

  // The honest default. Copilot says what it can do rather than improvising an
  // answer it cannot ground in a tool result.
  return {
    content:
      "I can look at your leads, prospects, campaigns, analytics, intent signals and business profile, and I can pause or resume a campaign with your confirmation. Ask me about any of those and I will answer from your live data.",
    toolSummary: {},
  };
}

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function commonest(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
}

/** Strips the instruction words so a search gets the subject, not the verb. */
function extractQuery(prompt: string): string {
  return prompt
    .replace(/^(find|show|search|list|get)\s+(me\s+)?/i, "")
    .replace(/\b(leads?|prospects?|companies|company)\b/gi, "")
    .trim()
    .slice(0, 120);
}

/* -------------------------------------------------------------- run tool */

/**
 * Runs one tool directly, from an action chip or a confirmation dialog.
 *
 * The `confirmed` flag is not trusted on its own: the tool service checks it
 * against the tool's own `requiresConfirmation`, and logs the invocation either
 * way, so a request that claims confirmation it never obtained is still
 * recorded and still refused where the domain service refuses it.
 */
export async function runCopilotTool(input: unknown): Promise<
  Result<{ summary: string; data: unknown }>
> {
  const parsed = runToolSchema.safeParse(input);
  if (!parsed.success) return fail("That action could not be run.");

  const workspace = await requireWorkspace();

  const sessionId = await resolveSession(
    workspace.businessId,
    workspace.userId,
    parsed.data.sessionId,
    undefined,
  );

  const result = await runTool(
    {
      businessId: workspace.businessId,
      userId: workspace.userId,
      role: workspace.role,
      sessionId,
    },
    parsed.data.tool,
    parsed.data.args,
    parsed.data.confirmed,
  );

  if (!result.ok) return fail(result.error);

  if (sessionId) {
    await appendMessage({
      sessionId,
      businessId: workspace.businessId,
      role: "TOOL",
      content: result.summary,
      toolSummary: { tool: parsed.data.tool, label: result.summary },
    });
  }

  return ok({ summary: result.summary, data: result.data });
}

/* ----------------------------------------------------------------- reads */

export async function listCopilotMessages(
  sessionId: unknown,
): Promise<CopilotMessage[]> {
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) return [];

  const workspace = await requireWorkspace();
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("copilot_sessions")
    .select("id")
    .eq("id", id.data)
    .eq("business_id", workspace.businessId)
    .eq("user_id", workspace.userId)
    .maybeSingle();

  if (!session) return [];

  const { data } = await admin
    .from("copilot_messages")
    .select("id, role, content, tool_summary, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: true })
    .limit(100);

  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as CopilotMessage["role"],
    content: row.content,
    createdAt: row.created_at,
    toolSummary: row.tool_summary as CopilotMessage["toolSummary"],
  }));
}

/**
 * The action log.
 *
 * Workspace-visible rather than private to the person who ran it: this is an
 * accountability record, and an owner must be able to see what Copilot did.
 */
export async function listCopilotActions(): Promise<CopilotActionRow[]> {
  const workspace = await requireWorkspace();
  const admin = createAdminClient();

  const { data } = await admin
    .from("copilot_actions")
    .select(
      "id, tool_name, kind, object_type, object_id, request_summary, confirmed, outcome, error_label, created_at, user_id",
    )
    .eq("business_id", workspace.businessId)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = data ?? [];
  const userIds = [...new Set(rows.map((row) => row.user_id))];

  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, first_name, last_name, email")
      .in("id", userIds);
    for (const profile of profiles ?? []) {
      names.set(
        profile.id,
        [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
          profile.email ||
          "Someone",
      );
    }
  }

  return rows.map((row) => ({
    id: row.id,
    toolName: row.tool_name,
    kind: row.kind as CopilotActionRow["kind"],
    objectType: row.object_type,
    objectId: row.object_id,
    requestSummary: row.request_summary,
    confirmed: row.confirmed,
    outcome: row.outcome as CopilotActionRow["outcome"],
    errorLabel: row.error_label,
    actorName: names.get(row.user_id) ?? null,
    createdAt: row.created_at,
  }));
}

export async function listCopilotInsights(): Promise<CopilotInsight[]> {
  const workspace = await requireWorkspace();
  return buildInsights(workspace.businessId);
}
