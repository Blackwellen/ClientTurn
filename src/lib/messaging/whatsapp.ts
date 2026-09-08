import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalisePhone,
  type SendRequest,
  type SendResult,
} from "./types";

/**
 * WhatsApp through Meta's Cloud API, direct.
 *
 * WhatsApp already worked here through Twilio, which is an official Meta
 * Business Solution Provider — genuine WhatsApp Business messages, no Meta App
 * Review, Twilio holding the platform relationship. This is the alternative
 * route: the same messages, Meta's own pricing with no reseller margin, and
 * 1,000 free service conversations a month.
 *
 * Both are kept. A workspace with a Meta WhatsApp integration connected sends
 * through this; every other workspace continues through Twilio, unchanged.
 * Choosing per workspace rather than per deployment is what lets a customer
 * move without anybody else's messages being touched.
 *
 * ## The rule that shapes everything
 *
 * WhatsApp's rules on messaging an individual are the same shape as Messenger's
 * and are not softened by going direct:
 *
 *   * A person messages the business → free-form replies for **24 hours**. This
 *     is the *customer service window*.
 *   * Outside it, a business-initiated message must be a **pre-approved
 *     template**. Free text is refused by the API, not merely discouraged.
 *   * There is no way to reach a number that never contacted the business
 *     without an approved template *and* an opt-in that can be evidenced.
 *
 * So this transport sends free text only inside the window. The caller owns
 * that decision — it holds the conversation state — and a transport that
 * silently re-checked would disguise a policy failure as a provider error.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/* --------------------------------------------------------------- credential */

export type WhatsAppSendingAccount = {
  integrationId: string;
  /** The number messages go out from. Meta's id for it, not the number itself. */
  phoneNumberId: string;
  /** The WhatsApp Business Account the number belongs to. */
  wabaId: string | null;
  accessToken: string;
};

/**
 * The workspace's connected WhatsApp number.
 *
 * Returns null rather than throwing for a workspace that has not connected
 * one — that is the ordinary state for every workspace still on Twilio, and the
 * registry treats it as "use the carrier" rather than as a failure.
 */
export async function whatsAppSendingAccount(
  businessId: string,
): Promise<WhatsAppSendingAccount | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("integrations")
    .select("id, config, status")
    .eq("business_id", businessId)
    .eq("provider_type", "whatsapp_cloud")
    .maybeSingle();

  if (!data || data.status === "DISCONNECTED") return null;

  const { data: secret } = await admin
    .from("integration_secrets")
    .select("access_token")
    .eq("integration_id", data.id)
    .maybeSingle();

  const config = (data.config ?? {}) as Record<string, unknown>;
  const phoneNumberId =
    typeof config.phoneNumberId === "string" ? config.phoneNumberId : null;
  const accessToken = secret?.access_token ?? null;

  if (!phoneNumberId || !accessToken) return null;

  return {
    integrationId: data.id,
    phoneNumberId,
    wabaId: typeof config.wabaId === "string" ? config.wabaId : null,
    accessToken,
  };
}

/**
 * Whether this workspace sends WhatsApp through Meta rather than Twilio.
 *
 * A cheap existence check the registry can call on every send without paying
 * for the secret lookup.
 */
export async function usesWhatsAppCloudApi(businessId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("id")
    .eq("business_id", businessId)
    .eq("provider_type", "whatsapp_cloud")
    .neq("status", "DISCONNECTED")
    .maybeSingle();

  return Boolean(data);
}

/* -------------------------------------------------------------------- send */

/**
 * WhatsApp wants a bare international number: digits only, country code
 * included, no `+` and no separators. `normalisePhone` gives us E.164, so this
 * is the last step rather than a parser of its own — one place decides what a
 * phone number is, and this only changes its clothes.
 */
function toWhatsAppNumber(address: string): string | null {
  const e164 = normalisePhone(address.replace(/^whatsapp:/i, ""));
  if (!e164) return null;
  return e164.replace(/^\+/, "");
}

/**
 * Errors that will never succeed on a retry.
 *
 * 131047 is the one that matters most: it means the 24-hour window has closed
 * and the message needed a template. Retrying it produces the same refusal and
 * counts against the number's quality rating, which is what throttles a number
 * and eventually blocks it.
 */
const PERMANENT_WHATSAPP_ERRORS = new Set([
  131047, // re-engagement required — outside the 24-hour window
  131026, // undeliverable: the recipient has no WhatsApp account
  131051, // unsupported message type
  132000, // template param count mismatch
  132001, // template does not exist or is not approved
  132005, // template text was edited and needs re-approval
  131008, // required parameter missing
  100, // invalid parameter
]);

type GraphError = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

export type WhatsAppTemplate = {
  name: string;
  /** BCP-47 code the template was approved under, e.g. "en_GB". */
  language: string;
  /** Positional body parameters, in the order the template declares them. */
  parameters?: string[];
};

/**
 * Sends one WhatsApp message.
 *
 * Free text when `template` is absent — permitted only inside the 24-hour
 * window, which the caller has already established. A template otherwise.
 */
export async function sendWhatsApp(
  request: SendRequest & { template?: WhatsAppTemplate },
): Promise<SendResult> {
  const to = toWhatsAppNumber(request.to);
  if (!to) {
    return {
      ok: false,
      errorCode: "invalid_recipient",
      errorMessage: `"${request.to}" is not a usable phone number.`,
      permanent: true,
    };
  }

  const account = await whatsAppSendingAccount(request.businessId);
  if (!account) {
    return {
      ok: false,
      errorCode: "not_connected",
      errorMessage: "No WhatsApp number is connected to this workspace.",
      permanent: true,
    };
  }

  const body = request.template
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: request.template.name,
          language: { code: request.template.language },
          ...(request.template.parameters?.length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: request.template.parameters.map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ],
              }
            : {}),
        },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        // Link previews off: a preview renders a third party's content inside
        // the business's message, which is not ours to put there.
        text: { preview_url: false, body: request.body },
      };

  let response: Response;
  try {
    response = await fetch(`${GRAPH}/${account.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // Nothing reached Meta, so a retry cannot duplicate anything.
    return {
      ok: false,
      errorCode: "network_error",
      errorMessage: error instanceof Error ? error.message : "Request failed.",
      permanent: false,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as GraphError & {
    messages?: { id?: string }[];
  };

  if (!response.ok) {
    const code = payload.error?.code ?? 0;
    return {
      ok: false,
      errorCode: `whatsapp_${code || response.status}`,
      errorMessage: payload.error?.message ?? `WhatsApp returned ${response.status}.`,
      permanent:
        PERMANENT_WHATSAPP_ERRORS.has(code) ||
        (response.status >= 400 && response.status < 500),
    };
  }

  return {
    ok: true,
    providerMessageId: payload.messages?.[0]?.id ?? `wa-${request.sendKey}`,
    provider: "whatsapp_cloud",
  };
}

/* ---------------------------------------------------------------- templates */

export type ApprovedTemplate = {
  name: string;
  language: string;
  status: string;
  category: string;
};

/**
 * The templates this workspace may send outside the 24-hour window.
 *
 * Only `APPROVED` ones are returned. A template in review, rejected or paused
 * is refused by the API, and offering one in the UI would let somebody schedule
 * a message that can never go out.
 */
export async function approvedTemplates(
  businessId: string,
): Promise<ApprovedTemplate[]> {
  const account = await whatsAppSendingAccount(businessId);
  if (!account?.wabaId) return [];

  try {
    const response = await fetch(
      `${GRAPH}/${account.wabaId}/message_templates?fields=name,language,status,category&limit=100`,
      { headers: { authorization: `Bearer ${account.accessToken}` } },
    );
    if (!response.ok) return [];

    const payload = (await response.json()) as {
      data?: { name?: string; language?: string; status?: string; category?: string }[];
    };

    return (payload.data ?? [])
      .filter((row) => row.status === "APPROVED" && row.name && row.language)
      .map((row) => ({
        name: row.name!,
        language: row.language!,
        status: row.status!,
        category: row.category ?? "UTILITY",
      }));
  } catch {
    // A template list that cannot be fetched is an empty list, not an error:
    // the caller's fallback is "no template available", which is the safe
    // direction — it stops a send rather than attempting an unapproved one.
    return [];
  }
}
