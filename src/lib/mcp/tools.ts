/**
 * The ClientTurn MCP tool catalogue (V4 §88).
 *
 * Pure — no `server-only`, no Supabase — so the catalogue can be rendered in
 * Settings and asserted in tests without a database.
 *
 * Three rules the shape of this file enforces:
 *
 *   1. **Every tool declares its kind.** READ, WRITE or APPROVAL_GATED. There is
 *      no tool that is implicitly safe; the kind is what the gateway checks.
 *   2. **Scopes are coarse and named after what they let you do**, not after
 *      tables. An assistant granted `leads:read` cannot discover that
 *      `contact_permissions` exists.
 *   3. **The high-impact tools are gated by construction.** Anything that sends
 *      a message, launches a campaign or moves money is APPROVAL_GATED, so it
 *      parks for a human rather than executing (§88.5).
 */

import {
  isWrite,
  requiresConfirmation,
  type RiskClass,
} from "../services/types.ts";
import {
  PLATFORM_SCOPES,
  SCOPE_DESCRIPTIONS,
  roleMeets,
  type PlatformScope,
} from "../platform/scopes.ts";

export type ToolKind = "READ" | "WRITE" | "APPROVAL_GATED";

/**
 * Re-exported, not redeclared. MCP, workspace API keys and webhooks are three
 * doors into the same building, so they read one list of permissions — see
 * `lib/platform/scopes`. Keeping a second copy here is how `leads:write` ends
 * up meaning something slightly different over MCP than over HTTP.
 */
export const MCP_SCOPES = PLATFORM_SCOPES;

export type McpScope = PlatformScope;

export type ToolDefinition = {
  name: string;
  kind: ToolKind;
  scope: McpScope;
  description: string;
  /** JSON Schema for the arguments, as MCP clients expect. */
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  /**
   * The minimum workspace role the authorising user must hold.
   *
   * Includes `owner` because service-layer operations are described as MCP
   * tools and the registry can restrict one to the workspace owner. Narrowing
   * it here would have silently downgraded such an operation to admin.
   */
  minimumRole: "viewer" | "member" | "admin" | "owner";
};

/**
 * The tools that are not service-layer operations.
 *
 * This list used to hold seventeen entries and now holds one, and the shrinking
 * is the point rather than a loss. Thirteen of them duplicated an operation the
 * service registry now declares — offering an assistant both `get_lead` and
 * `lead.get` makes it choose between two tools that do the same thing, and
 * costs a client's context twice for one capability.
 *
 * The other three were worse than duplicates. `send_message`,
 * `launch_campaign`, `start_sourcing_run` and `change_overage_cap` were
 * APPROVAL_GATED, which meant they parked for a person — and then failed when
 * that person approved them, because `executeApproval` can only run a
 * registered service operation and there was none. They advertised a capability
 * that could not complete. `message.send` and `campaign.launch` now exist for
 * real; the other two are gone rather than left as promises.
 *
 * `create_lead` stays because it is not a duplicate: `lead.create` is
 * deliberately absent from the registry, and this handler does the thing that
 * absence protects — it refuses a contact that is not a warm relationship, and
 * records the lawful basis for contacting them.
 */
export const MCP_TOOLS: ToolDefinition[] = [

  /* ----------------------------------------------------------- write tools */
  {
    name: "create_lead",
    kind: "WRITE",
    scope: "leads:write",
    description:
      "Create a warm lead. The relationship must be stated; a contact you merely found becomes a prospect instead, never a lead.",
    inputSchema: {
      type: "object",
      properties: {
        firstName: { type: "string", description: "First name." },
        lastName: { type: "string", description: "Last name." },
        email: { type: "string", description: "Email address." },
        phone: { type: "string", description: "Phone number." },
        companyName: { type: "string", description: "Company." },
        relationshipType: {
          type: "string",
          description:
            "How you know them: THEY_CONTACTED_US, EXISTING_CUSTOMER, REFERRAL, REQUESTED_INFORMATION, EXPLICIT_MARKETING_CONSENT or EXISTING_BUSINESS_RELATIONSHIP.",
        },
      },
      required: ["relationshipType"],
    },
    minimumRole: "member",
  },

];

/**
 * How a service-layer risk class appears to an MCP client.
 *
 * Anything a person would have to confirm becomes APPROVAL_GATED rather than
 * WRITE: over MCP there is nobody at a keyboard, so "ask the user" is not
 * available and the only honest options are to park it for a human or refuse
 * it. Parking is the more useful of the two.
 *
 * Pure and separate from the gateway so the mapping can be asserted directly —
 * a destructive operation silently arriving as a plain WRITE is exactly the
 * regression that would otherwise pass review unnoticed.
 */
export function mcpKindForRisk(risk: RiskClass): ToolKind {
  if (requiresConfirmation(risk)) return "APPROVAL_GATED";
  return isWrite(risk) ? "WRITE" : "READ";
}

export function toolByName(name: string): ToolDefinition | null {
  return MCP_TOOLS.find((tool) => tool.name === name) ?? null;
}

export function toolsForScopes(scopes: string[]): ToolDefinition[] {
  const granted = new Set(scopes);
  return MCP_TOOLS.filter((tool) => granted.has(tool.scope));
}

/**
 * Whether the authorising user's *current* role still permits this tool.
 *
 * Checked at call time, not just at grant time (§88.2): a token issued while
 * someone was an admin must stop working the moment they are demoted.
 */
export function roleAllows(userRole: string, tool: ToolDefinition): boolean {
  return roleMeets(userRole, tool.minimumRole);
}

export { SCOPE_DESCRIPTIONS };
