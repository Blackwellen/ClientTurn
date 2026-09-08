import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  platformIdFrom,
  type MessagingProvider,
  type SendRequest,
  type SendResult,
  type MetaChannel,
} from "./types";
import {
  parseMetaInbound,
  parseMetaStatus,
  verifyMetaHmac,
} from "./meta-protocol";

/**
 * Facebook Messenger and Instagram Direct, through the workspace's own Page.
 *
 * This is the transport that makes an autonomous social conversation possible,
 * and the reason it is possible *lawfully* is worth stating at the top, because
 * every decision below follows from it:
 *
 *   Meta permits a business to message a person **who messaged the business
 *   first**, within a bounded window. It provides no way to message a stranger
 *   and no way to follow anybody. So this module can only ever continue a
 *   conversation the person opened. It cannot start one.
 *
 * Three consequences run through the code:
 *
 *   * **The credential is per-workspace, never global.** The Page token belongs
 *     to the workspace that granted it and lives in `integration_secrets`. A
 *     send resolves it from `businessId`, so there is no code path by which one
 *     workspace's token could deliver another's message.
 *   * **The window is checked by the caller, not here.** The send guard and the
 *     agent policy own that decision and hold the conversation state needed to
 *     make it; a transport that silently re-checked would disguise a policy
 *     failure as a provider error.
 *   * **`messaging_type: RESPONSE`.** The only type this product is entitled to
 *     use. Declaring a message a response to somebody who did not write to us
 *     is a misrepresentation to Meta, and it is what gets a Page's messaging
 *     permission withdrawn rather than merely rate-limited.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/* --------------------------------------------------------------- credential */

export type MetaSendingAccount = {
  integrationId: string;
  pageId: string;
  pageToken: string;
  instagramUserId: string | null;
};

/**
 * The workspace's connected Page and its token.
 *
 * Returns null rather than throwing for a workspace that has not connected
 * Meta: not being connected is an ordinary state the send guard reports as an
 * integration requirement, not an exception.
 */
export async function metaSendingAccount(
  businessId: string,
): Promise<MetaSendingAccount | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("integrations")
    .select("id, config, status")
    .eq("business_id", businessId)
    .eq("provider_type", "meta")
    .maybeSingle();

  if (!data || data.status === "DISCONNECTED") return null;

  const { data: secret } = await admin
    .from("integration_secrets")
    .select("access_token")
    .eq("integration_id", data.id)
    .maybeSingle();

  const config = (data.config ?? {}) as Record<string, unknown>;
  const pageId = typeof config.pageId === "string" ? config.pageId : null;
  const pageToken = secret?.access_token ?? null;

  if (!pageId || !pageToken) return null;

  return {
    integrationId: data.id,
    pageId,
    pageToken,
    instagramUserId:
      typeof config.instagramUserId === "string" ? config.instagramUserId : null,
  };
}

/* -------------------------------------------------------------------- send */

/**
 * Errors that will never succeed on a retry.
 *
 * Distinguishing these matters more here than on most transports. Codes 10 and
 * 200 mean the window has closed or the permission was never granted, and a
 * queue that retried those would keep attempting sends Meta has already refused
 * — which is itself the behaviour that attracts enforcement.
 */
const PERMANENT_META_ERRORS = new Set([
  10, // permission denied — outside the messaging window, or never granted
  100, // invalid parameter, including an unreachable recipient id
  200, // insufficient permission on the Page
  551, // the person is unavailable to the Page (blocked or deactivated)
  613, // a rate limit Meta expresses as a hard refusal for this recipient
]);

type GraphError = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

/**
 * Sends one message on a social thread.
 *
 * The endpoint differs by channel: Messenger sends from the Page id, Instagram
 * from the linked professional account id. Both authenticate with the same Page
 * token, which is why an Instagram send fails cleanly when the Page has no
 * linked account rather than falling back to Messenger and delivering to a
 * different person who happens to share the id space.
 */
async function sendSocial(request: SendRequest): Promise<SendResult> {
  const channel = request.channel as MetaChannel;
  const recipientId = platformIdFrom(request.to);

  if (!recipientId) {
    return {
      ok: false,
      errorCode: "invalid_recipient",
      errorMessage: `"${request.to}" is not a Meta platform address.`,
      permanent: true,
    };
  }

  const account = await metaSendingAccount(request.businessId);
  if (!account) {
    return {
      ok: false,
      errorCode: "not_connected",
      errorMessage: "No Facebook Page is connected to this workspace.",
      permanent: true,
    };
  }

  if (channel === "instagram" && !account.instagramUserId) {
    return {
      ok: false,
      errorCode: "no_instagram_account",
      errorMessage:
        "The connected Page has no Instagram professional account linked to it.",
      permanent: true,
    };
  }

  const senderId =
    channel === "instagram" ? account.instagramUserId! : account.pageId;

  let response: Response;
  try {
    response = await fetch(`${GRAPH}/${senderId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: request.body },
        messaging_type: "RESPONSE",
        access_token: account.pageToken,
      }),
    });
  } catch (error) {
    // A network failure is transient by definition — nothing reached Meta, so
    // a retry cannot duplicate anything.
    return {
      ok: false,
      errorCode: "network_error",
      errorMessage: error instanceof Error ? error.message : "Request failed.",
      permanent: false,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as GraphError & {
    message_id?: string;
  };

  if (!response.ok) {
    const code = payload.error?.code ?? 0;
    return {
      ok: false,
      errorCode: `meta_${code || response.status}`,
      errorMessage: payload.error?.message ?? `Meta returned ${response.status}.`,
      // A 4xx Meta has not enumerated is still permanent: repeating a request
      // it has rejected is precisely what a throttled Page does not need.
      permanent:
        PERMANENT_META_ERRORS.has(code) ||
        (response.status >= 400 && response.status < 500),
    };
  }

  return {
    ok: true,
    providerMessageId: payload.message_id ?? `meta-${request.sendKey}`,
    provider: "meta",
  };
}

/* -------------------------------------------------------- private replies */

export type PrivateReplyResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode: string; errorMessage: string; permanent: boolean };

/**
 * The one message a business may send to somebody who never wrote to it.
 *
 * A private reply is addressed to a **comment**, not to a person: the recipient
 * is `{ comment_id }`, and Meta resolves who that is. That is the whole reason
 * this is lawful and the reason it cannot be abused — there is no way to
 * express "message this user", only "answer this thing they said on our post".
 *
 * Four rules, all enforced by Meta and all worth failing loudly on:
 *
 *   * One reply per comment, ever. A second attempt is refused.
 *   * Seven days from the comment's own timestamp.
 *   * It does not open the 24-hour window. Only their answer does.
 *   * `messaging_type` is omitted deliberately. Meta infers the type from the
 *     comment recipient, and declaring RESPONSE here — as an ordinary send
 *     does — would be asserting a prior message that does not exist.
 *
 * The window is checked by the caller, which holds the comment's timestamp.
 * A transport that re-checked would be guessing at a clock it cannot see.
 */
export async function sendPrivateReply(input: {
  businessId: string;
  channel: MetaChannel;
  /** The platform's comment id, from `prospect_data_sources.provider_entity_id`. */
  commentId: string;
  body: string;
}): Promise<PrivateReplyResult> {
  const account = await metaSendingAccount(input.businessId);
  if (!account) {
    return {
      ok: false,
      errorCode: "not_connected",
      errorMessage: "No Facebook Page is connected to this workspace.",
      permanent: true,
    };
  }

  if (input.channel === "instagram" && !account.instagramUserId) {
    return {
      ok: false,
      errorCode: "no_instagram_account",
      errorMessage:
        "The connected Page has no Instagram professional account linked to it.",
      permanent: true,
    };
  }

  const senderId =
    input.channel === "instagram" ? account.instagramUserId! : account.pageId;

  let response: Response;
  try {
    response = await fetch(`${GRAPH}/${senderId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { comment_id: input.commentId },
        message: { text: input.body },
        access_token: account.pageToken,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      errorCode: "network_error",
      errorMessage: error instanceof Error ? error.message : "Request failed.",
      permanent: false,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as GraphError & {
    message_id?: string;
  };

  if (!response.ok) {
    const code = payload.error?.code ?? 0;
    return {
      ok: false,
      errorCode: `meta_${code || response.status}`,
      errorMessage: payload.error?.message ?? `Meta returned ${response.status}.`,
      // Every refusal here is permanent by nature: the comment is too old, the
      // one permitted reply is spent, or the permission is absent. None of
      // those improves by trying again, and retrying is what draws attention.
      permanent: true,
    };
  }

  return { ok: true, providerMessageId: payload.message_id ?? `meta-pr-${input.commentId}` };
}

/* ---------------------------------------------------------------- webhook */

/**
 * Signature verification, bound to this deployment's app secret.
 *
 * The mechanics live in `meta-protocol.ts`, which takes the secret as an
 * argument and knows nothing about the environment. This wrapper is the only
 * place the two are joined, which is what lets the verifier be tested against
 * known keys instead of only against "nothing is configured".
 */
export async function verifyMetaSignature(
  request: Request,
  rawBody: string,
): Promise<boolean> {
  return verifyMetaHmac(
    request.headers.get("x-hub-signature-256"),
    rawBody,
    serverEnv.meta.appSecret,
  );
}

export { parseMetaInbound, parseMetaStatus } from "./meta-protocol";

/* --------------------------------------------------------------- provider */

export function isMetaConfigured(): boolean {
  return Boolean(serverEnv.meta.appId && serverEnv.meta.appSecret);
}

export function createMetaProvider(): MessagingProvider {
  return {
    name: "meta",
    send: sendSocial,
    verifyWebhook: verifyMetaSignature,
    parseInbound: async (rawBody) => parseMetaInbound(rawBody),
    parseStatus: async (rawBody) => parseMetaStatus(rawBody),
  };
}
