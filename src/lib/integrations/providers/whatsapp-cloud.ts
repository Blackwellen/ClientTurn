import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { type OAuthConfig, type TokenResponse } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";

/**
 * WhatsApp Cloud API: connecting a customer's own number.
 *
 * **Every customer has a different number.** This is not a platform-level
 * credential like a Twilio account — each business owns a WhatsApp Business
 * Account, registers its own phone number to it, and gets its own message
 * templates approved. So the connection is per workspace, and everything the
 * transport needs lands on that workspace's `integrations` row.
 *
 * ## Embedded Signup, and why it is not ordinary OAuth
 *
 * Meta's flow for this is **Embedded Signup**: a Facebook Login dialog driven
 * by a `config_id` that Meta generates when you configure the WhatsApp use
 * case. Inside that dialog the business can create a WhatsApp Business Account,
 * add a phone number and verify it — none of which a plain OAuth scope grant
 * can do.
 *
 * The parts that differ from every other provider here:
 *
 *   * `config_id` is required, and `override_default_response_type=true` with
 *     it, or Meta returns a token instead of the code we exchange.
 *   * After the exchange we have to go and *find* what they connected. The
 *     token does not say which WABA or which number; that is a lookup, and a
 *     connection without it completes and then fails every send.
 *   * The customer's WABA must be subscribed to this app before any inbound
 *     message arrives. Subscribing the app to the webhook is not enough —
 *     that says where events go, this says whose events to send.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

function config(): OAuthConfig | null {
  const appId = serverEnv.meta?.appId;
  const appSecret = serverEnv.meta?.appSecret;
  const configId = serverEnv.meta?.whatsappConfigId;

  // All three, not two. Without `config_id` the dialog is an ordinary Facebook
  // login that grants scopes and creates nothing — the customer would come back
  // "connected" with no WhatsApp account, which is worse than being unable to
  // start.
  if (!appId || !appSecret || !configId) return null;

  return {
    clientId: appId,
    clientSecret: appSecret,
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: `${GRAPH}/oauth/access_token`,
    scope: ["whatsapp_business_management", "whatsapp_business_messaging"].join(","),
    extraAuthorizeParams: {
      config_id: configId,
      // Without this Meta returns an access token in the fragment rather than a
      // code, and `exchangeCodeForToken` has nothing to exchange.
      response_type: "code",
      override_default_response_type: "true",
    },
  };
}

type PhoneNumber = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string;
};

/**
 * Finds the WhatsApp Business Account and number this person just connected.
 *
 * Searched across every Business they administer rather than assuming the
 * first: an agency or a group holds several, and the WABA lives on exactly one
 * of them. Picking arbitrarily reports "none connected" for an account that is
 * plainly there.
 */
async function resolveWhatsAppAccount(accessToken: string): Promise<{
  wabaId: string | null;
  phoneNumberId: string | null;
  displayNumber: string | null;
  verifiedName: string | null;
}> {
  const empty = {
    wabaId: null,
    phoneNumberId: null,
    displayNumber: null,
    verifiedName: null,
  };

  try {
    const businessesResponse = await fetch(
      `${GRAPH}/me/businesses?fields=id,name&limit=25&access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    );
    if (!businessesResponse.ok) return empty;

    const businesses = (await businessesResponse.json()) as {
      data?: { id?: string }[];
    };

    for (const business of businesses.data ?? []) {
      if (!business.id) continue;

      const wabaResponse = await fetch(
        `${GRAPH}/${business.id}/owned_whatsapp_business_accounts?fields=id&limit=10&access_token=${encodeURIComponent(accessToken)}`,
        { cache: "no-store" },
      );
      if (!wabaResponse.ok) continue;

      const wabas = (await wabaResponse.json()) as { data?: { id?: string }[] };
      const wabaId = wabas.data?.[0]?.id;
      if (!wabaId) continue;

      const numbersResponse = await fetch(
        `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status&limit=10&access_token=${encodeURIComponent(accessToken)}`,
        { cache: "no-store" },
      );
      if (!numbersResponse.ok) return { ...empty, wabaId };

      const numbers = (await numbersResponse.json()) as { data?: PhoneNumber[] };

      // A verified number if there is one — an unverified number cannot send,
      // and connecting to it would report success for something that refuses
      // every message.
      const list = numbers.data ?? [];
      const chosen =
        list.find((number) => number.code_verification_status === "VERIFIED") ??
        list[0] ??
        null;

      return {
        wabaId,
        phoneNumberId: chosen?.id ?? null,
        displayNumber: chosen?.display_phone_number ?? null,
        verifiedName: chosen?.verified_name ?? null,
      };
    }
  } catch {
    // A resolution failure leaves the connection recorded with no config. The
    // send path reports "no WhatsApp number connected", and reconnecting fixes
    // it — far better than a callback that throws after the token was granted
    // and leaves the customer with neither.
  }

  return empty;
}

/**
 * Subscribes this app to the customer's WhatsApp Business Account.
 *
 * Distinct from the app-level webhook subscription, and both are required. The
 * app-level one says *where* WhatsApp events go; this says *whose* events to
 * send. Without it the webhook is configured, verified, and silent for this
 * customer.
 */
async function subscribeToWaba(wabaId: string, accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

registerOAuthProvider("whatsapp_cloud", {
  getConfig: config,
  async identify(token: TokenResponse) {
    const resolved = await resolveWhatsAppAccount(token.accessToken);

    if (resolved.wabaId) {
      // Best-effort: a failure here means inbound messages will not arrive for
      // this customer, which the connection health check surfaces. It must not
      // fail the connection itself — the number can still send, and the
      // subscription is retried whenever they reconnect.
      await subscribeToWaba(resolved.wabaId, token.accessToken);
    }

    return {
      externalAccountId: resolved.phoneNumberId ?? resolved.wabaId,
      // What the customer recognises: the number, and the name Meta shows
      // recipients. Not an opaque id.
      displayName:
        resolved.displayNumber && resolved.verifiedName
          ? `${resolved.verifiedName} (${resolved.displayNumber})`
          : (resolved.displayNumber ?? resolved.verifiedName ?? "WhatsApp"),
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      config: {
        ...(resolved.wabaId ? { wabaId: resolved.wabaId } : {}),
        ...(resolved.phoneNumberId ? { phoneNumberId: resolved.phoneNumberId } : {}),
        ...(resolved.displayNumber ? { displayNumber: resolved.displayNumber } : {}),
      },
    };
  },
});

/**
 * Re-resolves a workspace's WhatsApp number.
 *
 * Called from the connection health check. A number can be removed, replaced or
 * fall out of verification on Meta's side without anything reaching us, and the
 * first a customer would otherwise know is a send failing.
 */
export async function refreshWhatsAppConfig(businessId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select("id")
    .eq("business_id", businessId)
    .eq("provider_type", "whatsapp_cloud")
    .maybeSingle();

  if (!integration) return false;

  const { data: secret } = await admin
    .from("integration_secrets")
    .select("access_token")
    .eq("integration_id", integration.id)
    .maybeSingle();

  if (!secret?.access_token) return false;

  const resolved = await resolveWhatsAppAccount(secret.access_token);
  if (!resolved.phoneNumberId) return false;

  await admin
    .from("integrations")
    .update({
      config: {
        wabaId: resolved.wabaId,
        phoneNumberId: resolved.phoneNumberId,
        displayNumber: resolved.displayNumber,
      } as never,
      last_success_at: new Date().toISOString(),
    })
    .eq("id", integration.id);

  return true;
}
