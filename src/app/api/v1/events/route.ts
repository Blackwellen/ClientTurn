import { createAdminClient } from "@/lib/supabase/admin";
import { apiSuccess, parseLimit, withApiKey } from "@/lib/api/public";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/events` — recent webhook deliveries for this workspace.
 *
 * The endpoint a developer reaches for when a webhook did not arrive, so it
 * answers the question they actually have: was it sent, what did my server say,
 * and will it be tried again. Polling this is also a legitimate fallback for a
 * system that cannot expose an inbound endpoint at all.
 *
 * The signing secret and the endpoint URL are both withheld. The URL belongs to
 * the workspace's configuration, not to whatever holds this key.
 */
export const GET = withApiKey({ scope: "business:read" }, async (request, context) => {
  const url = new URL(request.url);
  const db = createAdminClient();

  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");

  let query = db
    .from("webhook_deliveries")
    .select(
      "id, event_id, event_type, status, attempts, response_status, next_attempt_at, delivered_at, created_at, payload",
    )
    .eq("business_id", context.businessId)
    .order("created_at", { ascending: false })
    .limit(parseLimit(url.searchParams.get("limit"), 25, 100));

  if (type) query = query.eq("event_type", type);
  if (status) query = query.eq("status", status.toUpperCase());

  const { data } = await query;

  return apiSuccess({
    data: (data ?? []).map((row) => ({
      id: row.id,
      event_id: row.event_id,
      type: row.event_type,
      status: row.status,
      attempts: row.attempts,
      response_status: row.response_status,
      next_attempt_at: row.next_attempt_at,
      delivered_at: row.delivered_at,
      created_at: row.created_at,
      payload: row.payload,
    })),
  });
});
