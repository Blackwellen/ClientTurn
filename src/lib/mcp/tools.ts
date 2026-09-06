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

export type ToolKind = "READ" | "WRITE" | "APPROVAL_GATED";

export const MCP_SCOPES = [
  "leads:read",
  "leads:write",
  "prospects:read",
  "prospects:write",
  "campaigns:read",
  "campaigns:write",
  "analytics:read",
  "business:read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

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
  /** The minimum workspace role the authorising user must hold. */
  minimumRole: "viewer" | "member" | "admin";
};

const noArgs = { type: "object" as const, properties: {} };

export const MCP_TOOLS: ToolDefinition[] = [
  /* ------------------------------------------------------------ read tools */
  {
    name: "search_leads",
    kind: "READ",
    scope: "leads:read",
    description:
      "Search this workspace's leads by name, email, phone or status. Returns at most 50.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text to match against name, email or phone." },
        status: { type: "string", description: "Optional lead status filter." },
        limit: { type: "number", description: "Maximum results, 1-50." },
      },
    },
    minimumRole: "viewer",
  },
  {
    name: "get_lead",
    kind: "READ",
    scope: "leads:read",
    description: "Read one lead, including its qualification state and recent activity.",
    inputSchema: {
      type: "object",
      properties: { leadId: { type: "string", description: "The lead's id." } },
      required: ["leadId"],
    },
    minimumRole: "viewer",
  },
  {
    name: "search_prospects",
    kind: "READ",
    scope: "prospects:read",
    description:
      "Search sourced prospects by grade, status or free text. Prospects are not leads and have not consented to contact.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text to match." },
        grade: { type: "string", description: "Minimum grade: A+, A, B, C or D." },
        limit: { type: "number", description: "Maximum results, 1-50." },
      },
    },
    minimumRole: "viewer",
  },
  {
    name: "get_prospect",
    kind: "READ",
    scope: "prospects:read",
    description:
      "Read one prospect, including its explainable score factors and contactability state.",
    inputSchema: {
      type: "object",
      properties: { prospectId: { type: "string", description: "The prospect's id." } },
      required: ["prospectId"],
    },
    minimumRole: "viewer",
  },
  {
    name: "get_business_profile",
    kind: "READ",
    scope: "business:read",
    description:
      "Read what ClientTurn knows about this business: services, ICPs and conversion goals.",
    inputSchema: noArgs,
    minimumRole: "viewer",
  },
  {
    name: "list_campaigns",
    kind: "READ",
    scope: "campaigns:read",
    description: "List acquisition campaigns with their status and funnel counts.",
    inputSchema: noArgs,
    minimumRole: "viewer",
  },
  {
    name: "get_dashboard_metrics",
    kind: "READ",
    scope: "analytics:read",
    description: "Headline operational metrics for a period: leads, qualified, booked, won.",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "string", description: "One of 7d, 30d, 90d or 12m." },
      },
    },
    minimumRole: "viewer",
  },
  {
    name: "get_status",
    kind: "READ",
    scope: "business:read",
    description: "Whether this workspace's integrations, senders and background work are healthy.",
    inputSchema: noArgs,
    minimumRole: "viewer",
  },

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
  {
    name: "assign_lead",
    kind: "WRITE",
    scope: "leads:write",
    description: "Assign a lead to a member of the workspace, or unassign it.",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "The lead's id." },
        userId: { type: "string", description: "The member's id, or empty to unassign." },
      },
      required: ["leadId"],
    },
    minimumRole: "member",
  },
  {
    name: "update_lead_status",
    kind: "WRITE",
    scope: "leads:write",
    description: "Move a lead to a new status: QUALIFIED, BOOKED, WON or LOST.",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "The lead's id." },
        status: { type: "string", description: "The new status." },
      },
      required: ["leadId", "status"],
    },
    minimumRole: "member",
  },
  {
    name: "approve_prospect",
    kind: "WRITE",
    scope: "prospects:write",
    description:
      "Approve a prospect for outreach. Refused if the policy engine has not cleared it — approval is not an override.",
    inputSchema: {
      type: "object",
      properties: { prospectId: { type: "string", description: "The prospect's id." } },
      required: ["prospectId"],
    },
    minimumRole: "admin",
  },
  {
    name: "pause_campaign",
    kind: "WRITE",
    scope: "campaigns:write",
    description: "Pause a running acquisition campaign. Always permitted — stopping is safe.",
    inputSchema: {
      type: "object",
      properties: { campaignId: { type: "string", description: "The campaign's id." } },
      required: ["campaignId"],
    },
    minimumRole: "admin",
  },

  /* -------------------------------------------------- approval-gated tools */
  {
    name: "send_message",
    kind: "APPROVAL_GATED",
    scope: "leads:write",
    description:
      "Send a message to a lead. Parks for a person to approve; it is never sent by the assistant alone.",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "The lead's id." },
        channel: { type: "string", description: "email, sms or whatsapp." },
        body: { type: "string", description: "The message." },
      },
      required: ["leadId", "channel", "body"],
    },
    minimumRole: "member",
  },
  {
    name: "launch_campaign",
    kind: "APPROVAL_GATED",
    scope: "campaigns:write",
    description:
      "Launch an acquisition campaign. Parks for approval: launching starts real outbound contact.",
    inputSchema: {
      type: "object",
      properties: { campaignId: { type: "string", description: "The campaign's id." } },
      required: ["campaignId"],
    },
    minimumRole: "admin",
  },
  {
    name: "start_sourcing_run",
    kind: "APPROVAL_GATED",
    scope: "prospects:write",
    description:
      "Start a sourcing run against an approved search plan. Parks for approval: runs spend money.",
    inputSchema: {
      type: "object",
      properties: {
        strategyId: { type: "string", description: "An approved search plan's id." },
        target: { type: "number", description: "Verified prospects to aim for." },
      },
      required: ["strategyId"],
    },
    minimumRole: "admin",
  },
  {
    name: "change_overage_cap",
    kind: "APPROVAL_GATED",
    scope: "campaigns:write",
    description:
      "Change the workspace's additional-usage cap. Parks for approval: it changes what can be billed.",
    inputSchema: {
      type: "object",
      properties: {
        capMinor: { type: "number", description: "The new cap, in pence." },
      },
      required: ["capMinor"],
    },
    minimumRole: "admin",
  },
];

export function toolByName(name: string): ToolDefinition | null {
  return MCP_TOOLS.find((tool) => tool.name === name) ?? null;
}

export function toolsForScopes(scopes: string[]): ToolDefinition[] {
  const granted = new Set(scopes);
  return MCP_TOOLS.filter((tool) => granted.has(tool.scope));
}

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/**
 * Whether the authorising user's *current* role still permits this tool.
 *
 * Checked at call time, not just at grant time (§88.2): a token issued while
 * someone was an admin must stop working the moment they are demoted.
 */
export function roleAllows(userRole: string, tool: ToolDefinition): boolean {
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[tool.minimumRole] ?? 99);
}

export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  "leads:read": "Read your leads and their conversations",
  "leads:write": "Create and update leads",
  "prospects:read": "Read sourced prospects and their scores",
  "prospects:write": "Approve prospects and start sourcing",
  "campaigns:read": "Read campaign performance",
  "campaigns:write": "Change and launch campaigns",
  "analytics:read": "Read your metrics",
  "business:read": "Read your business profile and status",
};
