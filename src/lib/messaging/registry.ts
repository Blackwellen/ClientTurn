import "server-only";
import { serverEnv } from "@/lib/env";
import { createEmailProvider } from "./email-provider";
import { createStubProvider } from "./stub";
import { createMetaProvider } from "./meta";
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
    send(request) {
      if (request.channel === "email") return email.send(request);
      if (isMetaChannel(request.channel)) return meta.send(request);
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

  cached = withChannelRouting(createStubProvider());
  announce(cached, `Twilio not configured: missing ${twilioConfigProblems().join(", ")}`);
  return cached;
}

/** Test seam. */
export function resetMessagingProvider() {
  cached = null;
  announced = false;
}
