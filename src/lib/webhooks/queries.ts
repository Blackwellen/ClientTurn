import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/session";
import type {
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
} from "./events";

/**
 * What Settings → Developer shows about webhooks.
 *
 * `secret_sealed` is never selected. The UI proves which secret is in force
 * with `secret_hint` — the last six characters — which is enough for a customer
 * to match it against their own configuration and useless to anyone else.
 */

export type WebhookEndpointView = {
  id: string;
  url: string;
  description: string | null;
  secretHint: string;
  events: string[];
  status: WebhookEndpointStatus;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Deliveries in the last 7 days, so a quiet endpoint reads as quiet. */
  recentDelivered: number;
  recentFailed: number;
};

export type WebhookDeliveryView = {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventType: string;
  eventId: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function listWebhookEndpoints(): Promise<WebhookEndpointView[]> {
  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { data: endpoints } = await db
    .from("webhook_endpoints")
    .select(
      "id, url, description, secret_hint, events, status, disabled_reason, consecutive_failures, last_success_at, last_failure_at, last_error, created_at",
    )
    .eq("business_id", workspace.businessId)
    .order("created_at", { ascending: false });

  if (!endpoints?.length) return [];

  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const { data: deliveries } = await db
    .from("webhook_deliveries")
    .select("endpoint_id, status")
    .in(
      "endpoint_id",
      endpoints.map((endpoint) => endpoint.id),
    )
    .gte("created_at", since);

  const delivered = new Map<string, number>();
  const failed = new Map<string, number>();
  for (const row of deliveries ?? []) {
    if (row.status === "SUCCEEDED") {
      delivered.set(row.endpoint_id, (delivered.get(row.endpoint_id) ?? 0) + 1);
    } else if (row.status === "EXHAUSTED" || row.status === "FAILED") {
      failed.set(row.endpoint_id, (failed.get(row.endpoint_id) ?? 0) + 1);
    }
  }

  return endpoints.map((endpoint) => ({
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    secretHint: endpoint.secret_hint,
    events: Array.isArray(endpoint.events) ? endpoint.events : [],
    status: endpoint.status as WebhookEndpointStatus,
    disabledReason: endpoint.disabled_reason,
    consecutiveFailures: endpoint.consecutive_failures,
    lastSuccessAt: endpoint.last_success_at,
    lastFailureAt: endpoint.last_failure_at,
    lastError: endpoint.last_error,
    createdAt: endpoint.created_at,
    recentDelivered: delivered.get(endpoint.id) ?? 0,
    recentFailed: failed.get(endpoint.id) ?? 0,
  }));
}

/**
 * The most recent delivery attempts across every endpoint.
 *
 * Failures are as visible as successes, in one list ordered by time — a
 * customer debugging a webhook wants to see what happened, in order, not two
 * separate tabs they have to reconcile by timestamp.
 */
export async function recentWebhookDeliveries(
  limit = 30,
): Promise<WebhookDeliveryView[]> {
  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { data } = await db
    .from("webhook_deliveries")
    .select(
      "id, endpoint_id, event_id, event_type, status, attempts, response_status, error, next_attempt_at, delivered_at, created_at",
    )
    .eq("business_id", workspace.businessId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100));

  if (!data?.length) return [];

  const endpointIds = [...new Set(data.map((row) => row.endpoint_id))];
  const { data: endpoints } = await db
    .from("webhook_endpoints")
    .select("id, url")
    .in("id", endpointIds);

  const urls = new Map<string, string>();
  for (const endpoint of endpoints ?? []) urls.set(endpoint.id, endpoint.url);

  return data.map((row) => ({
    id: row.id,
    endpointId: row.endpoint_id,
    endpointUrl: urls.get(row.endpoint_id) ?? "(deleted endpoint)",
    eventType: row.event_type,
    eventId: row.event_id,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    responseStatus: row.response_status,
    error: row.error,
    nextAttemptAt: row.next_attempt_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  }));
}
