import "server-only";

/**
 * Twilio adapter: TelephonyProvider + NumberProvider. A stub against the
 * documented REST shapes; not wired into any job or route in this phase, and
 * tests inject `fetch` (no network).
 *
 * Tenant model: one Twilio SUBACCOUNT per workspace (tenant isolation, number
 * reputation and cost attribution). The parent credentials (TWILIO_ACCOUNT_SID
 * = AC..., TWILIO_AUTH_TOKEN) operate on subaccount resources under
 * `/2010-04-01/Accounts/{SubSid}/...`. A subaccount's own auth token is never
 * stored in plaintext: when a request needs it (the numbers/messaging v1/v2
 * hosts, and verifying webhooks for its numbers) it is read from
 * `GET /Accounts/{SubSid}.json` with the parent credentials and held in
 * memory for that request only. (Alternative for the schema: sealed with
 * security/secret-box.ts; see 13-voice-schema-draft.sql.)
 *
 * Verified 2026-09-27:
 *   - UK mobile numbers (Twilio regulatory guideline page for GB): business
 *     end users need Business Name, Registration Authority, Business
 *     Registration Number, Website, Business Address (any country for
 *     mobile; UK-only for local), an Authorised Representative (name, phone,
 *     work email), Business Classification (Direct Customer or ISV/Reseller)
 *     and ISV assignment intent. No supporting documents are required. An
 *     address IS required. No review time is published.
 *   - Bundles API: POST numbers.twilio.com/v2/RegulatoryCompliance/Bundles
 *     (FriendlyName, Email, StatusCallback, IsoCountry, NumberType,
 *     EndUserType); submit by updating Status=pending-review; statuses draft,
 *     pending-review, in-review, twilio-approved, twilio-rejected,
 *     provisionally-approved; the status callback posts AccountSid, BundleSid,
 *     Status, FailureReason. Item Assignments attach End Users and Supporting
 *     Documents.
 *
 * UNVERIFIED (well-known but not re-read for this phase, or not found):
 *   - End User `Attributes` key names for the GB mobile regulation (the keys
 *     below follow Twilio's snake_case convention);
 *   - how an Address is attached to a bundle (here: a Supporting Document of
 *     type `business_address` carrying `address_sids`);
 *   - whether the v2 Regulatory and v1 Messaging hosts accept parent
 *     credentials for a subaccount (here: the subaccount's own token);
 *   - the Pricing v2 response shape used by `lookupRatePerMinuteUsd`;
 *   - Twilio error 21712 as "number already in this Messaging Service";
 *   - typical UK bundle approval time (not published).
 *
 * Voice path to Retell (UNVERIFIED, later phase): the number is imported into
 * Retell against an Elastic SIP trunk, or its VoiceUrl returns TwiML that
 * dials Retell's SIP endpoint. `configure` sets VoiceUrl to OUR webhook so the
 * route can decide (entitlement, inbound matching) before handing off.
 */

import {
  formBody,
  isAccountSid,
  mapTwilioBundleStatus,
  parseTwilioWebhook,
  TWILIO_API_BASE,
  TWILIO_MESSAGING_BASE,
  TWILIO_NUMBERS_BASE,
  verifyTwilioSignature,
} from "./twilio-protocol.ts";
import {
  ProviderNotConfigured,
  ProviderRequestError,
  type AvailableNumber,
  type BundleStatus,
  type BundleSubmission,
  type NumberProvider,
  type OwnedNumber,
  type TelephonyProvider,
  type VoiceEvent,
  type WebhookInput,
} from "./types.ts";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type TwilioVoiceOptions = {
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
};

type Creds = { sid: string; token: string };

export function twilioVoiceConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const sid = env.TWILIO_ACCOUNT_SID ?? env.TWILIO_SID;
  const token = env.TWILIO_AUTH_TOKEN ?? env.TWILIO_CLIENT_SECRET;
  return isAccountSid(sid) && !!token;
}

type RawNumber = {
  sid?: string;
  phone_number?: string;
  capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean; SMS?: boolean; MMS?: boolean };
  voice_url?: string | null;
  status_callback?: string | null;
  bundle_sid?: string | null;
};

function toOwned(n: RawNumber, messagingServiceSid: string | null = null): OwnedNumber {
  const c = n.capabilities ?? {};
  return {
    phoneNumberSid: n.sid ?? "",
    e164: n.phone_number ?? "",
    capabilities: { voice: !!c.voice, sms: !!(c.sms ?? c.SMS), mms: !!(c.mms ?? c.MMS) },
    voiceUrl: n.voice_url ?? null,
    statusCallbackUrl: n.status_callback ?? null,
    messagingServiceSid,
    bundleSid: n.bundle_sid ?? null,
  };
}

export function createTwilioVoiceProvider(opts: TwilioVoiceOptions = {}): TelephonyProvider & NumberProvider {
  const env = opts.env ?? process.env;
  const doFetch: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);

  function parent(): Creds {
    const sid = env.TWILIO_ACCOUNT_SID ?? env.TWILIO_SID;
    const token = env.TWILIO_AUTH_TOKEN ?? env.TWILIO_CLIENT_SECRET;
    const missing: string[] = [];
    // An SK... value in the account slot is the F7/20404 failure: refuse it.
    if (!isAccountSid(sid)) missing.push("TWILIO_ACCOUNT_SID (AC...)");
    if (!token) missing.push("TWILIO_AUTH_TOKEN");
    if (missing.length) throw new ProviderNotConfigured("twilio", missing);
    return { sid: sid as string, token: token as string };
  }

  async function request(creds: Creds, method: string, url: string, params?: Record<string, string | number | boolean | null | undefined>) {
    const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString("base64");
    const headers: Record<string, string> = { Authorization: `Basic ${auth}` };
    let body: string | undefined;
    let target = url;
    if (params && method === "GET") {
      const q = formBody(params);
      if (q) target = `${url}?${q}`;
    } else if (params) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = formBody(params);
    }
    const res = await doFetch(target, { method, headers, body });
    if (!res.ok) {
      let code: string | null = null;
      let message = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { code?: number; message?: string };
        if (j?.code != null) code = String(j.code);
        if (j?.message) message = j.message;
      } catch {
        /* keep the status */
      }
      throw new ProviderRequestError("twilio", res.status, message, code);
    }
    return res.status === 204 ? null : ((await res.json()) as Record<string, unknown>);
  }

  const acct = (sub: string) => `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(sub)}`;

  /** The subaccount's token, read with parent credentials, never persisted. */
  async function subCreds(accountSid: string): Promise<Creds> {
    const p = parent();
    if (accountSid === p.sid) return p;
    const r = (await request(p, "GET", `${acct(accountSid)}.json`)) as { auth_token?: string } | null;
    if (!r?.auth_token) throw new ProviderRequestError("twilio", 502, "subaccount has no readable auth token");
    return { sid: accountSid, token: r.auth_token };
  }

  return {
    name: "twilio",

    // ------------------------------------------------------------ telephony
    async endCall({ accountSid, callSid }) {
      await request(parent(), "POST", `${acct(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`, { Status: "completed" });
    },

    async getCallStatus({ accountSid, callSid }) {
      const r = (await request(parent(), "GET", `${acct(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`)) as {
        status?: string;
        duration?: string | null;
      };
      return { status: r?.status ?? "unknown", durationSec: r?.duration && /^\d+$/.test(r.duration) ? Number(r.duration) : null };
    },

    async lookupRatePerMinuteUsd(e164: string) {
      // UNVERIFIED response shape: { outbound_call_prices: [{ current_price }] }.
      const r = (await request(parent(), "GET", `https://pricing.twilio.com/v2/Voice/Numbers/${encodeURIComponent(e164)}`)) as {
        outbound_call_prices?: { current_price?: string | number }[];
      } | null;
      const prices = (r?.outbound_call_prices ?? []).map((p) => Number(p.current_price)).filter((n) => Number.isFinite(n));
      return prices.length ? Math.max(...prices) : null;
    },

    verifyWebhook(input: WebhookInput & { authToken: string }) {
      if (!input.url) return false;
      const params: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(input.rawBody)) params[k] = v;
      return verifyTwilioSignature(input.authToken, input.url, params, input.headers["x-twilio-signature"]);
    },

    parseWebhook(input: WebhookInput): VoiceEvent[] {
      return parseTwilioWebhook(input.rawBody);
    },

    // -------------------------------------------------------------- numbers
    async subaccountAuthToken(accountSid: string) {
      // GET /Accounts/{Sid}.json with the parent credentials returns the
      // subaccount's auth_token (the same read subCreds uses).
      const c = await subCreds(accountSid);
      return c.sid === accountSid ? c.token : null;
    },

    async createSubaccount({ friendlyName }) {
      const p = parent();
      const found = (await request(p, "GET", `${TWILIO_API_BASE}/Accounts.json`, { FriendlyName: friendlyName, Status: "active" })) as {
        accounts?: { sid?: string }[];
      } | null;
      const existing = found?.accounts?.find((a) => a.sid && a.sid !== p.sid);
      if (existing?.sid) return { accountSid: existing.sid, created: false };
      const r = (await request(p, "POST", `${TWILIO_API_BASE}/Accounts.json`, { FriendlyName: friendlyName })) as { sid?: string } | null;
      if (!r?.sid) throw new ProviderRequestError("twilio", 502, "account create returned no sid");
      return { accountSid: r.sid, created: true };
    },

    async submitRegulatoryBundle(s: BundleSubmission) {
      const c = await subCreds(s.accountSid);
      const eu = s.endUser;
      const endUser = (await request(c, "POST", `${TWILIO_NUMBERS_BASE}/RegulatoryCompliance/EndUsers`, {
        FriendlyName: `${s.friendlyName} end user`,
        Type: "business",
        // UNVERIFIED attribute keys.
        Attributes: JSON.stringify({
          business_name: eu.businessName,
          business_registration_authority: eu.registrationAuthority,
          business_registration_number: eu.businessRegistrationNumber,
          website_url: eu.websiteUrl,
          business_identity: eu.businessClassification === "DIRECT_CUSTOMER" ? "direct_customer" : "isv_reseller_or_partner",
          first_name: eu.representative.firstName,
          last_name: eu.representative.lastName,
          phone_number: eu.representative.phoneE164,
          email: eu.representative.workEmail,
        }),
      })) as { sid?: string };
      const a = s.address;
      const address = (await request(parent(), "POST", `${acct(s.accountSid)}/Addresses.json`, {
        CustomerName: a.customerName,
        Street: a.street,
        StreetSecondary: a.streetSecondary,
        City: a.city,
        Region: a.region ?? a.city,
        PostalCode: a.postalCode,
        IsoCountry: a.isoCountry,
      })) as { sid?: string };
      const bundle = (await request(c, "POST", `${TWILIO_NUMBERS_BASE}/RegulatoryCompliance/Bundles`, {
        FriendlyName: s.friendlyName,
        Email: s.notificationEmail,
        StatusCallback: s.statusCallbackUrl,
        IsoCountry: s.isoCountry,
        NumberType: s.numberType,
        EndUserType: s.endUserType,
      })) as { sid?: string };
      if (!endUser?.sid || !address?.sid || !bundle?.sid) throw new ProviderRequestError("twilio", 502, "bundle submission returned no sid");
      const assign = (objectSid: string) =>
        request(c, "POST", `${TWILIO_NUMBERS_BASE}/RegulatoryCompliance/Bundles/${bundle.sid}/ItemAssignments`, { ObjectSid: objectSid });
      await assign(endUser.sid);
      // UNVERIFIED: address attached through a supporting document.
      const doc = (await request(c, "POST", `${TWILIO_NUMBERS_BASE}/RegulatoryCompliance/SupportingDocuments`, {
        FriendlyName: `${s.friendlyName} address`,
        Type: "business_address",
        Attributes: JSON.stringify({ address_sids: [address.sid] }),
      })) as { sid?: string };
      if (doc?.sid) await assign(doc.sid);
      const submitted = (await request(c, "POST", `${TWILIO_NUMBERS_BASE}/RegulatoryCompliance/Bundles/${bundle.sid}`, {
        Status: "pending-review",
      })) as { status?: string };
      return {
        bundleSid: bundle.sid,
        addressSid: address.sid,
        endUserSid: endUser.sid,
        status: mapTwilioBundleStatus(submitted?.status ?? "pending-review"),
      };
    },

    async getBundleStatus({ accountSid, bundleSid }) {
      const c = await subCreds(accountSid);
      const r = (await request(c, "GET", `${TWILIO_NUMBERS_BASE}/RegulatoryCompliance/Bundles/${encodeURIComponent(bundleSid)}`)) as {
        status?: string;
        failure_reason?: string | null;
      };
      return { status: mapTwilioBundleStatus(r?.status) as BundleStatus, failureReason: r?.failure_reason ?? null };
    },

    async searchAvailable({ accountSid, smsEnabled, voiceEnabled, limit }) {
      const r = (await request(parent(), "GET", `${acct(accountSid)}/AvailablePhoneNumbers/GB/Mobile.json`, {
        SmsEnabled: smsEnabled,
        VoiceEnabled: voiceEnabled,
        PageSize: limit,
      })) as { available_phone_numbers?: { phone_number?: string; locality?: string | null; capabilities?: RawNumber["capabilities"] }[] };
      return (r?.available_phone_numbers ?? [])
        .filter((n) => n.phone_number)
        .map<AvailableNumber>((n) => ({
          e164: n.phone_number as string,
          locality: n.locality ?? null,
          capabilities: {
            voice: !!n.capabilities?.voice,
            sms: !!(n.capabilities?.sms ?? n.capabilities?.SMS),
            mms: !!(n.capabilities?.mms ?? n.capabilities?.MMS),
          },
        }));
    },

    async purchase({ accountSid, e164, bundleSid, addressSid }) {
      const r = (await request(parent(), "POST", `${acct(accountSid)}/IncomingPhoneNumbers.json`, {
        PhoneNumber: e164,
        BundleSid: bundleSid,
        AddressSid: addressSid,
      })) as RawNumber;
      return toOwned(r);
    },

    async ensureMessagingService({ accountSid, friendlyName, inboundUrl }) {
      const c = await subCreds(accountSid);
      const list = (await request(c, "GET", `${TWILIO_MESSAGING_BASE}/Services`, { PageSize: 50 })) as {
        services?: { sid?: string; friendly_name?: string }[];
      };
      const hit = list?.services?.find((s) => s.friendly_name === friendlyName && s.sid);
      if (hit?.sid) return { messagingServiceSid: hit.sid };
      const r = (await request(c, "POST", `${TWILIO_MESSAGING_BASE}/Services`, {
        FriendlyName: friendlyName,
        InboundRequestUrl: inboundUrl,
        InboundMethod: "POST",
      })) as { sid?: string };
      if (!r?.sid) throw new ProviderRequestError("twilio", 502, "messaging service create returned no sid");
      return { messagingServiceSid: r.sid };
    },

    async configure({ accountSid, phoneNumberSid, voiceUrl, statusCallbackUrl, messagingServiceSid }) {
      const r = (await request(parent(), "POST", `${acct(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`, {
        VoiceUrl: voiceUrl,
        VoiceMethod: "POST",
        StatusCallback: statusCallbackUrl,
        StatusCallbackMethod: "POST",
      })) as RawNumber;
      const c = await subCreds(accountSid);
      try {
        await request(c, "POST", `${TWILIO_MESSAGING_BASE}/Services/${encodeURIComponent(messagingServiceSid)}/PhoneNumbers`, {
          PhoneNumberSid: phoneNumberSid,
        });
      } catch (e) {
        // Already in this service: idempotent re-run (UNVERIFIED code 21712).
        if (!(e instanceof ProviderRequestError && (e.code === "21712" || e.status === 409))) throw e;
      }
      return toOwned(r, messagingServiceSid);
    },

    async release({ accountSid, phoneNumberSid }) {
      try {
        await request(parent(), "DELETE", `${acct(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`);
      } catch (e) {
        if (e instanceof ProviderRequestError && e.status === 404) return; // already released
        throw e;
      }
    },

    async list({ accountSid }) {
      const r = (await request(parent(), "GET", `${acct(accountSid)}/IncomingPhoneNumbers.json`, { PageSize: 50 })) as {
        incoming_phone_numbers?: RawNumber[];
      };
      return (r?.incoming_phone_numbers ?? []).map((n) => toOwned(n));
    },
  };
}
