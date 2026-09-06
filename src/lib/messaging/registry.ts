import "server-only";
import { serverEnv } from "@/lib/env";
import { createEmailProvider } from "./email-provider";
import { createStubProvider } from "./stub";
import { createTwilioProvider, isTwilioConfigured, twilioConfigProblems } from "./twilio";
import type { MessagingProvider } from "./types";

let cached: MessagingProvider | null = null;
let announced = false;

function announce(provider: MessagingProvider, reason: string) {
  if (announced) return;
  announced = true;
  console.info(`[messaging] provider=${provider.name} (${reason})`);
}

/**
 * Routes each send to the transport that owns its channel: email goes out
 * through the workspace's own SMTP server, everything else through the
 * configured SMS/WhatsApp carrier. One object so `performSend` stays a single
 * guarded path rather than branching per channel at every call site.
 */
function withEmailRouting(carrier: MessagingProvider): MessagingProvider {
  const email = createEmailProvider();

  return {
    get name() {
      return carrier.name;
    },
    send(request) {
      return request.channel === "email"
        ? email.send(request)
        : carrier.send(request);
    },
    // Inbound and status callbacks only ever come from the carrier: a customer
    // mailbox is polled, never posted to.
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
    cached = withEmailRouting(createStubProvider());
    announce(cached, "forced by MESSAGING_PROVIDER");
    return cached;
  }

  if (forced === "twilio" || isTwilioConfigured()) {
    cached = withEmailRouting(createTwilioProvider());
    announce(
      cached,
      isTwilioConfigured()
        ? "Twilio credentials present"
        : `forced by MESSAGING_PROVIDER but missing ${twilioConfigProblems().join(", ")}`,
    );
    return cached;
  }

  cached = withEmailRouting(createStubProvider());
  announce(cached, `Twilio not configured: missing ${twilioConfigProblems().join(", ")}`);
  return cached;
}

/** Test seam. */
export function resetMessagingProvider() {
  cached = null;
  announced = false;
}
