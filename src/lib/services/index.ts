import "server-only";

/**
 * The service layer's entry point.
 *
 * Importing this module registers every operation implementation. Callers —
 * server actions, Copilot, the agent runtime, the MCP gateway — import from
 * here rather than reaching into `operations/`, so there is no way to reach a
 * handler without the runtime that checks permission, validates input, demands
 * confirmation, audits and meters around it.
 *
 * Registration is a side effect of the import, which is why the operation
 * modules are imported for effect and not for their exports: they have none.
 */

import "./operations/leads";
import "./operations/agents";
import "./operations/workspace";

export { runOperation, ServiceError, hasHandler, implementedOperations } from "./runtime";
export {
  SERVICE_OPERATIONS,
  serviceOperation,
  operationsForCaller,
  operationsForScopes,
  operationsInDomain,
  declaredScopes,
  registryProblems,
  type RegisteredOperation,
  type ServiceOperationName,
} from "./registry";
export type {
  BillingEffect,
  BusinessRoleName,
  CallerKind,
  RiskClass,
  ServiceContext,
  ServiceDeclaration,
  ServiceErrorCode,
  ServiceFailure,
  ServiceResult,
  ServiceSuccess,
  ServiceWarning,
} from "./types";
export { requiresConfirmation, isWrite, roleMeets, isRetryable } from "./types";
