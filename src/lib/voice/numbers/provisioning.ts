/**
 * Dedicated-number provisioning: a pure state machine per workspace plus a
 * job-step driver over an injected NumberProvider. Fully automated: nothing
 * here waits for a person at ClientTurn. The only human input is the
 * workspace's own details (provisioning-details.ts), given once in Settings,
 * and a fix to them if Twilio rejects the bundle.
 *
 *   NOT_REQUESTED -> DETAILS_REQUIRED -> SUBACCOUNT_CREATED -> BUNDLE_SUBMITTED
 *     -> BUNDLE_IN_REVIEW -> BUNDLE_APPROVED | BUNDLE_REJECTED(reason, fixable)
 *   BUNDLE_REJECTED(fixable) + changed details -> BUNDLE_SUBMITTED (resubmit)
 *   BUNDLE_APPROVED -> NUMBER_SEARCHING -> NUMBER_PURCHASED
 *     -> CONFIGURED (voice webhook + the workspace Messaging Service) -> ACTIVE
 *   ACTIVE -> RELEASE_SCHEDULED -> RELEASED -> QUARANTINED -> NOT_REQUESTED
 *
 * Retry safety. The driver is run by a job (never by a browser request); each
 * run performs at most ONE provider step and re-reads the record first. Every
 * step is idempotent:
 *   - the subaccount is found by its friendly name before one is created;
 *   - before buying, the subaccount's numbers are listed and an already-bought
 *     number is adopted (a crash between purchase and persist never buys twice);
 *   - the Messaging Service is found by name before one is created, and adding
 *     a number already in it is a no-op;
 *   - release treats "already gone" as done;
 *   - a rejected bundle is resubmitted only when the reviewed details changed
 *     (their fingerprint differs), so a retry loop never resubmits rejected data.
 * Known gap: a crash between bundle creation and persisting its sid can leave a
 * draft bundle at Twilio; the next run submits a fresh one. A later phase can
 * add a find-by-friendly-name lookup for bundles (UNVERIFIED API filter).
 *
 * Quarantine. After release the e164 is held for `quarantineDays` (default
 * 90): inbound calls and SMS to it resolve to NO workspace (sender.ts), and the
 * number picker refuses it for any workspace, so a former tenant's leads can
 * never reach a new tenant.
 */

import { classifyDestination } from "../destinations.ts";
import { ProviderRequestError, type AvailableNumber, type BundleStatus, type NumberProvider } from "../providers/types.ts";
import { detailsFingerprint, provisioningReadiness, toBundleSubmission, type DetailsProblem } from "./provisioning-details.ts";

export const PROVISIONING_STATES = [
  "NOT_REQUESTED",
  "DETAILS_REQUIRED",
  "SUBACCOUNT_CREATED",
  "BUNDLE_SUBMITTED",
  "BUNDLE_IN_REVIEW",
  "BUNDLE_APPROVED",
  "BUNDLE_REJECTED",
  "NUMBER_SEARCHING",
  "NUMBER_PURCHASED",
  "CONFIGURED",
  "ACTIVE",
  "RELEASE_SCHEDULED",
  "RELEASED",
  "QUARANTINED",
] as const;
export type ProvisioningState = (typeof PROVISIONING_STATES)[number];

export const DEFAULT_QUARANTINE_DAYS = 90;
export const MAX_STEP_ATTEMPTS = 8;

export type ProvisioningRecord = {
  businessId: string;
  state: ProvisioningState;
  subaccountSid: string | null;
  bundleSid: string | null;
  addressSid: string | null;
  endUserSid: string | null;
  bundleStatus: BundleStatus | null;
  submittedFingerprint: string | null;
  rejection: { reason: string; fixable: boolean; fingerprint: string | null } | null;
  phoneNumberSid: string | null;
  e164: string | null;
  messagingServiceSid: string | null;
  purchasedAt: string | null;
  configuredAt: string | null;
  activatedAt: string | null;
  releaseAfter: string | null;
  releasedAt: string | null;
  quarantineUntil: string | null;
  /** Consecutive failures of the current step. */
  attempts: number;
  lastError: string | null;
  needsAttention: boolean;
  /** Optimistic-concurrency version; bumped on every applied event. */
  version: number;
};

export function newProvisioningRecord(businessId: string): ProvisioningRecord {
  return {
    businessId,
    state: "NOT_REQUESTED",
    subaccountSid: null,
    bundleSid: null,
    addressSid: null,
    endUserSid: null,
    bundleStatus: null,
    submittedFingerprint: null,
    rejection: null,
    phoneNumberSid: null,
    e164: null,
    messagingServiceSid: null,
    purchasedAt: null,
    configuredAt: null,
    activatedAt: null,
    releaseAfter: null,
    releasedAt: null,
    quarantineUntil: null,
    attempts: 0,
    lastError: null,
    needsAttention: false,
    version: 0,
  };
}

// ------------------------------------------------------------------ events

export type ProvisioningEvent =
  | { type: "REQUEST" }
  | { type: "CANCEL" }
  | { type: "SUBACCOUNT_CREATED"; accountSid: string }
  | { type: "BUNDLE_SUBMITTED"; bundleSid: string; addressSid: string; endUserSid: string; fingerprint: string }
  | { type: "BUNDLE_STATUS"; bundleSid: string; status: BundleStatus; failureReason: string | null }
  | { type: "SEARCH_STARTED" }
  | { type: "NUMBER_PURCHASED"; phoneNumberSid: string; e164: string; at: string }
  | { type: "CONFIGURED"; messagingServiceSid: string; at: string }
  | { type: "ACTIVATED"; at: string }
  | { type: "CONFIGURATION_DRIFT"; error: string }
  | { type: "SCHEDULE_RELEASE"; releaseAfter: string }
  | { type: "CANCEL_RELEASE" }
  | { type: "RELEASED"; at: string }
  | { type: "QUARANTINED"; until: string }
  | { type: "QUARANTINE_ENDED" }
  | { type: "STEP_FAILED"; error: string; permanent: boolean };

export class IllegalProvisioningTransition extends Error {
  readonly from: ProvisioningState;
  readonly event: ProvisioningEvent["type"];
  constructor(from: ProvisioningState, event: ProvisioningEvent["type"], why = "") {
    super(`Provisioning event ${event} is not allowed in ${from}${why ? `: ${why}` : ""}`);
    this.name = "IllegalProvisioningTransition";
    this.from = from;
    this.event = event;
  }
}

const CANCELLABLE: readonly ProvisioningState[] = [
  "DETAILS_REQUIRED",
  "SUBACCOUNT_CREATED",
  "BUNDLE_SUBMITTED",
  "BUNDLE_IN_REVIEW",
  "BUNDLE_APPROVED",
  "BUNDLE_REJECTED",
  "NUMBER_SEARCHING",
];

/**
 * Rejection reasons that the workspace cannot fix by editing its details
 * (Twilio refuses the business itself). Anything else is treated as fixable,
 * so the customer is asked to correct it rather than being stuck.
 */
export function classifyRejection(reason: string | null | undefined): { fixable: boolean } {
  const r = (reason ?? "").toLowerCase();
  if (/(fraud|prohibited|not permitted|sanction|blocked|high risk|disallowed)/.test(r)) return { fixable: false };
  return { fixable: true };
}

function done(rec: ProvisioningRecord, patch: Partial<ProvisioningRecord>): ProvisioningRecord {
  return { ...rec, ...patch, attempts: 0, lastError: null, needsAttention: false, version: rec.version + 1 };
}

const BUNDLE_RANK: Record<BundleStatus, number> = {
  DRAFT: 0,
  PENDING_REVIEW: 1,
  IN_REVIEW: 1,
  PROVISIONALLY_APPROVED: 1,
  APPROVED: 2,
  REJECTED: 2,
};

/** Apply one event. Pure; throws IllegalProvisioningTransition. */
export function applyProvisioningEvent(rec: ProvisioningRecord, ev: ProvisioningEvent): ProvisioningRecord {
  const s = rec.state;
  const bad = (why?: string) => new IllegalProvisioningTransition(s, ev.type, why);
  switch (ev.type) {
    case "REQUEST":
      if (s !== "NOT_REQUESTED") throw bad();
      return done(rec, { state: "DETAILS_REQUIRED" });
    case "CANCEL":
      if (!CANCELLABLE.includes(s)) throw bad("a bought number is released, not cancelled");
      return done(rec, {
        ...newProvisioningRecord(rec.businessId),
        subaccountSid: rec.subaccountSid,
        version: rec.version,
      });
    case "SUBACCOUNT_CREATED":
      if (s !== "DETAILS_REQUIRED") throw bad();
      return done(rec, { state: "SUBACCOUNT_CREATED", subaccountSid: ev.accountSid });
    case "BUNDLE_SUBMITTED":
      if (s === "BUNDLE_REJECTED") {
        if (!rec.rejection?.fixable) throw bad("rejection is not fixable");
        if (rec.rejection.fingerprint === ev.fingerprint) throw bad("details unchanged since rejection");
      } else if (s !== "SUBACCOUNT_CREATED") throw bad();
      return done(rec, {
        state: "BUNDLE_SUBMITTED",
        bundleSid: ev.bundleSid,
        addressSid: ev.addressSid,
        endUserSid: ev.endUserSid,
        bundleStatus: "PENDING_REVIEW",
        submittedFingerprint: ev.fingerprint,
        rejection: null,
      });
    case "BUNDLE_STATUS": {
      // A status for another (older) bundle, or one that arrives after the
      // record has moved on, is stale: no-op, never a regression.
      if (ev.bundleSid !== rec.bundleSid) return rec;
      if (s !== "BUNDLE_SUBMITTED" && s !== "BUNDLE_IN_REVIEW") return rec;
      if (rec.bundleStatus && BUNDLE_RANK[ev.status] < BUNDLE_RANK[rec.bundleStatus]) return rec;
      if (ev.status === "APPROVED") return done(rec, { state: "BUNDLE_APPROVED", bundleStatus: "APPROVED" });
      if (ev.status === "REJECTED") {
        const reason = ev.failureReason ?? "Rejected without a reason";
        return done(rec, {
          state: "BUNDLE_REJECTED",
          bundleStatus: "REJECTED",
          rejection: { reason, fixable: classifyRejection(reason).fixable, fingerprint: rec.submittedFingerprint },
        });
      }
      // PENDING_REVIEW, IN_REVIEW, and PROVISIONALLY_APPROVED (treated as still
      // in review: whether a provisional approval allows purchase in GB is
      // UNVERIFIED, so we wait for twilio-approved).
      if (ev.status === "DRAFT") return rec;
      if (s === "BUNDLE_IN_REVIEW" && rec.bundleStatus === ev.status) return rec;
      return done(rec, { state: "BUNDLE_IN_REVIEW", bundleStatus: ev.status });
    }
    case "SEARCH_STARTED":
      if (s !== "BUNDLE_APPROVED") throw bad();
      return done(rec, { state: "NUMBER_SEARCHING" });
    case "NUMBER_PURCHASED":
      if (s !== "NUMBER_SEARCHING") throw bad();
      return done(rec, { state: "NUMBER_PURCHASED", phoneNumberSid: ev.phoneNumberSid, e164: ev.e164, purchasedAt: ev.at });
    case "CONFIGURED":
      if (s !== "NUMBER_PURCHASED") throw bad();
      return done(rec, { state: "CONFIGURED", messagingServiceSid: ev.messagingServiceSid, configuredAt: ev.at });
    case "ACTIVATED":
      if (s !== "CONFIGURED") throw bad();
      return done(rec, { state: "ACTIVE", activatedAt: ev.at });
    case "CONFIGURATION_DRIFT":
      // The carrier does not show our configuration: go back one step so the
      // next run re-applies it. Counts as a failed attempt.
      if (s !== "CONFIGURED") throw bad();
      return {
        ...rec,
        state: "NUMBER_PURCHASED",
        configuredAt: null,
        attempts: rec.attempts + 1,
        lastError: ev.error,
        needsAttention: rec.attempts + 1 >= MAX_STEP_ATTEMPTS,
        version: rec.version + 1,
      };
    case "SCHEDULE_RELEASE":
      if (s !== "ACTIVE" && s !== "NUMBER_PURCHASED" && s !== "CONFIGURED") throw bad();
      return done(rec, { state: "RELEASE_SCHEDULED", releaseAfter: ev.releaseAfter });
    case "CANCEL_RELEASE":
      if (s !== "RELEASE_SCHEDULED") throw bad();
      if (!rec.activatedAt) throw bad("the number was never active");
      return done(rec, { state: "ACTIVE", releaseAfter: null });
    case "RELEASED":
      if (s !== "RELEASE_SCHEDULED") throw bad();
      return done(rec, { state: "RELEASED", releasedAt: ev.at });
    case "QUARANTINED":
      if (s !== "RELEASED") throw bad();
      return done(rec, { state: "QUARANTINED", quarantineUntil: ev.until });
    case "QUARANTINE_ENDED":
      if (s !== "QUARANTINED") throw bad();
      return done(rec, { ...newProvisioningRecord(rec.businessId), subaccountSid: rec.subaccountSid, version: rec.version });
    case "STEP_FAILED": {
      const attempts = rec.attempts + 1;
      return {
        ...rec,
        attempts,
        lastError: ev.error.slice(0, 500),
        needsAttention: ev.permanent || attempts >= MAX_STEP_ATTEMPTS,
        version: rec.version + 1,
      };
    }
  }
}

// ------------------------------------------------------------------ picker

/**
 * Choose a number: a UK MOBILE (geographic numbers cannot send SMS), capable
 * of both voice and SMS, not quarantined; deterministic (lowest e164).
 */
export function pickNumber(candidates: readonly AvailableNumber[], quarantined: ReadonlySet<string> = new Set()): AvailableNumber | null {
  const ok = candidates
    .filter((n) => classifyDestination(n.e164) === "UK_MOBILE")
    .filter((n) => n.capabilities.voice && n.capabilities.sms)
    .filter((n) => !quarantined.has(n.e164))
    .sort((a, b) => (a.e164 < b.e164 ? -1 : a.e164 > b.e164 ? 1 : 0));
  return ok[0] ?? null;
}

// ------------------------------------------------------------------ driver

export type ProvisioningUrls = {
  voiceWebhookUrl: string;
  voiceStatusCallbackUrl: string;
  smsInboundUrl: string;
  bundleStatusCallbackUrl: string;
};

export type StepContext = {
  numbers: NumberProvider;
  /** The workspace's saved details, raw (validated here). */
  details: unknown;
  now: Date;
  urls: ProvisioningUrls;
  quarantinedE164s?: ReadonlySet<string>;
  quarantineDays?: number;
};

export type StepOutcome =
  | "NONE"
  | "WAIT_FOR_DETAILS"
  | "WAIT_FOR_DETAILS_FIX"
  | "WAIT_FOR_REVIEW"
  | "WAIT_UNTIL"
  | "NEEDS_ATTENTION"
  | "NO_NUMBERS_AVAILABLE"
  | "ADVANCED"
  | "FAILED";

export type StepLogEntry = {
  businessId: string;
  fromState: ProvisioningState;
  toState: ProvisioningState;
  event: ProvisioningEvent["type"];
  at: string;
  detail: Record<string, string | number | boolean | null>;
  /** Unique per record version: an append-only event row is written once. */
  idempotencyKey: string;
};

export type StepResult = {
  record: ProvisioningRecord;
  outcome: StepOutcome;
  log: StepLogEntry[];
  problems?: DetailsProblem[];
  /** When to run again (for WAIT_UNTIL). */
  runAt?: string;
};

export function subaccountName(businessId: string): string {
  return `ct-${businessId}`;
}

/** Run one provisioning step. Retry-safe: call it again after any outcome. */
export async function runProvisioningStep(rec: ProvisioningRecord, ctx: StepContext): Promise<StepResult> {
  const log: StepLogEntry[] = [];
  const at = ctx.now.toISOString();
  let cur = rec;
  const apply = (ev: ProvisioningEvent, detail: StepLogEntry["detail"] = {}): void => {
    const next = applyProvisioningEvent(cur, ev);
    if (next === cur) return;
    log.push({
      businessId: cur.businessId,
      fromState: cur.state,
      toState: next.state,
      event: ev.type,
      at,
      detail,
      idempotencyKey: `${cur.businessId}:${next.version}:${ev.type}`,
    });
    cur = next;
  };

  try {
    switch (cur.state) {
      case "NOT_REQUESTED":
      case "ACTIVE":
        return { record: cur, outcome: "NONE", log };

      case "DETAILS_REQUIRED": {
        const r = provisioningReadiness(ctx.details);
        if (!r.ready) return { record: cur, outcome: "WAIT_FOR_DETAILS", log, problems: r.problems };
        const sub = await ctx.numbers.createSubaccount({ friendlyName: subaccountName(cur.businessId) });
        apply({ type: "SUBACCOUNT_CREATED", accountSid: sub.accountSid }, { created: sub.created });
        return { record: cur, outcome: "ADVANCED", log };
      }

      case "SUBACCOUNT_CREATED":
      case "BUNDLE_REJECTED": {
        if (cur.state === "BUNDLE_REJECTED" && !cur.rejection?.fixable) {
          return { record: cur, outcome: "NEEDS_ATTENTION", log };
        }
        const r = provisioningReadiness(ctx.details);
        if (!r.ready) return { record: cur, outcome: "WAIT_FOR_DETAILS", log, problems: r.problems };
        const fp = detailsFingerprint(r.details);
        if (cur.state === "BUNDLE_REJECTED" && cur.rejection?.fingerprint === fp) {
          return { record: cur, outcome: "WAIT_FOR_DETAILS_FIX", log };
        }
        const sub = await ctx.numbers.submitRegulatoryBundle(
          toBundleSubmission(r.details, {
            accountSid: cur.subaccountSid as string,
            businessId: cur.businessId,
            statusCallbackUrl: ctx.urls.bundleStatusCallbackUrl,
          }),
        );
        apply(
          { type: "BUNDLE_SUBMITTED", bundleSid: sub.bundleSid, addressSid: sub.addressSid, endUserSid: sub.endUserSid, fingerprint: fp },
          { bundleSid: sub.bundleSid },
        );
        if (sub.status !== "PENDING_REVIEW" && sub.status !== "DRAFT") {
          apply({ type: "BUNDLE_STATUS", bundleSid: sub.bundleSid, status: sub.status, failureReason: null }, { status: sub.status });
        }
        return { record: cur, outcome: "ADVANCED", log };
      }

      case "BUNDLE_SUBMITTED":
      case "BUNDLE_IN_REVIEW": {
        const st = await ctx.numbers.getBundleStatus({ accountSid: cur.subaccountSid as string, bundleSid: cur.bundleSid as string });
        const before = cur.state;
        apply(
          { type: "BUNDLE_STATUS", bundleSid: cur.bundleSid as string, status: st.status, failureReason: st.failureReason },
          { status: st.status, failureReason: st.failureReason },
        );
        // `apply` reassigns `cur` inside a closure; widen past TS's narrowing.
        const after = cur.state as ProvisioningState;
        return { record: cur, outcome: after !== before ? "ADVANCED" : "WAIT_FOR_REVIEW", log };
      }

      case "BUNDLE_APPROVED":
        apply({ type: "SEARCH_STARTED" });
        return { record: cur, outcome: "ADVANCED", log };

      case "NUMBER_SEARCHING": {
        const accountSid = cur.subaccountSid as string;
        // Adopt a number bought by an earlier run that crashed before persisting.
        const owned = await ctx.numbers.list({ accountSid });
        const adopt = owned.find((n) => classifyDestination(n.e164) === "UK_MOBILE");
        if (adopt) {
          apply({ type: "NUMBER_PURCHASED", phoneNumberSid: adopt.phoneNumberSid, e164: adopt.e164, at }, { adopted: true, e164: adopt.e164 });
          return { record: cur, outcome: "ADVANCED", log };
        }
        const found = await ctx.numbers.searchAvailable({ accountSid, isoCountry: "GB", type: "mobile", smsEnabled: true, voiceEnabled: true, limit: 20 });
        const pick = pickNumber(found, ctx.quarantinedE164s);
        if (!pick) {
          cur = applyProvisioningEvent(cur, { type: "STEP_FAILED", error: "No UK mobile number with voice and SMS available", permanent: false });
          return { record: cur, outcome: "NO_NUMBERS_AVAILABLE", log };
        }
        const bought = await ctx.numbers.purchase({
          accountSid,
          e164: pick.e164,
          bundleSid: cur.bundleSid as string,
          addressSid: cur.addressSid as string,
        });
        apply({ type: "NUMBER_PURCHASED", phoneNumberSid: bought.phoneNumberSid, e164: bought.e164, at }, { adopted: false, e164: bought.e164 });
        return { record: cur, outcome: "ADVANCED", log };
      }

      case "NUMBER_PURCHASED": {
        const accountSid = cur.subaccountSid as string;
        const svc = await ctx.numbers.ensureMessagingService({
          accountSid,
          friendlyName: subaccountName(cur.businessId),
          inboundUrl: ctx.urls.smsInboundUrl,
        });
        await ctx.numbers.configure({
          accountSid,
          phoneNumberSid: cur.phoneNumberSid as string,
          voiceUrl: ctx.urls.voiceWebhookUrl,
          statusCallbackUrl: ctx.urls.voiceStatusCallbackUrl,
          messagingServiceSid: svc.messagingServiceSid,
        });
        apply({ type: "CONFIGURED", messagingServiceSid: svc.messagingServiceSid, at }, { messagingServiceSid: svc.messagingServiceSid });
        return { record: cur, outcome: "ADVANCED", log };
      }

      case "CONFIGURED": {
        // Re-read the carrier's view before declaring ACTIVE.
        const owned = await ctx.numbers.list({ accountSid: cur.subaccountSid as string });
        const n = owned.find((o) => o.phoneNumberSid === cur.phoneNumberSid);
        if (!n || n.voiceUrl !== ctx.urls.voiceWebhookUrl || n.messagingServiceSid !== cur.messagingServiceSid) {
          apply({ type: "CONFIGURATION_DRIFT", error: "Number configuration not confirmed" });
          return { record: cur, outcome: "FAILED", log };
        }
        apply({ type: "ACTIVATED", at }, { e164: cur.e164 });
        return { record: cur, outcome: "ADVANCED", log };
      }

      case "RELEASE_SCHEDULED": {
        if (cur.releaseAfter && ctx.now.getTime() < Date.parse(cur.releaseAfter)) {
          return { record: cur, outcome: "WAIT_UNTIL", log, runAt: cur.releaseAfter };
        }
        if (cur.phoneNumberSid && cur.subaccountSid) {
          await ctx.numbers.release({ accountSid: cur.subaccountSid, phoneNumberSid: cur.phoneNumberSid });
        }
        apply({ type: "RELEASED", at }, { e164: cur.e164 });
        return { record: cur, outcome: "ADVANCED", log };
      }

      case "RELEASED": {
        const days = ctx.quarantineDays ?? DEFAULT_QUARANTINE_DAYS;
        const until = new Date(ctx.now.getTime() + days * 86400000).toISOString();
        apply({ type: "QUARANTINED", until }, { e164: cur.e164, until });
        return { record: cur, outcome: "ADVANCED", log };
      }

      case "QUARANTINED": {
        if (cur.quarantineUntil && ctx.now.getTime() < Date.parse(cur.quarantineUntil)) {
          return { record: cur, outcome: "WAIT_UNTIL", log, runAt: cur.quarantineUntil };
        }
        apply({ type: "QUARANTINE_ENDED" }, { e164: cur.e164 });
        return { record: cur, outcome: "ADVANCED", log };
      }
    }
  } catch (e) {
    const permanent = e instanceof ProviderRequestError ? e.permanent : false;
    const message = e instanceof Error ? e.message : String(e);
    cur = applyProvisioningEvent(cur, { type: "STEP_FAILED", error: message, permanent });
    return { record: cur, outcome: cur.needsAttention ? "NEEDS_ATTENTION" : "FAILED", log };
  }
}

/** Drive steps until nothing more can happen now (for tests and the job's inner loop). */
export async function runUntilSettled(rec: ProvisioningRecord, ctx: StepContext, maxSteps = 20): Promise<StepResult & { steps: number }> {
  let cur = rec;
  const log: StepLogEntry[] = [];
  let last: StepResult = { record: cur, outcome: "NONE", log: [] };
  let steps = 0;
  while (steps < maxSteps) {
    last = await runProvisioningStep(cur, ctx);
    steps++;
    log.push(...last.log);
    cur = last.record;
    if (last.outcome !== "ADVANCED") break;
  }
  return { ...last, record: cur, log, steps };
}
