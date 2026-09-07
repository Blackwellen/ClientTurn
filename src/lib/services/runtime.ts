import "server-only";
import { z } from "zod";
import { recordAudit, recordUsage } from "@/lib/audit";
import type { UsageFeature, UsageMetric } from "@/lib/billing/usage-metrics";
import { serviceOperation, type RegisteredOperation } from "./registry";
import {
  callerAllowed,
  isWrite,
  requiresConfirmation,
  roleMeets,
  type BillingEffect,
  type ServiceContext,
  type ServiceErrorCode,
  type ServiceResult,
  type ServiceWarning,
} from "./types";

/**
 * The service runtime (Programme §2, §21 step 1).
 *
 * Every operation runs through `runOperation`, in a fixed order:
 *
 *   1. **Does the operation exist**, and may this kind of caller invoke it?
 *   2. **Does the acting user hold the role?** Re-read per call by the caller
 *      and passed in, never trusted from a token issued earlier.
 *   3. **Does the input parse?** A handler never sees an unvalidated argument.
 *   4. **Has a person confirmed**, where the risk class demands one? A caller
 *      cannot confirm on its own behalf.
 *   5. **Execute**, with the before-state already captured.
 *   6. **Audit**, and return the audit row's id in the envelope.
 *   7. **Meter**, once, keyed so a retry does not charge twice.
 *
 * A handler that throws produces a failure envelope, never a leaked stack: the
 * message may name internal infrastructure, and no caller — least of all a
 * model that will repeat it to a customer — needs it.
 */

/* --------------------------------------------------------------- handlers */

/** What a handler is handed. The declaration and context are already checked. */
export type HandlerInput<A> = {
  args: A;
  context: ServiceContext;
  declaration: RegisteredOperation;
};

/**
 * What a handler returns. Deliberately not the envelope: a handler states facts
 * about its own domain, and the runtime is what turns those into the envelope.
 * That way a handler cannot forge an audit id or claim a policy verdict it
 * never obtained.
 */
export type HandlerOutcome<T> = {
  data: T;
  entityId?: string | null;
  /** Captured by the handler *before* it wrote. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  warnings?: ServiceWarning[];
  /** Charges to post. The runtime writes them, so they cannot be double-posted. */
  billing?: { metric: UsageMetric; quantity?: number; feature: UsageFeature }[];
  policyResult?: { outcome: string; reasonCode: string; message: string } | null;
};

/** A refusal a handler raises deliberately, as opposed to an unexpected throw. */
export class ServiceError extends Error {
  // Declared as fields rather than constructor parameter properties: the test
  // runner strips types without transforming them, and a parameter property is
  // a transform. Keeping this plain means the end-to-end tests exercise the
  // same file that ships rather than a compiled variant of it.
  readonly code: ServiceErrorCode;
  readonly warnings: ServiceWarning[];

  constructor(
    code: ServiceErrorCode,
    message: string,
    warnings: ServiceWarning[] = [],
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.warnings = warnings;
  }
}

export type ServiceHandler<A, T> = {
  schema: z.ZodType<A>;
  run(input: HandlerInput<A>): Promise<HandlerOutcome<T>>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HANDLERS = new Map<string, ServiceHandler<any, any>>();

/**
 * Registers the implementation of a declared operation.
 *
 * Registering something the catalogue does not declare is refused: a capability
 * reachable in code but absent from the catalogue would be invisible to the
 * permission model, the tool surfaces and the audit vocabulary all at once.
 */
export function defineOperation<A, T>(
  name: string,
  handler: ServiceHandler<A, T>,
): void {
  if (!serviceOperation(name)) {
    throw new Error(`Cannot implement "${name}": it is not in the service registry.`);
  }
  HANDLERS.set(name, handler);
}

export function hasHandler(name: string): boolean {
  return HANDLERS.has(name);
}

export function implementedOperations(): string[] {
  return [...HANDLERS.keys()].sort();
}

/**
 * The argument schema of an implemented operation.
 *
 * Exposed so the MCP gateway can publish a JSON Schema derived from the very
 * validator the arguments will be checked against, rather than a second
 * description of it that can drift.
 */
export function handlerSchema(name: string): z.ZodType | null {
  return HANDLERS.get(name)?.schema ?? null;
}

/* ---------------------------------------------------------------- results */

function fail(
  operation: string,
  context: ServiceContext,
  code: ServiceErrorCode,
  message: string,
  extra: { effect?: string; warnings?: ServiceWarning[] } = {},
): ServiceResult<never> {
  return {
    success: false,
    operation,
    code,
    message,
    effect: extra.effect,
    warnings: extra.warnings ?? [],
    correlationId: context.correlationId,
  };
}

/* --------------------------------------------------------------- execution */

export async function runOperation<T = unknown>(
  name: string,
  rawArgs: unknown,
  context: ServiceContext,
): Promise<ServiceResult<T>> {
  const declaration = serviceOperation(name);

  // An unknown operation is not an error to explain away — it is a request for
  // something that does not exist, and is refused without being recorded as a
  // real action against a real object.
  if (!declaration) {
    return fail(name, context, "NOT_FOUND", "That action is not available.");
  }

  if (!callerAllowed(declaration, context.caller)) {
    return fail(
      name,
      context,
      "FORBIDDEN_SCOPE",
      "That action is not available from here.",
    );
  }

  const handler = HANDLERS.get(name);
  if (!handler) {
    return fail(name, context, "UNAVAILABLE", "That action is not available yet.");
  }

  /* ------------------------------------------------------------ 2. role */

  if (!roleMeets(context.role, declaration.minimumRole)) {
    await auditDenial(declaration, context, "insufficient_role");
    return fail(
      name,
      context,
      "FORBIDDEN_ROLE",
      `You do not have permission to ${declaration.summary.toLowerCase()}.`,
    );
  }

  /* ----------------------------------------------------------- 3. input */

  const parsed = handler.schema.safeParse(rawArgs);
  if (!parsed.success) {
    return fail(
      name,
      context,
      "INVALID_INPUT",
      firstIssue(parsed.error) ?? "Some of those details were not valid.",
    );
  }

  /* ---------------------------------------------------- 4. confirmation */

  // Checked before the handler is reached, so an unconfirmed high-impact
  // request never touches the domain at all. An agent has no way to set
  // `confirmed`, which is why it cannot talk itself into a destructive call.
  if (requiresConfirmation(declaration.risk) && !context.confirmed) {
    return fail(
      name,
      context,
      "NEEDS_CONFIRMATION",
      declaration.effect ?? "This action needs your confirmation.",
      { effect: declaration.effect },
    );
  }

  /* --------------------------------------------------------- 5. execute */

  let outcome: HandlerOutcome<T>;
  try {
    outcome = await handler.run({
      args: parsed.data,
      context,
      declaration,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      await auditDenial(declaration, context, error.code);
      return fail(name, context, error.code, error.message, {
        warnings: error.warnings,
      });
    }

    // Deliberately opaque. The underlying message may name infrastructure, and
    // it would otherwise reach a customer through a model's summary of it.
    console.error(`service ${name} failed`, {
      businessId: context.businessId,
      correlationId: context.correlationId,
      error,
    });
    return fail(name, context, "UNAVAILABLE", "That action could not be completed.");
  }

  /* ----------------------------------------------------------- 6. audit */

  const auditEventId = isWrite(declaration.risk)
    ? await recordAudit({
        businessId: context.businessId,
        actorUserId: context.userId,
        actorType: context.caller === "SYSTEM" ? "system" : "user",
        action: declaration.name,
        entityType: declaration.entityType ?? undefined,
        entityId: outcome.entityId ?? null,
        metadata: {
          caller: context.caller,
          risk: declaration.risk,
          correlation_id: context.correlationId,
          confirmed: Boolean(context.confirmed),
          before: outcome.before ?? null,
          after: outcome.after ?? null,
        },
      })
    : null;

  /* ----------------------------------------------------------- 7. meter */

  const billingEffect: BillingEffect[] = [];
  for (const charge of outcome.billing ?? []) {
    const operationId = context.idempotencyKey
      ? `${declaration.name}:${charge.metric}:${context.idempotencyKey}`
      : undefined;

    await recordUsage({
      businessId: context.businessId,
      metric: charge.metric,
      quantity: charge.quantity ?? 1,
      source: `service:${declaration.name}`,
      feature: charge.feature,
      ...(outcome.entityId && declaration.entityType
        ? { entity: { type: declaration.entityType, id: outcome.entityId } }
        : {}),
      ...(operationId ? { operationId } : {}),
      metadata: { caller: context.caller, correlation_id: context.correlationId },
    });

    billingEffect.push({
      metric: charge.metric,
      quantity: charge.quantity ?? 1,
      deduplicated: false,
    });
  }

  return {
    success: true,
    operation: declaration.name,
    entityId: outcome.entityId ?? null,
    entityType: declaration.entityType,
    before: outcome.before ?? null,
    after: outcome.after ?? null,
    auditEventId,
    warnings: outcome.warnings ?? [],
    billingEffect,
    policyResult: outcome.policyResult ?? null,
    correlationId: context.correlationId,
    data: outcome.data,
  };
}

/* ---------------------------------------------------------------- helpers */

/**
 * A refused write is audited as deliberately as a successful one. "Nothing
 * happened" and "someone tried and was stopped" are different facts, and only
 * the second one tells you a permission model is being probed.
 */
async function auditDenial(
  declaration: RegisteredOperation,
  context: ServiceContext,
  reason: string,
): Promise<void> {
  if (!isWrite(declaration.risk)) return;
  await recordAudit({
    businessId: context.businessId,
    actorUserId: context.userId,
    actorType: context.caller === "SYSTEM" ? "system" : "user",
    action: `${declaration.name}.denied`,
    entityType: declaration.entityType ?? undefined,
    metadata: {
      caller: context.caller,
      reason,
      role: context.role,
      correlation_id: context.correlationId,
    },
  });
}

function firstIssue(error: z.ZodError): string | null {
  const issue = error.issues[0];
  if (!issue) return null;
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}
