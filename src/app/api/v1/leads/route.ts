import { randomUUID } from "node:crypto";
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
 * `POST /api/v1/leads` is deliberately absent.
 *
 * Creating a lead means deduplication, capturing a contactability record, and
 * starting follow-up. `lead.create` is not in the service registry precisely
 * because a thinner version that skipped those would be worse than none — so
 * there is nothing here to expose, and saying so is more useful than a 405 with
 * no explanation.
 */
export async function POST() {
  const error = new ApiError(
    "invalid_request",
    "Leads cannot be created through the API yet. Use a lead source integration or the Add Lead form, both of which run deduplication and start follow-up.",
  );
  return Response.json(
    { error: { code: error.code, message: error.message, request_id: randomUUID() } },
    { status: 400 },
  );
}
