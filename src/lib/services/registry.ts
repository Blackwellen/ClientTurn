/**
 * The service operation catalogue (Programme §2, §21 step 1).
 *
 * Pure data. This is the one list of things ClientTurn can be asked to do, and
 * every caller — the UI, Copilot, an autonomous agent, an MCP client — reads it
 * rather than keeping a list of its own. A capability absent from here does not
 * exist for any of them, which is why the tool surfaces cannot drift apart.
 *
 * Deliberately absent, and not by oversight: there is no SQL operation, no HTTP
 * operation, and no "run arbitrary action". Those are outside the layer's
 * authority entirely, so there is no argument shape that could express them.
 */

import {
  callerAllowed,
  declarationProblems,
  type CallerKind,
  type ServiceDeclaration,
} from "./types.ts";

export const SERVICE_OPERATIONS = [
  /* -------------------------------------------------------------- leads
   *
   * `lead.create` is deliberately absent. Creating a lead means deduplication,
   * capturing a relationship for the contactability engine, and starting
   * follow-up — the Add Lead wizard does all three, and declaring a thinner
   * version here would offer callers a capability that quietly skips them.
   * It joins the catalogue when it is ported whole.
   */
  {
    name: "lead.get",
    domain: "lead",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Read one lead and its recent activity",
    entityType: "lead",
  },
  {
    name: "lead.search",
    domain: "lead",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Find leads matching a description",
    entityType: "lead",
  },
  {
    name: "lead.update",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Change a lead's details",
    entityType: "lead",
  },
  {
    name: "lead.assign",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Assign a lead to someone",
    entityType: "lead",
  },
  {
    name: "lead.set_status",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Move a lead to a different status",
    entityType: "lead",
  },
  {
    name: "lead.add_note",
    domain: "lead",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Add a note to a lead",
    entityType: "lead",
  },
  {
    name: "lead.flag_attention",
    domain: "lead",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Flag a lead for attention",
    entityType: "lead",
  },
  {
    name: "lead.archive",
    domain: "lead",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Archive a lead",
    effect:
      "The lead stops appearing in your lists and all follow-up for it stops. Its history is kept and an admin can restore it.",
    entityType: "lead",
    // An autonomous agent does not get to decide a lead is finished with.
    callers: ["UI", "COPILOT", "MCP"],
  },
  {
    name: "lead.restore",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Restore an archived lead",
    entityType: "lead",
    callers: ["UI", "COPILOT", "MCP"],
  },
] as const satisfies readonly ServiceDeclaration[];

/**
 * Every operation name, as a literal union.
 *
 * This is what lets the audit vocabulary stay strict: `audit_log.action` accepts
 * an operation name only because the compiler can prove it is one of these, so
 * a typo becomes a build failure rather than an audit row nobody can search for.
 */
export type ServiceOperationName = (typeof SERVICE_OPERATIONS)[number]["name"];

/**
 * A declaration known to be in the catalogue. Its `name` is the literal union
 * rather than `string`, so anything derived from it — most importantly the
 * audit action — stays checkable by the compiler.
 */
export type RegisteredOperation = ServiceDeclaration & { name: ServiceOperationName };

/**
 * The catalogue as a plain list.
 *
 * `SERVICE_OPERATIONS` is declared `as const` so operation names form a literal
 * union — which is what keeps the audit vocabulary checkable. The cost is that
 * iterating it yields nine unrelated literal shapes rather than one type, so
 * anything that walks the catalogue uses this widened view instead.
 */
export const ALL_OPERATIONS: readonly RegisteredOperation[] = SERVICE_OPERATIONS;

/* ------------------------------------------------------------- accessors */

const BY_NAME = new Map<string, RegisteredOperation>(
  SERVICE_OPERATIONS.map((op) => [op.name, op]),
);

export function serviceOperation(name: string): RegisteredOperation | undefined {
  return BY_NAME.get(name);
}

export function operationsForScopes(scopes: string[]): RegisteredOperation[] {
  const granted = new Set(scopes);
  return SERVICE_OPERATIONS.filter((op) => granted.has(op.scope));
}

export function operationsForCaller(caller: CallerKind): RegisteredOperation[] {
  return SERVICE_OPERATIONS.filter((op) => callerAllowed(op, caller));
}

export function operationsInDomain(domain: string): RegisteredOperation[] {
  return SERVICE_OPERATIONS.filter((op) => op.domain === domain);
}

/** Every scope the catalogue actually uses. The MCP scope list is derived from
 *  this rather than maintained beside it. */
export function declaredScopes(): string[] {
  return [...new Set(SERVICE_OPERATIONS.map((op) => op.scope))].sort();
}

/**
 * Structural problems across the whole catalogue. Asserted by a test rather
 * than thrown at import: a malformed declaration should fail the build, not a
 * customer's request.
 */
export function registryProblems(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const declaration of SERVICE_OPERATIONS) {
    if (seen.has(declaration.name)) {
      problems.push(`${declaration.name}: declared more than once`);
    }
    seen.add(declaration.name);
    problems.push(...declarationProblems(declaration));
  }

  return problems;
}
