import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { parseSignedRequest } from "@/lib/messaging/meta-signed-request";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Meta's **Deauthorize Callback**: somebody removed the app.
 *
 * Required for App Review, and required for the product to be honest. Without
 * it, a customer who revokes access in their Facebook settings leaves us
 * holding a Page token that has already stopped working, and the workspace goes
 * on showing Meta as connected until the next send fails.
 *
 * ## What it does, and what it deliberately does not
 *
 * It marks the integration `DISCONNECTED` and **destroys the stored tokens**.
 * The token is dead the moment Meta sends this, so keeping it has no upside and
 * one obvious downside.
 *
 * It does **not** delete leads, conversations or prospects. Removing an app is
 * a statement about access, not about data: the customer's own records, and
 * the conversations they have had with their own leads, are theirs and are not
 * Meta's to revoke. Somebody who wants the data gone uses the data-deletion
 * callback next to this one, which is a different request with a different
 * meaning — and conflating them would silently destroy a customer's pipeline
 * because they tidied up their Facebook settings.
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
    // 400 rather than 403: Meta retries neither, and the distinction that
    // matters to us is that nothing was acted on.
    return Response.json({ error: parsed.reason }, { status: 400 });
  }

  const admin = createAdminClient();

  // Every Meta integration this person connected. A single Meta account can be
  // the connector for several workspaces — an agency running Pages for its
  // clients — and revoking the app revokes all of them at once.
  const { data: integrations } = await admin
    .from("integrations")
    .select("id, business_id")
    .eq("provider_type", "meta")
    .eq("external_account_id", parsed.userId);

  for (const integration of integrations ?? []) {
    // The secret first. If the second write fails we would rather be left with
    // an integration marked healthy and no token — which fails loudly on the
    // next send — than one marked disconnected with a live token still in the
    // database.
    await admin.from("integration_secrets").delete().eq("integration_id", integration.id);

    await admin
      .from("integrations")
      .update({
        status: "DISCONNECTED",
        last_error_code: "deauthorized",
        last_error_message:
          "The Facebook account that connected this removed ClientTurn's access. Reconnect to resume.",
        last_error_at: new Date().toISOString(),
      })
      .eq("id", integration.id);
  }

  return Response.json({ ok: true, disconnected: integrations?.length ?? 0 });
}
