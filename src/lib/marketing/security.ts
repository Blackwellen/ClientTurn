/**
 * The security and data controls ClientTurn is allowed to describe in public.
 *
 * Every entry is a claim a buyer may rely on, so each one is tied to something
 * that exists in this repository today. A control that is not built is listed
 * with status `not_available` and rendered as such — it is never quietly
 * dropped, because a buyer who cannot find SSO on the page will assume it
 * exists rather than that we chose not to mention it.
 *
 * Certifications (SOC 2, ISO 27001, HIPAA) are deliberately absent: ClientTurn
 * holds none, and "designed to support" wording is not used as a stand-in for
 * an audit that has not happened.
 */

export type ControlStatus =
  /** Built, on by default, nothing for the customer to configure. */
  | "in_place"
  /** Built, but only applies where the customer or their contract turns it on. */
  | "configurable"
  /** Not a product feature — handled commercially, per agreement. */
  | "on_request"
  /** Genuinely not available today. Named so buyers can rule us in or out. */
  | "not_available";

export type SecurityControl = {
  id: string;
  group: "access" | "isolation" | "data" | "operations" | "governance";
  name: string;
  detail: string;
  status: ControlStatus;
};

export const STATUS_LABEL: Record<ControlStatus, string> = {
  in_place: "In place",
  configurable: "Where configured",
  on_request: "On request",
  not_available: "Not available today",
};

export const SECURITY_CONTROLS: SecurityControl[] = [
  {
    id: "rls",
    group: "isolation",
    name: "Row-level security on every tenant table",
    detail:
      "Each tenant table carries a business_id and is protected by Postgres row-level security, so one workspace's data is unreachable from another's session rather than merely un-requested by the interface.",
    status: "in_place",
  },
  {
    id: "workspace-isolation",
    group: "isolation",
    name: "Workspace separation",
    detail:
      "Leads, conversations, prospects, campaigns and reporting are scoped to a workspace. Members belong to a workspace explicitly; there is no cross-workspace read path in the application.",
    status: "in_place",
  },
  {
    id: "roles",
    group: "access",
    name: "Role-based access",
    detail:
      "Workspace members hold a ranked role, and privileged actions are checked server-side against that role — not hidden in the interface and left open in the API.",
    status: "in_place",
  },
  {
    id: "admin-step-up",
    group: "access",
    name: "Step-up verification for platform administration",
    detail:
      "Platform administration uses a separate login, a separate session check and a mandatory step-up challenge. The administrator role is read from the database server-side on every request.",
    status: "in_place",
  },
  {
    id: "workspace-mfa",
    group: "access",
    name: "Multi-factor authentication for workspace users",
    detail:
      "Not yet available for customer workspace sign-in. Step-up verification currently covers platform administration only. Tell us if MFA is a requirement for your rollout.",
    status: "not_available",
  },
  {
    id: "sso",
    group: "access",
    name: "SSO / SAML / SCIM",
    detail:
      "Not available today. Sign-in is email and password with email verification. If single sign-on is a procurement requirement, raise it with sales before you evaluate further.",
    status: "not_available",
  },
  {
    id: "audit",
    group: "operations",
    name: "Audit log",
    detail:
      "Configuration and lifecycle events — integrations connected or disconnected, qualification rules published, automations activated or paused, members invited or removed, campaigns launched or cancelled — are written to an append-only audit log against the acting user.",
    status: "in_place",
  },
  {
    id: "secrets",
    group: "data",
    name: "Server-only secrets and provider tokens",
    detail:
      "Service-role keys, provider tokens and API credentials are held server-side only. They are never placed in client bundles, public environment variables or response bodies.",
    status: "in_place",
  },
  {
    id: "signed-urls",
    group: "data",
    name: "Signed, short-lived file access",
    detail:
      "Uploaded logos and CSV imports are stored in Cloudflare R2 and reached only through short-lived signed URLs generated on the server for the requesting workspace.",
    status: "in_place",
  },
  {
    id: "encryption",
    group: "data",
    name: "Encryption in transit and at rest",
    detail:
      "All traffic is served over TLS. The application database and object storage are encrypted at rest by the underlying platforms (Supabase Postgres and Cloudflare R2).",
    status: "in_place",
  },
  {
    id: "regions",
    group: "data",
    name: "UK and EU processing",
    detail:
      "The application database runs in Supabase's eu-west-2 (London) region and AI assistance uses EU Azure OpenAI endpoints. We will walk through the full data-flow and sub-processor map with you rather than summarise it here.",
    status: "in_place",
  },
  {
    id: "ai-controls",
    group: "governance",
    name: "Bounded AI assistance",
    detail:
      "Qualification and follow-up decisions are deterministic and remain the system of record. AI may classify an inbound message or extract a value for a question you configured; it never composes a binding promise, quote, availability or service area. Low confidence routes to a human. Off by default, per workspace.",
    status: "configurable",
  },
  {
    id: "consent",
    group: "governance",
    name: "Consent, opt-out and suppression enforcement",
    detail:
      "Opt-outs, invalid contacts, complaints and quiet hours are re-checked immediately before every send, including reactivation and outbound campaigns. There is no bypass.",
    status: "in_place",
  },
  {
    id: "payments",
    group: "data",
    name: "Payment details never touch ClientTurn",
    detail:
      "Billing runs through Stripe Checkout and the Stripe customer portal. Card details are entered on Stripe's own pages; ClientTurn stores a customer reference, not a card.",
    status: "in_place",
  },
  {
    id: "subprocessors",
    group: "governance",
    name: "Published sub-processor list",
    detail:
      "The third parties that process customer data on our behalf are listed publicly and kept current.",
    status: "in_place",
  },
  {
    id: "dpa",
    group: "governance",
    name: "Data processing agreement",
    detail:
      "A DPA is available as part of an Enterprise agreement. Send us your paper and we will review it, or use ours.",
    status: "on_request",
  },
  {
    id: "certifications",
    group: "governance",
    name: "SOC 2 / ISO 27001 certification",
    detail:
      "ClientTurn holds neither today, and we will not imply otherwise. If a certification is a hard requirement for your procurement process, tell us early so nobody wastes time.",
    status: "not_available",
  },
];

export function controlsByGroup(group: SecurityControl["group"]) {
  return SECURITY_CONTROLS.filter((control) => control.group === group);
}

/** Anything we cannot honestly claim, surfaced together rather than buried. */
export function unavailableControls() {
  return SECURITY_CONTROLS.filter((c) => c.status === "not_available");
}
