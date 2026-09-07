import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { MCP_TOOLS, mcpKindForRisk, roleAllows, toolByName, toolsForScopes } from "./tools";
import type { ToolDefinition } from "./tools";
import { serviceOperation, runOperation } from "@/lib/services";
import { handlerSchema } from "@/lib/services/runtime";
import { toolInputSchema } from "@/lib/services/json-schema";
import { operationsForCaller } from "@/lib/services/registry";

/**
 * The MCP gateway (V4 §88).
 *
 * An external assistant reaches ClientTurn only through here, and this module
 * enforces the four things that make that safe:
 *
 *   1. **The token is hashed.** A leaked database row cannot be replayed.
 *   2. **The authorising user's live role is the ceiling.** Re-read on every
 *      call, so a demotion or a removed membership takes effect immediately —
 *      not when the token happens to expire.
 *   3. **Scope is checked before the tool runs**, and a denial is audited with
 *      the reason rather than silently returning nothing.
 *   4. **High-impact tools park for a human.** They never execute inline.
 *
 * It calls the same domain services the UI does. There is no path from here to
 * a raw table write, so RLS, policy, budget and confirmation logic all still
 * apply exactly as they do for a person clicking in the app.
 */

export type AuthContext = {
  clientId: string;
  businessId: string;
  userId: string;
  userRole: string;
  scopes: string[];
};

export type ToolCallResult =
  | { ok: true; content: unknown }
  | { ok: false; code: string; message: string; approvalId?: string };

/** Tokens are stored as a SHA-256 digest; the plaintext exists only in transit. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolves a bearer token to its context, or null.
 *
 * Every check is a reason to refuse: expired, revoked, client suspended, or the
 * authorising user no longer an active member of the workspace.
 */
export async function authenticate(bearer: string | null): Promise<AuthContext | null> {
  if (!bearer) return null;
  const token = bearer.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const db = createAdminClient();

  const { data: row } = await db
    .from("mcp_tokens")
    .select("id, client_id, business_id, user_id, scopes, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .eq("token_type", "ACCESS")
    .maybeSingle();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const [{ data: client }, { data: membership }] = await Promise.all([
    db.from("mcp_clients").select("status").eq("id", row.client_id).maybeSingle(),
    // The live membership, not a snapshot taken when the token was issued.
    db
      .from("business_members")
      .select("role, status")
      .eq("business_id", row.business_id)
      .eq("user_id", row.user_id)
      .maybeSingle(),
  ]);

  if (client?.status !== "ACTIVE") return null;
  if (!membership || membership.status !== "active") return null;

  // Best-effort: a failed touch must not refuse an otherwise valid call.
  await db
    .from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(
      () => undefined,
      () => undefined,
    );

  return {
    clientId: row.client_id,
    businessId: row.business_id,
    userId: row.user_id,
    userRole: membership.role,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
  };
}

/**
 * Service-layer operations, described as MCP tools.
 *
 * Derived, not restated. The catalogue, the permission model and the risk class
 * all come from the one registry Copilot and the agent runtime read, so an MCP
 * client cannot be offered a capability the others do not have — nor be denied
 * one they do. The argument schema is generated from the operation's own
 * validator, so what a client is shown is exactly what will be enforced.
 *
 * Anything needing a person's confirmation becomes APPROVAL_GATED: over MCP
 * there is nobody at a keyboard to confirm, so it parks for a human instead of
 * executing.
 */
function serviceTools(): ToolDefinition[] {
  const out: ToolDefinition[] = [];

  for (const operation of operationsForCaller("MCP")) {
    const schema = handlerSchema(operation.name);
    // An operation with no implementation yet is simply not advertised. A tool
    // that lists but always fails is worse than one that is absent.
    if (!schema) continue;

    out.push({
      name: operation.name,
      kind: mcpKindForRisk(operation.risk),
      scope: operation.scope as ToolDefinition["scope"],
      description: operation.effect
        ? `${operation.summary}. ${operation.effect}`
        : operation.summary,
      inputSchema: toolInputSchema(schema) as ToolDefinition["inputSchema"],
      minimumRole: operation.minimumRole,
    });
  }

  return out;
}

/** The tools this token may see. Listing is itself scope-filtered, so an
 *  assistant cannot learn a capability exists that it cannot use. */
export function listTools(auth: AuthContext): ToolDefinition[] {
  const granted = new Set(auth.scopes);
  const service = serviceTools().filter(
    (tool) => granted.has(tool.scope) && roleAllows(auth.userRole, tool),
  );
  const legacy = toolsForScopes(auth.scopes).filter((tool) =>
    roleAllows(auth.userRole, tool),
  );
  return [...service, ...legacy];
}

async function audit(
  auth: AuthContext,
  toolName: string,
  kind: string,
  args: unknown,
  result: string,
  denialReason: string | null,
  approvalId: string | null,
  latencyMs: number,
): Promise<void> {
  const db = createAdminClient();
  await db
    .from("mcp_audit_logs")
    .insert({
      business_id: auth.businessId,
      client_id: auth.clientId,
      user_id: auth.userId,
      tool_name: toolName,
      tool_kind: kind,
      arguments_json: (args ?? {}) as never,
      result,
      denial_reason: denialReason,
      approval_id: approvalId,
      latency_ms: latencyMs,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * Runs one tool call.
 *
 * Ordered so a denial is decided before any work happens, and every outcome —
 * including every refusal — is audited.
 */
export async function callTool(
  auth: AuthContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const started = Date.now();
  const tool = serviceOperation(name)
    ? (serviceTools().find((candidate) => candidate.name === name) ?? null)
    : toolByName(name);

  if (!tool) {
    await audit(auth, name, "READ", args, "NOT_FOUND", "No such tool", null, Date.now() - started);
    return { ok: false, code: "NOT_FOUND", message: `Unknown tool: ${name}` };
  }

  if (!auth.scopes.includes(tool.scope)) {
    await audit(
      auth,
      name,
      tool.kind,
      args,
      "DENIED_SCOPE",
      `Missing scope ${tool.scope}`,
      null,
      Date.now() - started,
    );
    return {
      ok: false,
      code: "DENIED_SCOPE",
      message: `This connection was not granted the "${tool.scope}" permission.`,
    };
  }

  if (!roleAllows(auth.userRole, tool)) {
    await audit(
      auth,
      name,
      tool.kind,
      args,
      "DENIED_ROLE",
      `Requires ${tool.minimumRole}, user is ${auth.userRole}`,
      null,
      Date.now() - started,
    );
    return {
      ok: false,
      code: "DENIED_ROLE",
      message: `This action needs ${tool.minimumRole} access in the workspace.`,
    };
  }

  // High-impact tools park rather than execute. The assistant is told plainly
  // that a person has to approve, so it does not report success.
  if (tool.kind === "APPROVAL_GATED") {
    const db = createAdminClient();
    const { data: approval } = await db
      .from("mcp_approvals")
      .insert({
        business_id: auth.businessId,
        client_id: auth.clientId,
        requested_by_user_id: auth.userId,
        tool_name: name,
        arguments_json: args as never,
        summary: describeRequest(tool, args),
        status: "PENDING",
      })
      .select("id")
      .single();

    await audit(
      auth,
      name,
      tool.kind,
      args,
      "AWAITING_APPROVAL",
      null,
      approval?.id ?? null,
      Date.now() - started,
    );

    return {
      ok: false,
      code: "AWAITING_APPROVAL",
      message:
        "This action needs a person in the workspace to approve it. It has been queued for review and has not been carried out.",
      approvalId: approval?.id,
    };
  }

  try {
    // A ported operation goes to the one implementation the UI, Copilot and the
    // agent runtime all use. `confirmed` is deliberately absent: an MCP client
    // has nobody at a keyboard, and anything needing confirmation was parked
    // above rather than reaching here.
    if (serviceOperation(name)) {
      const result = await runOperation(name, args, {
        businessId: auth.businessId,
        userId: auth.userId,
        role: auth.userRole as "owner" | "admin" | "member" | "viewer",
        caller: "MCP",
        correlationId: randomUUID(),
      });

      if (!result.success) {
        await audit(auth, name, tool.kind, args, "ERROR", result.message, null, Date.now() - started);
        return { ok: false, code: result.code, message: result.message };
      }

      await audit(auth, name, tool.kind, args, "OK", null, null, Date.now() - started);
      return {
        ok: true,
        content: {
          ...(result.data as Record<string, unknown>),
          // Returned so an assistant can report what changed rather than assert
          // that something did.
          _change: {
            entityId: result.entityId,
            before: result.before,
            after: result.after,
            auditEventId: result.auditEventId,
            warnings: result.warnings,
          },
        },
      };
    }

    const { runReadOrWriteTool } = await import("./handlers");
    const content = await runReadOrWriteTool(auth, tool, args);
    await audit(auth, name, tool.kind, args, "OK", null, null, Date.now() - started);
    return { ok: true, content };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The tool failed.";
    await audit(auth, name, tool.kind, args, "ERROR", message, null, Date.now() - started);
    return { ok: false, code: "ERROR", message };
  }
}

/** A one-line summary a person can act on without reading JSON. */
function describeRequest(tool: ToolDefinition, args: Record<string, unknown>): string {
  switch (tool.name) {
    case "send_message":
      return `Send a ${String(args.channel ?? "message")} to lead ${String(args.leadId ?? "")}`;
    case "launch_campaign":
      return `Launch campaign ${String(args.campaignId ?? "")}`;
    case "start_sourcing_run":
      return `Start a sourcing run for up to ${String(args.target ?? "the plan default")} prospects`;
    case "change_overage_cap":
      return `Change the additional-usage cap to ${String(args.capMinor ?? 0)} pence`;
    default:
      return `Run ${tool.name}`;
  }
}

export { MCP_TOOLS };
