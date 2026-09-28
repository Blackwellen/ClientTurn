/**
 * In-memory fakes of the three provider roles, for tests and local
 * development. Deterministic ids, a call log, failure injection
 * (`failNext`), and controllable bundle review.
 *
 * Webhook signature for the fakes: header `x-fake-signature` =
 * hex HMAC-SHA256(secret, raw body). `signFake` produces it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ProviderRequestError,
  voiceEventSchema,
  type AvailableNumber,
  type BundleStatus,
  type BundleSubmission,
  type NumberProvider,
  type OutboundCallRequest,
  type OwnedNumber,
  type ProviderCallDetails,
  type ProviderCallStatus,
  type TelephonyProvider,
  type VoiceAgentConfig,
  type VoiceEvent,
  type VoiceProvider,
  type WebhookInput,
} from "./types.ts";

export function signFake(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function verifyFake(secret: string, input: WebhookInput): boolean {
  const sig = input.headers["x-fake-signature"];
  if (!sig) return false;
  const a = Buffer.from(signFake(secret, input.rawBody));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fake webhook bodies are JSON arrays of VoiceEvents; each is validated. */
function parseFake(rawBody: string): VoiceEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.flatMap((e) => {
    const r = voiceEventSchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
}

class FailureInjector {
  private failures = new Map<string, Error[]>();
  failNext(method: string, error: Error = new ProviderRequestError("fake", 503, `${method} failed`)): void {
    const q = this.failures.get(method) ?? [];
    q.push(error);
    this.failures.set(method, q);
  }
  check(method: string): void {
    const q = this.failures.get(method);
    if (q && q.length) throw q.shift() as Error;
  }
}

// ------------------------------------------------------------------- voice

export class FakeVoiceProvider implements VoiceProvider {
  readonly name = "fake" as const;
  readonly secret: string;
  readonly agents = new Map<string, VoiceAgentConfig>();
  readonly calls = new Map<string, ProviderCallDetails & { request: OutboundCallRequest }>();
  readonly log: { method: string; arg: unknown }[] = [];
  private seq = 0;
  private faults = new FailureInjector();

  constructor(secret = "fake-secret") {
    this.secret = secret;
  }

  failNext(method: string, error?: Error): void {
    this.faults.failNext(method, error);
  }

  async upsertAgent(config: VoiceAgentConfig): Promise<{ agentId: string }> {
    this.log.push({ method: "upsertAgent", arg: config });
    this.faults.check("upsertAgent");
    const agentId = config.agentId ?? `agent_${++this.seq}`;
    this.agents.set(agentId, { ...config, agentId });
    return { agentId };
  }

  async startOutboundCall(req: OutboundCallRequest): Promise<{ providerCallId: string; status: ProviderCallStatus }> {
    this.log.push({ method: "startOutboundCall", arg: req });
    this.faults.check("startOutboundCall");
    // Idempotent on the call key, like a provider honouring an idempotency key.
    for (const c of this.calls.values()) {
      if (c.request.callKey === req.callKey) return { providerCallId: c.providerCallId, status: c.status };
    }
    const providerCallId = `call_${++this.seq}`;
    this.calls.set(providerCallId, {
      providerCallId,
      status: "REGISTERED",
      startedAt: null,
      endedAt: null,
      durationSec: null,
      outcome: null,
      disconnectionReason: null,
      transcript: [],
      recordingUrl: null,
      costCents: null,
      metadata: { ...req.metadata, call_key: req.callKey },
      request: req,
    });
    return { providerCallId, status: "REGISTERED" };
  }

  async endCall(providerCallId: string): Promise<void> {
    this.log.push({ method: "endCall", arg: providerCallId });
    this.faults.check("endCall");
    const c = this.calls.get(providerCallId);
    if (c && c.status !== "ENDED") {
      c.status = "ENDED";
      c.outcome = "COMPLETED";
      c.disconnectionReason = "agent_hangup";
    }
  }

  async getCall(providerCallId: string): Promise<ProviderCallDetails> {
    this.faults.check("getCall");
    const c = this.calls.get(providerCallId);
    if (!c) throw new ProviderRequestError("fake", 404, "no such call");
    const details: ProviderCallDetails & { request?: OutboundCallRequest } = { ...c };
    delete details.request;
    return details;
  }

  verifyWebhook(input: WebhookInput): boolean {
    return verifyFake(this.secret, input);
  }

  parseWebhook(input: WebhookInput): VoiceEvent[] {
    return parseFake(input.rawBody);
  }
}

// --------------------------------------------------------------- telephony

export class FakeTelephonyProvider implements TelephonyProvider {
  readonly name = "fake" as const;
  readonly ended: string[] = [];
  /** e164 -> USD/min; absent = null (no price). */
  readonly rates = new Map<string, number>();
  private faults = new FailureInjector();

  failNext(method: string, error?: Error): void {
    this.faults.failNext(method, error);
  }
  async endCall({ callSid }: { accountSid: string; callSid: string }): Promise<void> {
    this.faults.check("endCall");
    this.ended.push(callSid);
  }
  async getCallStatus({ callSid }: { accountSid: string; callSid: string }) {
    this.faults.check("getCallStatus");
    return { status: this.ended.includes(callSid) ? "completed" : "in-progress", durationSec: null };
  }
  async lookupRatePerMinuteUsd(e164: string): Promise<number | null> {
    this.faults.check("lookupRatePerMinuteUsd");
    return this.rates.get(e164) ?? null;
  }
  verifyWebhook(input: WebhookInput & { authToken: string }): boolean {
    return verifyFake(input.authToken, input);
  }
  parseWebhook(input: WebhookInput): VoiceEvent[] {
    return parseFake(input.rawBody);
  }
}

// ----------------------------------------------------------------- numbers

type FakeBundle = { sid: string; accountSid: string; status: BundleStatus; failureReason: string | null; submission: BundleSubmission };

export class FakeNumberProvider implements NumberProvider {
  readonly name = "fake" as const;
  readonly subaccounts = new Map<string, string>(); // friendlyName -> sid
  readonly bundles = new Map<string, FakeBundle>();
  readonly owned = new Map<string, OwnedNumber & { accountSid: string }>(); // phoneNumberSid -> number
  readonly messagingServices = new Map<string, { sid: string; accountSid: string; numbers: Set<string> }>(); // name -> svc
  /** Numbers the fake "carrier" has available to buy. */
  inventory: AvailableNumber[];
  readonly released: string[] = [];
  readonly log: { method: string; arg: unknown }[] = [];
  /** Status a newly submitted bundle lands in. */
  submitLandsIn: BundleStatus = "PENDING_REVIEW";
  private seq = 0;
  private faults = new FailureInjector();

  constructor(inventory?: AvailableNumber[]) {
    this.inventory = inventory ?? [
      { e164: "+447700900001", capabilities: { voice: true, sms: true, mms: false }, locality: null },
      { e164: "+447700900002", capabilities: { voice: true, sms: false, mms: false }, locality: null },
      { e164: "+447700900003", capabilities: { voice: true, sms: true, mms: true }, locality: null },
    ];
  }

  failNext(method: string, error?: Error): void {
    this.faults.failNext(method, error);
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}${String(this.seq).padStart(32, "0")}`;
  }

  /** Test control: move a bundle through review. */
  setBundleStatus(bundleSid: string, status: BundleStatus, failureReason: string | null = null): void {
    const b = this.bundles.get(bundleSid);
    if (!b) throw new Error(`no bundle ${bundleSid}`);
    b.status = status;
    b.failureReason = failureReason;
  }

  /** A deterministic fake token per subaccount (voice P3: stored sealed, never real). */
  async subaccountAuthToken(accountSid: string) {
    this.log.push({ method: "subaccountAuthToken", arg: accountSid });
    this.faults.check("subaccountAuthToken");
    return `fake-token-${accountSid.slice(-6)}`;
  }

  async createSubaccount({ friendlyName }: { friendlyName: string }) {
    this.log.push({ method: "createSubaccount", arg: friendlyName });
    this.faults.check("createSubaccount");
    const existing = this.subaccounts.get(friendlyName);
    if (existing) return { accountSid: existing, created: false };
    const sid = this.id("AC");
    this.subaccounts.set(friendlyName, sid);
    return { accountSid: sid, created: true };
  }

  async submitRegulatoryBundle(input: BundleSubmission) {
    this.log.push({ method: "submitRegulatoryBundle", arg: input });
    this.faults.check("submitRegulatoryBundle");
    const sid = this.id("BU");
    this.bundles.set(sid, { sid, accountSid: input.accountSid, status: this.submitLandsIn, failureReason: null, submission: input });
    return { bundleSid: sid, addressSid: this.id("AD"), endUserSid: this.id("IT"), status: this.submitLandsIn };
  }

  async getBundleStatus({ bundleSid }: { accountSid: string; bundleSid: string }) {
    this.faults.check("getBundleStatus");
    const b = this.bundles.get(bundleSid);
    if (!b) throw new ProviderRequestError("fake", 404, "no such bundle");
    return { status: b.status, failureReason: b.failureReason };
  }

  async searchAvailable(input: { accountSid: string; isoCountry: "GB"; type: "mobile"; smsEnabled: boolean; voiceEnabled: boolean; limit: number }) {
    this.log.push({ method: "searchAvailable", arg: input });
    this.faults.check("searchAvailable");
    return this.inventory
      .filter((n) => (!input.smsEnabled || n.capabilities.sms) && (!input.voiceEnabled || n.capabilities.voice))
      .slice(0, input.limit);
  }

  async purchase({ accountSid, e164, bundleSid }: { accountSid: string; e164: string; bundleSid: string; addressSid: string }) {
    this.log.push({ method: "purchase", arg: e164 });
    this.faults.check("purchase");
    const b = this.bundles.get(bundleSid);
    if (!b || b.status !== "APPROVED") throw new ProviderRequestError("fake", 400, "bundle not approved", "21649");
    const idx = this.inventory.findIndex((n) => n.e164 === e164);
    if (idx < 0) throw new ProviderRequestError("fake", 400, "number no longer available", "21422");
    const [n] = this.inventory.splice(idx, 1);
    const owned: OwnedNumber & { accountSid: string } = {
      accountSid,
      phoneNumberSid: this.id("PN"),
      e164: n.e164,
      capabilities: n.capabilities,
      voiceUrl: null,
      statusCallbackUrl: null,
      messagingServiceSid: null,
      bundleSid,
    };
    this.owned.set(owned.phoneNumberSid, owned);
    return owned;
  }

  async ensureMessagingService({ accountSid, friendlyName }: { accountSid: string; friendlyName: string; inboundUrl: string }) {
    this.faults.check("ensureMessagingService");
    const existing = this.messagingServices.get(friendlyName);
    if (existing) return { messagingServiceSid: existing.sid };
    const sid = this.id("MG");
    this.messagingServices.set(friendlyName, { sid, accountSid, numbers: new Set() });
    return { messagingServiceSid: sid };
  }

  async configure(input: { accountSid: string; phoneNumberSid: string; voiceUrl: string; statusCallbackUrl: string; messagingServiceSid: string }) {
    this.log.push({ method: "configure", arg: input });
    this.faults.check("configure");
    const n = this.owned.get(input.phoneNumberSid);
    if (!n) throw new ProviderRequestError("fake", 404, "no such number");
    n.voiceUrl = input.voiceUrl;
    n.statusCallbackUrl = input.statusCallbackUrl;
    n.messagingServiceSid = input.messagingServiceSid;
    for (const svc of this.messagingServices.values()) if (svc.sid === input.messagingServiceSid) svc.numbers.add(n.phoneNumberSid);
    return { ...n };
  }

  async release({ phoneNumberSid }: { accountSid: string; phoneNumberSid: string }) {
    this.log.push({ method: "release", arg: phoneNumberSid });
    this.faults.check("release");
    if (this.owned.delete(phoneNumberSid)) this.released.push(phoneNumberSid);
  }

  async list({ accountSid }: { accountSid: string }) {
    this.faults.check("list");
    return [...this.owned.values()]
      .filter((n) => n.accountSid === accountSid)
      .map((n) => {
        const copy: OwnedNumber & { accountSid?: string } = { ...n };
        delete copy.accountSid;
        return copy;
      });
  }
}
