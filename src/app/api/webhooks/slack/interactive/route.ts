import { createAdminClient } from "@/lib/supabase/admin";
import { verifySlackSignature } from "@/lib/integrations/providers/slack";
import { enqueue, webhookInboxStatus } from "@/lib/jobs/queue";
import { recordThenQueue } from "@/lib/jobs/inbox-core";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Slack's Interactivity Request URL — one endpoint for every customer
 * workspace, because this is ClientTurn's own Slack app (one app, many OAuth
 * installs), not a per-customer credential. `verifySlackSignature` uses the
 * platform's single signing secret; which *workspace* a click belongs to is
 * resolved afterward, from the click's own `team.id`, inside the job.
 *
 * Same shape as the Meta webhook: verify → record → acknowledge → queue.
 * Posting the outcome back to Slack (`response_url`) is provider I/O and
 * happens from the worker, never from this request.
 */
type SlackBlockActionsPayload = {
  type?: string;
  team?: { id?: string };
  user?: { id?: string; username?: string; name?: string };
  actions?: { action_id?: string; value?: string; action_ts?: string }[];
  response_url?: string;
};

export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  // Slack signs these exact bytes; parse only after verifying.
  const rawBody = await request.text();

  const verified = verifySlackSignature({
    signature: request.headers.get("x-slack-signature"),
    timestamp: request.headers.get("x-slack-request-timestamp"),
    rawBody,
  });
  if (!verified) return new Response("forbidden", { status: 403 });

  // Interactivity payloads arrive form-encoded with the real JSON in one field
  // — a different shape from Slack's Events API, which is plain JSON.
  const form = new URLSearchParams(rawBody);
  const raw = form.get("payload");
  if (!raw) return new Response("ok", { status: 200 });

  let payload: SlackBlockActionsPayload;
  try {
    payload = JSON.parse(raw) as SlackBlockActionsPayload;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // Only block_actions (button clicks) are wired up today. Anything else --
  // a shortcut, a view submission -- is acknowledged and ignored rather than
  // left to time out, since Slack will disable a Request URL that fails too
  // many deliveries.
  if (payload.type !== "block_actions") return new Response("ok", { status: 200 });

  const action = payload.actions?.[0];
  const teamId = payload.team?.id;
  if (!action?.action_id || !action.value || !teamId) {
    return new Response("ok", { status: 200 });
  }

  const externalEventId = `${teamId}:${action.action_id}:${action.value}:${action.action_ts ?? Date.now()}`;

  const admin = createAdminClient();
  const { error } = await admin.from("webhook_events").insert({
    provider: "slack",
    external_event_id: externalEventId,
    event_type: action.action_id,
    status: "received",
    payload: {
      teamId,
      actionId: action.action_id,
      value: action.value,
      userId: payload.user?.id ?? null,
      userName: payload.user?.username ?? payload.user?.name ?? null,
      responseUrl: payload.response_url ?? null,
    } as never,
  });

  // A double-fire of the same click (Slack retries a slow 200) is recorded
  // once; a redelivery of one recorded but never queued is queued now
  // (inbox-core.ts).
  const outcome = await recordThenQueue({
    insert: async () => error,
    status: () => webhookInboxStatus("slack", externalEventId),
    queue: () => enqueue("slack.interaction", { externalEventId }, { idempotencyKey: `slack.interaction:${externalEventId}` }),
  });
  if (outcome === "FAILED") return new Response("error", { status: 500 });

  return new Response("", { status: 200 });
}
