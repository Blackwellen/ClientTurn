/**
 * The core service layer's contract (Programme §2, §21 step 1).
 *
 * Pure — no `server-only`, no Supabase — so the envelope, the risk model and
 * the registry can be asserted in tests and rendered in the UI without a
 * database, the same way `policy/types.ts` and `usage-metrics.ts` already are.
 *
 * ## Why this exists
 *
 * Before this, the same operation was implemented three times: once in
 * `copilot/tool-service.ts`, once in `mcp/handlers.ts`, once in `agent/tools.ts`.
 * Three implementations of "update a lead" means three permission checks, three
 * audit shapes, and three chances for one of them to drift. The acceptance test
 * the programme sets — UI, Copilot, an agent and an MCP client all producing
 * identical database state, billing events, permission decisions and audit
 * history — is only achievable if there is exactly one implementation for all
 * four to call.
 *
 * ## What a caller gets back
 *
 * `ServiceResult` deliberately reports more than "it worked". A caller that can
 * only say "I've updated that lead" has to be trusted; a caller holding the
 * before and after values, the audit id, the policy verdict and the billing
 * effect can *show* what happened. That is the difference between an assistant
 * that narrates and one that reports.
 */

/* ------------------------------------------------------------- risk model */

/**
 * How much a caller must do before an operation may run.
 *
 * The ordering is meaningful: everything from `EXTERNAL` down needs explicit
 * permission from a person, and no caller — model, agent or MCP client — can
 * grant it to itself.
 */
export type RiskClass =
  /** Read-only. Runs immediately. */
  | "READ"
  /** A write nothing depends on: a note, a tag. Runs immediately. */
  | "SAFE_WRITE"
  /** A write that changes state but can be put back. Runs immediately, audited. */
  | "REVERSIBLE_WRITE"
  /** Leaves the building: one email, one SMS. Needs explicit permission. */
  | "EXTERNAL"
  /** Many external actions at once. Needs a preview and a confirmation. */
  | "BULK_EXTERNAL"
  /** Spends money. Needs explicit confirmation. */
  | "FINANCIAL"
  /** Cannot be undone. Needs explicit confirmation. */
  | "DESTRUCTIVE"
  /** Overriding a safety rule. Refused unless the workspace has opted in. */
  | "RESTRICTED";

const RISK_ORDER: RiskClass[] = [
  "READ",
  "SAFE_WRITE",
  "REVERSIBLE_WRITE",
  "EXTERNAL",
  "BULK_EXTERNAL",
  "FINANCIAL",
  "DESTRUCTIVE",
  "RESTRICTED",
];

/** Risk classes that never execute without a human saying yes on this request. */
const NEEDS_CONFIRMATION = new Set<RiskClass>([
  "EXTERNAL",
  "BULK_EXTERNAL",
  "FINANCIAL",
  "DESTRUCTIVE",
  "RESTRICTED",
]);

export function requiresConfirmation(risk: RiskClass): boolean {
  return NEEDS_CONFIRMATION.has(risk);
}

export function isWrite(risk: RiskClass): boolean {
  return risk !== "READ";
}

export function riskRank(risk: RiskClass): number {
  return RISK_ORDER.indexOf(risk);
}

/* ------------------------------------------------------------- the caller */

/**
 * Who is asking. Recorded on every audit row, because "a lead was archived" and
 * "a lead was archived by an MCP client acting for Priya" are different facts.
 */
/**
 * Who is asking.
 *
 * `API` is a customer's own software, holding a workspace API key. It is
 * distinct from `MCP` because the two have different confirmation stories: an
 * MCP client parks a risky action for a human, whereas an API caller is a
 * program the customer wrote and can be told plainly that an operation needs a
 * person and refused. Neither may ever set `confirmed`.
 */
export type CallerKind = "UI" | "COPILOT" | "AGENT" | "MCP" | "API" | "SYSTEM";

export type ServiceContext = {
  businessId: string;
  /** The person on whose authority this runs. Null only for `SYSTEM`. */
  userId: string | null;
  /** Their live workspace role. Re-read per call, never carried in a token. */
  role: BusinessRoleName;
  caller: CallerKind;
  /**
   * Set when a person confirmed *this* request. A caller cannot set it on its
   * own behalf: the UI sets it from a dialog, MCP from an approval row, and an
   * agent can never set it at all.
   */
  confirmed?: boolean;
  /** Correlates every row this call writes — audit, usage, policy. */
  correlationId: string;
  /** Makes a retried call idempotent where the operation supports it. */
  idempotencyKey?: string;
};

export type BusinessRoleName = "owner" | "admin" | "member" | "viewer";

const ROLE_RANK: Record<BusinessRoleName, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function roleMeets(role: string, minimum: BusinessRoleName): boolean {
  return (ROLE_RANK[role as BusinessRoleName] ?? -1) >= ROLE_RANK[minimum];
}

/* ---------------------------------------------------------- the envelope */

/** Why an operation refused. Machine codes; the UI maps them to sentences. */
export type ServiceErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN_ROLE"
  | "FORBIDDEN_SCOPE"
  | "FORBIDDEN_WORKSPACE"
  | "INVALID_INPUT"
  | "NEEDS_CONFIRMATION"
  | "PLAN_LIMIT"
  | "POLICY_BLOCKED"
  | "CONFLICT"
  | "PROVIDER_FAILED"
  | "UNAVAILABLE";

/** Codes where retrying the identical call could succeed. */
const RETRYABLE = new Set<ServiceErrorCode>(["PROVIDER_FAILED", "UNAVAILABLE"]);

export function isRetryable(code: ServiceErrorCode): boolean {
  return RETRYABLE.has(code);
}

/** A change the caller should mention even though the operation succeeded. */
export type ServiceWarning = {
  code: string;
  message: string;
};

/** What this operation cost, so a caller can say so rather than discover it later. */
export type BillingEffect = {
  metric: string;
  quantity: number;
  /** True when the charge was skipped because the operation was a repeat. */
  deduplicated?: boolean;
};

export type ServiceSuccess<T> = {
  success: true;
  operation: string;
  /** The record acted on, where the operation acts on one. */
  entityId: string | null;
  entityType: string | null;
  /** The record as it was. Null for a create or a read. */
  before: Record<string, unknown> | null;
  /** The record as it now is. Null for a delete or a read. */
  after: Record<string, unknown> | null;
  /** The row in `audit_log`, so a claim can be checked against the trail. */
  auditEventId: string | null;
  warnings: ServiceWarning[];
  billingEffect: BillingEffect[];
  /** The contactability verdict, when the operation consulted one. */
  policyResult: { outcome: string; reasonCode: string; message: string } | null;
  correlationId: string;
  /** The operation's own payload. */
  data: T;
};

export type ServiceFailure = {
  success: false;
  operation: string;
  code: ServiceErrorCode;
  /** Safe to show a person. Never names internal infrastructure. */
  message: string;
  /** Set on NEEDS_CONFIRMATION: what the caller must warn about first. */
  effect?: string;
  warnings: ServiceWarning[];
  correlationId: string;
};

export type ServiceResult<T = unknown> = ServiceSuccess<T> | ServiceFailure;

/* -------------------------------------------------------- the declaration */

/**
 * What an operation is, independent of how it is implemented.
 *
 * Declarations are pure data so the same list can drive the Copilot tool
 * catalogue, the MCP tool catalogue and the agent's permitted-tool set. A
 * capability that is not declared here does not exist for any of them.
 */
export type ServiceDeclaration = {
  /** `<domain>.<verb>`, e.g. `lead.update`. Also the audit action. */
  name: string;
  domain: string;
  risk: RiskClass;
  /** Minimum workspace role. Re-checked at execution, never only in the UI. */
  minimumRole: BusinessRoleName;
  /** The MCP scope that admits this operation. */
  scope: string;
  /** One line, shown in a confirmation dialog and in tool catalogues. */
  summary: string;
  /** What a person is agreeing to. Required for anything needing confirmation. */
  effect?: string;
  /** The table a result's `entityId` refers to. */
  entityType: string | null;
  /**
   * Callers permitted to invoke it. Absent means all of them.
   *
   * `readonly` so the catalogue can be declared `as const` — which is what lets
   * operation names be a literal union, and therefore what lets the audit
   * vocabulary stay strict.
   */
  callers?: readonly CallerKind[];
};

export function callerAllowed(
  declaration: ServiceDeclaration,
  caller: CallerKind,
): boolean {
  return !declaration.callers || declaration.callers.includes(caller);
}

/**
 * A declaration is well formed when its risk class and its stated effect agree.
 * An operation that needs a person's confirmation but cannot say what they are
 * confirming is a dialog with an empty body, so it is rejected at load time
 * rather than shipped.
 */
export function declarationProblems(declaration: ServiceDeclaration): string[] {
  const problems: string[] = [];

  if (!declaration.name.includes(".")) {
    problems.push(`${declaration.name}: name must be <domain>.<verb>`);
  }
  if (!declaration.name.startsWith(`${declaration.domain}.`)) {
    problems.push(`${declaration.name}: name does not match domain "${declaration.domain}"`);
  }
  if (requiresConfirmation(declaration.risk) && !declaration.effect) {
    problems.push(`${declaration.name}: ${declaration.risk} needs an "effect" to confirm`);
  }
  if (declaration.risk === "READ" && declaration.minimumRole === "owner") {
    problems.push(`${declaration.name}: a read restricted to owners is almost certainly a mistake`);
  }
  if (isWrite(declaration.risk) && declaration.minimumRole === "viewer") {
    problems.push(`${declaration.name}: a viewer must not be able to write`);
  }
  return problems;
}
