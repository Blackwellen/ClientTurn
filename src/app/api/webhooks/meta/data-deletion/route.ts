import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import {
  deletionConfirmationCode,
  parseSignedRequest,
} from "@/lib/messaging/meta-signed-request";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Meta's **Data Deletion Callback**: somebody asked for their data to be
 * removed.
 *
 * Required for App Review. Meta POSTs a `signed_request` and expects a JSON
 * response carrying a status URL and a confirmation code, so the person can go
 * and check what happened. An app without this is refused.
 *
 * ## Answer first, delete after
 *
 * The response has to be immediate and has to contain a code the person can
 * look up later. Deleting inline would mean either doing an unbounded amount of
 * work on a request Meta will time out, or answering first and hoping — with
 * nothing recorded if the process died in between.
 *
 * So this records the request and answers; the deletion runs after, and stamps
 * the row with what it actually removed. That is what makes the status page
 * honest rather than aspirational.
 *
 * ## What "their data" means here, and why it is not everything
 *
 * The person authenticating is whoever connected the Facebook Page — the
 * customer, not a lead. What belongs to them, and is deleted:
 *
 *   * the Meta integration and its tokens;
 *   * every prospect sourced *from Meta*, and the social threads attached to
 *     them — people we only know about because that Page was connected.
 *
 * What is **not** deleted, and the distinction matters:
 *
 *   * Leads, bookings, invoices and conversations on other channels. Those are
 *     the customer's own business records. A workspace is not deleted because
 *     somebody exercised a right against Meta, and quietly destroying a
 *     pipeline would be a far worse failure than declining to.
 *
 * A customer who wants the whole workspace gone asks us directly, and that is a
 * different path with a confirmation step, because it is irreversible.
 */
export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const form = await request.formData().catch(() => null);
  const signedRequest = form?.get("signed_request");

  const parsed = parseSignedRequest(
    typeof signedRequest === "string" ? signedRequest : null,
    serverEnv.meta.appSecret,
  );

  if (!parsed.ok) {
    return Response.json({ error: parsed.reason }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: integrations } = await admin
    .from("integrations")
    .select("id, business_id")
    .eq("provider_type", "meta")
    .eq("external_account_id", parsed.userId);

  const businessIds = [...new Set((integrations ?? []).map((row) => row.business_id))];

  // Random, never derived from the Meta user id. A derived code would let
  // anybody who knows somebody's Meta id look up their deletion request, which
  // turns a privacy feature into a disclosure.
  const confirmationCode = deletionConfirmationCode(randomBytes(16));

  const { error } = await admin.from("meta_data_deletion_requests").insert({
    confirmation_code: confirmationCode,
    meta_user_id: parsed.userId,
    business_ids: businessIds,
    status: "RECEIVED",
  });

  if (error) {
    // Never acknowledge a request we did not record. Meta shows the person the
    // URL and code we return, and a code that resolves to nothing is worse
    // than an error they can retry.
    return Response.json({ error: "The request could not be recorded." }, { status: 500 });
  }

  await performDeletion(confirmationCode, parsed.userId, businessIds);

  const base = serverEnv.siteUrl.replace(/\/$/, "");

  // Meta's required response shape, exactly.
  return Response.json({
    url: `${base}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}

/**
 * Removes what the Meta connection brought in.
 *
 * Awaited rather than queued, deliberately: the work is bounded (one
 * workspace's Meta-sourced prospects), and a deletion that silently sat in a
 * queue behind a broken worker would leave the status page reporting `RECEIVED`
 * for ever. If it grows past what a request can carry, this becomes a job — and
 * the row already models that, because `RECEIVED` is a real state rather than
 * an assumption.
 *
 * Every failure is caught and recorded. A deletion that half-succeeded must say
 * so on the status page rather than throwing and leaving the person with a code
 * that resolves to nothing.
 */
async function performDeletion(
  confirmationCode: string,
  metaUserId: string,
  businessIds: string[],
): Promise<void> {
  const admin = createAdminClient();

  let integrationsRemoved = 0;
  let prospectsRemoved = 0;
  let conversationsRemoved = 0;

  try {
    for (const businessId of businessIds) {
      // Social threads sourced from Meta, and their messages. Deleted before
      // the prospects so a conversation is never orphaned by a failure between
      // the two.
      const { data: conversations } = await admin
        .from("conversations")
        .delete()
        .eq("business_id", businessId)
        .in("channel", ["messenger", "instagram"])
        .select("id");

      conversationsRemoved += conversations?.length ?? 0;

      const { data: prospects } = await admin
        .from("prospects")
        .delete()
        .eq("business_id", businessId)
        .in("social_platform", ["FACEBOOK", "INSTAGRAM"])
        .select("id");

      prospectsRemoved += prospects?.length ?? 0;
    }

    // The integration last: while it exists, the rows above can be identified
    // as Meta-sourced. Removing it first would strip the evidence of what to
    // delete if anything went wrong in between.
    const { data: removed } = await admin
      .from("integrations")
      .delete()
      .eq("provider_type", "meta")
      .eq("external_account_id", metaUserId)
      .select("id");

    integrationsRemoved = removed?.length ?? 0;

    await admin
      .from("meta_data_deletion_requests")
      .update({
        status:
          integrationsRemoved + prospectsRemoved + conversationsRemoved === 0
            ? "NOTHING_TO_DELETE"
            : "COMPLETED",
        integrations_removed: integrationsRemoved,
        prospects_removed: prospectsRemoved,
        conversations_removed: conversationsRemoved,
        completed_at: new Date().toISOString(),
      })
      .eq("confirmation_code", confirmationCode);
  } catch (error) {
    await admin
      .from("meta_data_deletion_requests")
      .update({
        status: "FAILED",
        last_error: error instanceof Error ? error.message : "Deletion failed.",
        integrations_removed: integrationsRemoved,
        prospects_removed: prospectsRemoved,
        conversations_removed: conversationsRemoved,
      })
      .eq("confirmation_code", confirmationCode);
  }
}
