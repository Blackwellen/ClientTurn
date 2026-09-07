"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  createEndpoint,
  deleteEndpoint,
  rotateEndpointSecret,
  updateEndpoint,
} from "./endpoints";
import { emitTestEvent } from "./emit";
import { WEBHOOK_EVENT_TYPES, isWebhookEventType } from "./events";

/**
 * Managing webhook endpoints from Settings → Developer.
 *
 * Every action requires `admin`. Pointing ClientTurn at an outside address to
 * send it lead data is a decision about where a workspace's data goes, and it
 * outlives whoever made it.
 */

export type WebhookActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const endpointIdSchema = z.object({ endpointId: z.string().uuid() });

/* ------------------------------------------------------------------ create */

const createSchema = z.object({
  url: z.string().trim().min(8).max(500),
  description: z.string().trim().max(240).optional(),
  events: z.array(z.string()).min(1).max(WEBHOOK_EVENT_TYPES.length),
});

export async function createWebhookEndpointAction(input: unknown): Promise<
  WebhookActionResult<{ id: string; url: string; secret: string }>
> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Give the endpoint an address and at least one event.");
  }

  if (parsed.data.events.some((event) => !isWebhookEventType(event))) {
    return fail("One of those events is not an event ClientTurn sends.");
  }

  const workspace = await requireRole("admin");

  const result = await createEndpoint({
    businessId: workspace.businessId,
    userId: workspace.userId,
    url: parsed.data.url,
    description: parsed.data.description ?? null,
    events: parsed.data.events,
  });

  if (!result.ok) return fail(result.error);

  revalidatePath("/app/settings");

  // The signing secret travels back exactly once, to be shown once.
  return {
    ok: true,
    data: {
      id: result.endpoint.id,
      url: result.endpoint.url,
      secret: result.endpoint.secret,
    },
  };
}

/* ------------------------------------------------------------------ update */

const updateSchema = endpointIdSchema.extend({
  description: z.string().trim().max(240).nullable().optional(),
  events: z.array(z.string()).min(1).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export async function updateWebhookEndpointAction(
  input: unknown,
): Promise<WebhookActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("That endpoint could not be updated.");

  if (parsed.data.events?.some((event) => !isWebhookEventType(event))) {
    return fail("One of those events is not an event ClientTurn sends.");
  }

  const workspace = await requireRole("admin");

  const result = await updateEndpoint({
    businessId: workspace.businessId,
    endpointId: parsed.data.endpointId,
    userId: workspace.userId,
    description: parsed.data.description,
    events: parsed.data.events,
    status: parsed.data.status,
  });

  if (!result.ok) return fail(result.error);

  revalidatePath("/app/settings");
  return { ok: true };
}

/* ------------------------------------------------------------------ rotate */

export async function rotateWebhookSecretAction(
  input: unknown,
): Promise<WebhookActionResult<{ secret: string }>> {
  const parsed = endpointIdSchema.safeParse(input);
  if (!parsed.success) return fail("That endpoint could not be found.");

  const workspace = await requireRole("admin");

  const result = await rotateEndpointSecret({
    businessId: workspace.businessId,
    endpointId: parsed.data.endpointId,
    userId: workspace.userId,
  });

  if (!result.ok) return fail(result.error);

  revalidatePath("/app/settings");
  return { ok: true, data: { secret: result.secret } };
}

/* ------------------------------------------------------------------ delete */

export async function deleteWebhookEndpointAction(
  input: unknown,
): Promise<WebhookActionResult> {
  const parsed = endpointIdSchema.safeParse(input);
  if (!parsed.success) return fail("That endpoint could not be found.");

  const workspace = await requireRole("admin");

  const deleted = await deleteEndpoint({
    businessId: workspace.businessId,
    endpointId: parsed.data.endpointId,
    userId: workspace.userId,
  });

  if (!deleted) return fail("That endpoint could not be found.");

  revalidatePath("/app/settings");
  return { ok: true };
}

/* -------------------------------------------------------------------- test */

/**
 * Queues a test event.
 *
 * Rate limited per workspace, not per IP: the button makes our servers connect
 * to an address the customer just typed, so the thing worth bounding is how
 * often one workspace can ask us to do that.
 */
export async function sendTestWebhookAction(
  input: unknown,
): Promise<WebhookActionResult> {
  const parsed = endpointIdSchema.safeParse(input);
  if (!parsed.success) return fail("That endpoint could not be found.");

  const workspace = await requireRole("admin");

  const limit = await checkRateLimit("webhook:test", workspace.businessId);
  if (!limit.allowed) {
    return fail("That is a lot of test events. Try again in a few minutes.");
  }

  // Confirms the endpoint belongs to this workspace before queueing anything
  // against its id — the id arrives from the browser and is an argument, not a
  // fact.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data: endpoint } = await db
    .from("webhook_endpoints")
    .select("id, url, status")
    .eq("id", parsed.data.endpointId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!endpoint) return fail("That endpoint could not be found.");
  if (endpoint.status !== "ACTIVE") {
    return fail("Switch the endpoint back on before testing it.");
  }

  const result = await emitTestEvent({
    businessId: workspace.businessId,
    endpointId: endpoint.id,
  });

  if (!result.ok) return fail("That test event could not be queued.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "webhook_endpoint.tested",
    entityType: "webhook_endpoint",
    entityId: endpoint.id,
    metadata: { url: endpoint.url, eventId: result.eventId },
  });

  revalidatePath("/app/settings");
  return { ok: true };
}
