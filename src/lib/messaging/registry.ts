import "server-only";
import { serverEnv } from "@/lib/env";
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
 * Provider selection is explicit and logged: a workspace must never be left
 * guessing whether a message reached a carrier or a development sink.
 */
export function getMessagingProvider(): MessagingProvider {
  if (cached) return cached;

  const forced = serverEnv.messagingProvider?.toLowerCase();

  if (forced === "stub") {
    cached = createStubProvider();
    announce(cached, "forced by MESSAGING_PROVIDER");
    return cached;
  }

  if (forced === "twilio" || isTwilioConfigured()) {
    cached = createTwilioProvider();
    announce(
      cached,
      isTwilioConfigured()
        ? "Twilio credentials present"
        : `forced by MESSAGING_PROVIDER but missing ${twilioConfigProblems().join(", ")}`,
    );
    return cached;
  }

  cached = createStubProvider();
  announce(cached, `Twilio not configured: missing ${twilioConfigProblems().join(", ")}`);
  return cached;
}

/** Test seam. */
export function resetMessagingProvider() {
  cached = null;
  announced = false;
}
