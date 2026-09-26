import { z } from "zod";
import {
  ApiError,
  apiSuccess,
  parseLimit,
  serviceFailureToApiError,
  withApiKey,
} from "@/lib/api/public";
import { runOperation } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/leads` — search this workspace's leads.
 *
 * The route does no querying of its own. It translates a query string into the
 * arguments of `lead.search` and hands them to the service layer, which is the
 * one implementation the app, Copilot, the agent and MCP all use. That is the
 * whole point: an API that read the `leads` table directly would be a second
 * definition of what a lead is and who may see one, and the two would drift.
 *
 * It also means everything the service layer does — the workspace scoping, the
 * archived-lead exclusion, the audit trail — applies here without this file
 * having to remember any of it.
 */
export const GET = withApiKey({ scope: "leads:read" }, async (request, context) => {
  const url = new URL(request.url);

  const status = url.searchParams.get("status");
  const query = url.searchParams.get("query");
  const needsAttention = url.searchParams.get("needs_attention");

  const result = await runOperation<{ leads: unknown[]; count: number }>(
    "lead.search",
    {
      ...(query ? { query } : {}),
      ...(status ? { status: status.toUpperCase() } : {}),
      ...(needsAttention !== null
        ? { needsAttention: needsAttention === "true" }
        : {}),
      // The service caps this at 50 itself; bounding here too means an absurd
      // value is refused as a bad request rather than silently clamped.
      limit: parseLimit(url.searchParams.get("limit"), 25, 50),
    },
    {
      businessId: context.businessId,
      userId: context.userId,
      role: context.userRole,
      caller: "API",
      correlationId: context.requestId,
    },
  );

  if (!result.success) throw serviceFailureToApiError(result);

  return apiSuccess({
    data: result.data.leads,
    count: result.data.count,
  });
});

/**
 * `POST /api/v1/leads` — record an inbound lead (design 03 §1).
 *
 * Runs `lead.create`, which is ingestLead(): the same intake path the ad
 * pollers, the wizard and MCP use, so deduplication, suppression, the
 * permission record and attribution all apply. Requires `leads:write`, a
 * member's authority, and an `Idempotency-Key` header: a retried request with
 * the same key returns the first outcome (`DUPLICATE`, with
 * `original_outcome`) and creates nothing.
 *
 * Status codes follow the outcome contract:
 *   201 CREATED · 200 MERGED, DUPLICATE, SUPPRESSED, REVIEW
 *   422 INVALID (nothing usable arrived) · 409 REJECTED (nothing stored)
 */
const OUTCOME_STATUS: Record<string, number> = {
  CREATED: 201,
  MERGED: 200,
  DUPLICATE: 200,
  SUPPRESSED: 200,
  REVIEW: 200,
  INVALID: 422,
  REJECTED: 409,
};

const idempotencyKey = z
  .string()
  .trim()
  .min(8, "Idempotency-Key must be at least 8 characters")
  .max(200)
  .regex(/^[!-~]+$/, "Idempotency-Key must be printable ASCII without spaces");

export const POST = withApiKey(
  { scope: "leads:write", minimumRole: "member" },
  async (request, context) => {
    const key = idempotencyKey.safeParse(request.headers.get("idempotency-key") ?? "");
    if (!key.success) {
      throw new ApiError(
        "invalid_request",
        "An Idempotency-Key header is required, so a retried request never creates a second lead.",
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("invalid_request", "The request body must be JSON.");
    }

    const result = await runOperation<{ outcome: string; lead_id: string | null }>(
      "lead.create",
      body,
      {
        businessId: context.businessId,
        userId: context.userId,
        role: context.userRole,
        caller: "API",
        correlationId: context.requestId,
        idempotencyKey: key.data,
      },
    );

    if (!result.success) throw serviceFailureToApiError(result);

    return apiSuccess(
      { data: result.data },
      { status: OUTCOME_STATUS[result.data.outcome] ?? 200 },
    );
  },
);
