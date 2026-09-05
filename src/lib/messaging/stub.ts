import type {
  InboundMessage,
  MessageStatusEvent,
  MessagingProvider,
  SendRequest,
  SendResult,
} from "./types";

export type StubSend = SendRequest & { sentAt: string };

/**
 * Development provider. It performs no network I/O and accepts every send, so
 * the whole pipeline — queue, guards, status transitions, metering — is
 * exercisable end to end without carrier credentials.
 */
export class StubMessagingProvider implements MessagingProvider {
  readonly name = "stub";
  readonly outbox: StubSend[] = [];

  async send(request: SendRequest): Promise<SendResult> {
    this.outbox.push({ ...request, sentAt: new Date().toISOString() });
    console.info(
      `[messaging:stub] would send ${request.channel} to ${request.to} (send_key=${request.sendKey}): ${request.body}`,
    );
    return {
      ok: true,
      providerMessageId: `stub-${request.sendKey}`,
      provider: "stub",
    };
  }

  /** No signature to check, and nothing signs stub traffic. */
  async verifyWebhook(): Promise<boolean> {
    return false;
  }

  async parseInbound(rawBody: string): Promise<InboundMessage[]> {
    const parsed = safeParse(rawBody);
    if (!parsed) return [];
    return [
      {
        provider: "stub",
        providerMessageId: String(parsed.providerMessageId ?? crypto.randomUUID()),
        from: String(parsed.from ?? ""),
        to: String(parsed.to ?? ""),
        body: String(parsed.body ?? ""),
        channel: parsed.channel === "whatsapp" ? "whatsapp" : "sms",
        receivedAt: new Date().toISOString(),
      },
    ];
  }

  async parseStatus(): Promise<MessageStatusEvent[]> {
    return [];
  }
}

function safeParse(rawBody: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(rawBody) as unknown;
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createStubProvider(): StubMessagingProvider {
  return new StubMessagingProvider();
}
