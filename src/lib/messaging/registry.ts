import "server-only";
import { serverEnv } from "@/lib/env";
import { createEmailProvider } from "./email-provider";
import { createStubProvider } from "./stub";
import { createMetaProvider } from "./meta";
import { sendWhatsApp, usesWhatsAppCloudApi } from "./whatsapp";
import { createTwilioProvider, isTwilioConfigured, twilioConfigProblems } from "./twilio";
import { isMetaChannel, type MessagingProvider } from "./types";

let cached: MessagingProvider | null = null;
let announced = false;

function announce(provider: MessagingProvider, reason: string) {
  if (announced) return;
  announced = true;
  console.info(`[messaging] provider=${provider.name} (${reason})`);
}

/**
 * Routes each send to the transport that owns its channel: email through the
 * workspace's own SMTP server, Messenger and Instagram through the workspace's
 * connected Page, everything else through the configured SMS/WhatsApp carrier.
 * One object so `performSend` stays a single guarded path rather than branching
 * per channel at every call site.
 *
 * Only the carrier's webhook parsing is exposed here. Meta signs its callbacks
 * with a different secret and delivers a different envelope, so it owns its own
 * route (`/api/webhooks/meta`) and calls into `lib/messaging/meta` directly —
 * multiplexing two unrelated signature schemes behind one `verifyWebhook` is
 * how a verifier ends up accepting whichever scheme is weaker.
 *
 * LinkedIn is refused outright rather than routed. There is no transport for a
 * personal LinkedIn account: the message is performed by a person in ASSISTED
 * mode, or by a partner integration, and either way it travels through
 * `social_outbound_messages` and never through this object. The refusal is
 * explicit because the alternative is worse than an error — without it the
 * channel falls through to `carrier.send`, and a LinkedIn message is handed to
 * the SMS carrier, which sends it as a text to whatever the address parses as.
 */
function withChannelRouting(carrier: MessagingProvider): MessagingProvider {
  const email = createEmailProvider();
  const meta = createMetaProvider();

  return {
    get name() {
      return carrier.name;
    },
    async send(request) {
      if (request.channel === "email") return email.send(request);
      if (isMetaChannel(request.channel)) return meta.send(request);

      // WhatsApp has two legitimate routes and the workspace decides which. A
      // workspace that has connected a WhatsApp number goes direct to Meta's
      // Cloud API; every other workspace continues through Twilio, which is an
      // official Business Solution Provider and needs no Meta App Review.
      //
      // Chosen per workspace rather than per deployment, so one customer can
      // move without touching anybody else's messages — and checked on the send
      // rather than cached, so disconnecting takes effect immediately.
      if (
        request.channel === "whatsapp" &&
        (await usesWhatsAppCloudApi(request.businessId))
      ) {
        return sendWhatsApp(request);
      }

      if (request.channel === "linkedin") {
        return Promise.resolve({
          ok: false as const,
          errorCode: "channel_has_no_transport",
          errorMessage:
            "LinkedIn messages are not sent through a carrier. They are performed from the connected account via the social outreach queue.",
          // Permanent: retrying cannot make a transport exist.
          permanent: true,
        });
      }
      return carrier.send(request);
    },
    // Inbound and status callbacks here only ever come from the carrier: a
    // customer mailbox is polled, never posted to, and Meta has its own route.
    verifyWebhook: (request, rawBody) => carrier.verifyWebhook(request, rawBody),
    parseInbound: (rawBody) => carrier.parseInbound(rawBody),
    parseStatus: (rawBody) => carrier.parseStatus(rawBody),
  };
}

/**
 * Provider selection is explicit and logged: a workspace must never be left
 * guessing whether a message reached a carrier or a development sink.
 */
export function getMessagingProvider(): MessagingProvider {
  if (cached) return cached;

  const forced = serverEnv.messagingProvider?.toLowerCase();

  if (forced === "stub") {
    cached = withChannelRouting(createStubProvider());
    announce(cached, "forced by MESSAGING_PROVIDER");
    return cached;
  }

  if (forced === "twilio" || isTwilioConfigured()) {
    cached = withChannelRouting(createTwilioProvider());
    announce(
      cached,
      isTwilioConfigured()
        ? "Twilio credentials present"
        : `forced by MESSAGING_PROVIDER but missing ${twilioConfigProblems().join(", ")}`,
    );
    return cached;
  }

  // Unconfigured, and not explicitly asked for the stub.
  //
  // This used to fall through to `createStubProvider()`, which returns
  // `{ ok: true }` for every send. On a deployment where Twilio was not fully
  // configured — a missing `TWILIO_SMS_FROM` is enough — every SMS and WhatsApp
  // was written off as delivered and reached nobody. The UI showed SENT, the
  // customer saw follow-ups going out, and nothing anywhere disagreed.
  //
  // A development sink is a legitimate thing to want, which is why
  // `MESSAGING_PROVIDER=stub` still selects it. What is not legitimate is
  // *defaulting* to one: an unconfigured deployment must fail loudly, because a
  // send that silently vanishes is the one failure a customer cannot detect.
  const problems = twilioConfigProblems();

  if (isDevelopmentLike()) {
    cached = withChannelRouting(createStubProvider());
    announce(cached, `Twilio not configured: missing ${problems.join(", ")}`);
    return cached;
  }

  cached = withChannelRouting(createUnconfiguredProvider(problems));
  announce(cached, `refusing to send: missing ${problems.join(", ")}`);
  return cached;
}

/**
 * Whether falling back to a sink is acceptable here.
 *
 * Deliberately an allow-list of environments rather than "not production": a
 * new deployment target with an unset `NODE_ENV` would otherwise inherit the
 * silent-discard behaviour, which is the exact failure this exists to prevent.
 */
export function isDevelopmentLike(
  env: string = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "",
): boolean {
  return env === "development" || env === "test" || env === "preview";
}

/**
 * A transport that refuses every send with the reason it cannot make one.
 *
 * Failing is the point. The message stays QUEUED, the send guard records why,
 * the connection health check surfaces it, and somebody fixes the
 * configuration — all of which is better than a message nobody receives being
 * marked delivered.
 */
function createUnconfiguredProvider(problems: string[]): MessagingProvider {
  const detail = problems.join(", ") || "no messaging credentials";

  return {
    name: "unconfigured",
    async send() {
      return {
        ok: false as const,
        errorCode: "provider_not_configured",
        errorMessage: `Messaging is not configured on this deployment (${detail}). Nothing was sent.`,
        // Permanent: retrying cannot conjure credentials, and a retry loop
        // would bury the one error that explains the outage.
        permanent: true,
      };
    },
    async verifyWebhook() {
      return false;
    },
    async parseInbound() {
      return [];
    },
    async parseStatus() {
      return [];
    },
  };
}

/** Test seam. */
export function resetMessagingProvider() {
  cached = null;
  announced = false;
}
