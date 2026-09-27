import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProvisioningEvent,
  classifyRejection,
  IllegalProvisioningTransition,
  MAX_STEP_ATTEMPTS,
  newProvisioningRecord,
  pickNumber,
  PROVISIONING_STATES,
  runProvisioningStep,
  runUntilSettled,
  type ProvisioningEvent,
  type ProvisioningRecord,
  type StepContext,
} from "../src/lib/voice/numbers/provisioning.ts";
import { detailsFingerprint, provisioningReadiness, toBundleSubmission } from "../src/lib/voice/numbers/provisioning-details.ts";
import { resolveInbound, resolveSmsSender, resolveVoiceCallerId, type WorkspaceNumber } from "../src/lib/voice/numbers/sender.ts";
import { FakeNumberProvider } from "../src/lib/voice/providers/fake.ts";
import { ProviderRequestError } from "../src/lib/voice/providers/types.ts";

const NOW = new Date("2026-09-28T10:00:00Z");

function details(over: Record<string, unknown> = {}) {
  return {
    callingAsName: "Acme",
    legalEntityName: "Acme Studio Ltd",
    identificationContact: "0800 123 4567",
    companyNumber: "01234567",
    websiteUrl: "https://acme.example",
    registeredAddress: { line1: "1 High Street", city: "Leeds", postcode: "LS1 1AA", country: "GB" },
    representative: { firstName: "Sam", lastName: "Jones", phone: "07700 900555", workEmail: "sam@acme.example" },
    notificationEmail: "ops@clientturn.example",
    ...over,
  };
}

const URLS = {
  voiceWebhookUrl: "https://app.example/api/webhooks/twilio/voice",
  voiceStatusCallbackUrl: "https://app.example/api/webhooks/twilio/voice/status",
  smsInboundUrl: "https://app.example/api/webhooks/twilio",
  bundleStatusCallbackUrl: "https://app.example/api/webhooks/twilio/bundles",
};

function ctx(numbers: FakeNumberProvider, over: Partial<StepContext> = {}): StepContext {
  return { numbers, details: details(), now: NOW, urls: URLS, ...over };
}

function requested(): ProvisioningRecord {
  return applyProvisioningEvent(newProvisioningRecord("b1"), { type: "REQUEST" });
}

// ------------------------------------------------------------------ details

test("provisioning details: OD-1 identity plus address and Companies House number", () => {
  const ok = provisioningReadiness(details());
  assert.ok(ok.ready);
  if (ok.ready) {
    assert.equal(ok.details.registrationAuthority, "Companies House");
    assert.equal(ok.details.businessClassification, "DIRECT_CUSTOMER");
  }
  assert.ok(provisioningReadiness(details({ companyNumber: "sc 123456" })).ready);
  const bad = provisioningReadiness(details({ companyNumber: "12345", identificationContact: "020 7946 0018", websiteUrl: "nope" }));
  assert.ok(!bad.ready);
  if (!bad.ready) {
    const flat = bad.problems.map((p) => ("source" in p ? `identity:${p.field}:${p.problem}` : `${p.field}:${p.problem}`));
    assert.ok(flat.includes("identity:identificationContact:PHONE_NOT_FREEPHONE"), flat.join());
    assert.ok(flat.includes("companyNumber:INVALID"), flat.join());
    assert.ok(flat.includes("websiteUrl:INVALID"), flat.join());
  }
  const noAddr = provisioningReadiness(details({ registeredAddress: undefined }));
  assert.ok(!noAddr.ready);
  const badRep = provisioningReadiness(details({ representative: { firstName: "S", lastName: "J", phone: "phone", workEmail: "s@a.example" } }));
  assert.ok(!badRep.ready && badRep.problems.some((p) => "field" in p && p.field === "representative.phone"));
  assert.equal(provisioningReadiness(undefined).ready, false);
});

test("bundle submission maps to Twilio's GB mobile business end user", () => {
  const r = provisioningReadiness(details());
  assert.ok(r.ready);
  if (!r.ready) return;
  const s = toBundleSubmission(r.details, { accountSid: "ACsub", businessId: "b1", statusCallbackUrl: URLS.bundleStatusCallbackUrl });
  assert.equal(s.numberType, "mobile");
  assert.equal(s.endUserType, "business");
  assert.equal(s.endUser.businessRegistrationNumber, "01234567");
  assert.equal(s.endUser.representative.phoneE164, "+447700900555");
  assert.equal(s.address.isoCountry, "GB");
  assert.deepEqual(s.documents, []);
  // Fingerprint moves only with reviewed fields.
  const f1 = detailsFingerprint(r.details);
  assert.equal(detailsFingerprint({ ...r.details, callingAsName: "Other" }), f1);
  assert.notEqual(detailsFingerprint({ ...r.details, companyNumber: "07654321" }), f1);
});

// ------------------------------------------------------------ transitions

test("every legal transition, in order, to ACTIVE and through release", () => {
  const evs: ProvisioningEvent[] = [
    { type: "REQUEST" },
    { type: "SUBACCOUNT_CREATED", accountSid: "ACsub" },
    { type: "BUNDLE_SUBMITTED", bundleSid: "BU1", addressSid: "AD1", endUserSid: "IT1", fingerprint: "f1" },
    { type: "BUNDLE_STATUS", bundleSid: "BU1", status: "IN_REVIEW", failureReason: null },
    { type: "BUNDLE_STATUS", bundleSid: "BU1", status: "APPROVED", failureReason: null },
    { type: "SEARCH_STARTED" },
    { type: "NUMBER_PURCHASED", phoneNumberSid: "PN1", e164: "+447700900001", at: NOW.toISOString() },
    { type: "CONFIGURED", messagingServiceSid: "MG1", at: NOW.toISOString() },
    { type: "ACTIVATED", at: NOW.toISOString() },
    { type: "SCHEDULE_RELEASE", releaseAfter: "2026-10-28T00:00:00Z" },
    { type: "CANCEL_RELEASE" },
    { type: "SCHEDULE_RELEASE", releaseAfter: "2026-10-28T00:00:00Z" },
    { type: "RELEASED", at: "2026-10-28T00:00:00Z" },
    { type: "QUARANTINED", until: "2027-01-26T00:00:00Z" },
    { type: "QUARANTINE_ENDED" },
  ];
  const states: string[] = [];
  let r = newProvisioningRecord("b1");
  for (const e of evs) {
    r = applyProvisioningEvent(r, e);
    states.push(r.state);
  }
  assert.deepEqual(states, [
    "DETAILS_REQUIRED",
    "SUBACCOUNT_CREATED",
    "BUNDLE_SUBMITTED",
    "BUNDLE_IN_REVIEW",
    "BUNDLE_APPROVED",
    "NUMBER_SEARCHING",
    "NUMBER_PURCHASED",
    "CONFIGURED",
    "ACTIVE",
    "RELEASE_SCHEDULED",
    "ACTIVE",
    "RELEASE_SCHEDULED",
    "RELEASED",
    "QUARANTINED",
    "NOT_REQUESTED",
  ]);
  // After quarantine the subaccount is kept for reuse; the number is not.
  assert.equal(r.subaccountSid, "ACsub");
  assert.equal(r.e164, null);
  assert.equal(r.version, evs.length);
  const seen = new Set(states);
  for (const s of PROVISIONING_STATES) if (s !== "BUNDLE_REJECTED") assert.ok(seen.has(s), s);
});

test("illegal provisioning transitions throw", () => {
  const cases: [ProvisioningRecord, ProvisioningEvent][] = [
    [newProvisioningRecord("b1"), { type: "SUBACCOUNT_CREATED", accountSid: "AC" }],
    [requested(), { type: "REQUEST" }],
    [requested(), { type: "SEARCH_STARTED" }],
    [requested(), { type: "ACTIVATED", at: "x" }],
    [requested(), { type: "RELEASED", at: "x" }],
    [newProvisioningRecord("b1"), { type: "CANCEL_RELEASE" }],
    [newProvisioningRecord("b1"), { type: "QUARANTINE_ENDED" }],
  ];
  for (const [rec, ev] of cases) assert.throws(() => applyProvisioningEvent(rec, ev), IllegalProvisioningTransition, `${rec.state}+${ev.type}`);
  // A bought number is released, never "cancelled".
  let active = { ...requested(), state: "ACTIVE" as const };
  assert.throws(() => applyProvisioningEvent(active, { type: "CANCEL" }), IllegalProvisioningTransition);
  // Cancel before purchase returns to NOT_REQUESTED, keeping the subaccount.
  const sub = applyProvisioningEvent(requested(), { type: "SUBACCOUNT_CREATED", accountSid: "ACsub" });
  const cancelled = applyProvisioningEvent(sub, { type: "CANCEL" });
  assert.equal(cancelled.state, "NOT_REQUESTED");
  assert.equal(cancelled.subaccountSid, "ACsub");
  // Cancel-release needs a number that was once active.
  const purchased = { ...requested(), state: "NUMBER_PURCHASED" as const };
  const sched = applyProvisioningEvent(purchased, { type: "SCHEDULE_RELEASE", releaseAfter: NOW.toISOString() });
  assert.throws(() => applyProvisioningEvent(sched, { type: "CANCEL_RELEASE" }), IllegalProvisioningTransition);
  active = { ...active };
});

test("bundle status: stale, foreign and out-of-order statuses are no-ops", () => {
  let r = applyProvisioningEvent(requested(), { type: "SUBACCOUNT_CREATED", accountSid: "AC" });
  r = applyProvisioningEvent(r, { type: "BUNDLE_SUBMITTED", bundleSid: "BU1", addressSid: "AD", endUserSid: "IT", fingerprint: "f" });
  assert.equal(applyProvisioningEvent(r, { type: "BUNDLE_STATUS", bundleSid: "BU_OLD", status: "APPROVED", failureReason: null }), r);
  const approved = applyProvisioningEvent(r, { type: "BUNDLE_STATUS", bundleSid: "BU1", status: "APPROVED", failureReason: null });
  assert.equal(approved.state, "BUNDLE_APPROVED");
  assert.equal(applyProvisioningEvent(approved, { type: "BUNDLE_STATUS", bundleSid: "BU1", status: "IN_REVIEW", failureReason: null }), approved);
  const prov = applyProvisioningEvent(r, { type: "BUNDLE_STATUS", bundleSid: "BU1", status: "PROVISIONALLY_APPROVED", failureReason: null });
  assert.equal(prov.state, "BUNDLE_IN_REVIEW");
  const same = applyProvisioningEvent(prov, { type: "BUNDLE_STATUS", bundleSid: "BU1", status: "PROVISIONALLY_APPROVED", failureReason: null });
  assert.equal(same, prov);
});

test("rejection reasons: fixable unless Twilio refuses the business", () => {
  assert.deepEqual(classifyRejection("Address does not match registration"), { fixable: true });
  assert.deepEqual(classifyRejection(null), { fixable: true });
  assert.deepEqual(classifyRejection("Business type prohibited"), { fixable: false });
  assert.deepEqual(classifyRejection("Suspected fraud"), { fixable: false });
});

test("failures count, and turn into needs-attention", () => {
  let r = requested();
  for (let i = 0; i < MAX_STEP_ATTEMPTS - 1; i++) r = applyProvisioningEvent(r, { type: "STEP_FAILED", error: "503", permanent: false });
  assert.equal(r.needsAttention, false);
  r = applyProvisioningEvent(r, { type: "STEP_FAILED", error: "503", permanent: false });
  assert.equal(r.needsAttention, true);
  assert.equal(r.state, "DETAILS_REQUIRED");
  const perm = applyProvisioningEvent(requested(), { type: "STEP_FAILED", error: "400", permanent: true });
  assert.equal(perm.needsAttention, true);
});

// ----------------------------------------------------------------- driver

test("fully automated: details to ACTIVE with no manual step besides the review", async () => {
  const fake = new FakeNumberProvider();
  let r = await runUntilSettled(requested(), ctx(fake));
  assert.equal(r.record.state, "BUNDLE_IN_REVIEW");
  assert.equal(r.outcome, "WAIT_FOR_REVIEW");
  // Twilio approves (webhook or poll).
  fake.setBundleStatus(r.record.bundleSid as string, "APPROVED");
  r = await runUntilSettled(r.record, ctx(fake));
  assert.equal(r.record.state, "ACTIVE");
  assert.equal(r.outcome, "NONE");
  assert.equal(r.record.e164, "+447700900001"); // lowest voice+SMS mobile
  const owned = [...fake.owned.values()][0];
  assert.equal(owned.voiceUrl, URLS.voiceWebhookUrl);
  assert.equal(owned.statusCallbackUrl, URLS.voiceStatusCallbackUrl);
  assert.equal(owned.messagingServiceSid, r.record.messagingServiceSid);
  assert.ok([...fake.messagingServices.values()][0].numbers.has(owned.phoneNumberSid));
  // Event log is append-only shaped: one row per version.
  const keys = r.log.map((l) => l.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("details missing: waits with the problems, no provider call", async () => {
  const fake = new FakeNumberProvider();
  const r = await runProvisioningStep(requested(), ctx(fake, { details: { callingAsName: "Acme" } }));
  assert.equal(r.outcome, "WAIT_FOR_DETAILS");
  assert.ok(r.problems && r.problems.length > 0);
  assert.equal(fake.log.length, 0);
});

test("rejected bundle, then fixed, then resubmitted; unchanged details never resubmit", async () => {
  const fake = new FakeNumberProvider();
  let r = await runUntilSettled(requested(), ctx(fake));
  fake.setBundleStatus(r.record.bundleSid as string, "REJECTED", "Registered address does not match Companies House");
  r = await runUntilSettled(r.record, ctx(fake));
  assert.equal(r.record.state, "BUNDLE_REJECTED");
  assert.deepEqual(r.record.rejection?.fixable, true);
  assert.equal(r.outcome, "WAIT_FOR_DETAILS_FIX");
  const submitsBefore = fake.log.filter((l) => l.method === "submitRegulatoryBundle").length;
  // A retry with the same details does nothing.
  const again = await runProvisioningStep(r.record, ctx(fake));
  assert.equal(again.outcome, "WAIT_FOR_DETAILS_FIX");
  assert.equal(fake.log.filter((l) => l.method === "submitRegulatoryBundle").length, submitsBefore);
  // The customer fixes the address: resubmitted automatically.
  const fixed = details({ registeredAddress: { line1: "2 Park Row", city: "Leeds", postcode: "LS1 5HD", country: "GB" } });
  r = await runUntilSettled(r.record, ctx(fake, { details: fixed }));
  assert.equal(r.record.state, "BUNDLE_IN_REVIEW");
  assert.equal(r.record.rejection, null);
  fake.setBundleStatus(r.record.bundleSid as string, "APPROVED");
  r = await runUntilSettled(r.record, ctx(fake, { details: fixed }));
  assert.equal(r.record.state, "ACTIVE");
});

test("a non-fixable rejection needs attention and is never resubmitted", async () => {
  const fake = new FakeNumberProvider();
  let r = await runUntilSettled(requested(), ctx(fake));
  fake.setBundleStatus(r.record.bundleSid as string, "REJECTED", "Business type prohibited");
  r = await runUntilSettled(r.record, ctx(fake));
  assert.equal(r.record.state, "BUNDLE_REJECTED");
  const again = await runProvisioningStep(r.record, ctx(fake, { details: details({ companyNumber: "07654321" }) }));
  assert.equal(again.outcome, "NEEDS_ATTENTION");
});

test("idempotent re-runs: a crash after purchase adopts the number instead of buying twice", async () => {
  const fake = new FakeNumberProvider();
  let r = await runUntilSettled(requested(), ctx(fake));
  fake.setBundleStatus(r.record.bundleSid as string, "APPROVED");
  // Advance to NUMBER_SEARCHING.
  r = { ...r, record: (await runProvisioningStep(r.record, ctx(fake))).record }; // IN_REVIEW -> APPROVED
  r = { ...r, record: (await runProvisioningStep(r.record, ctx(fake))).record }; // -> NUMBER_SEARCHING
  assert.equal(r.record.state, "NUMBER_SEARCHING");
  const beforePurchase = r.record;
  const bought = await runProvisioningStep(beforePurchase, ctx(fake));
  assert.equal(bought.record.state, "NUMBER_PURCHASED");
  // Simulate the job crashing before persisting: re-run from the old record.
  const rerun = await runProvisioningStep(beforePurchase, ctx(fake));
  assert.equal(rerun.record.state, "NUMBER_PURCHASED");
  assert.equal(rerun.record.phoneNumberSid, bought.record.phoneNumberSid);
  assert.equal(fake.log.filter((l) => l.method === "purchase").length, 1);
  assert.equal(rerun.log[0].detail.adopted, true);
  // Subaccount and messaging service are found, not duplicated.
  const cfg1 = await runProvisioningStep(bought.record, ctx(fake));
  const cfg2 = await runProvisioningStep(bought.record, ctx(fake));
  assert.equal(cfg1.record.messagingServiceSid, cfg2.record.messagingServiceSid);
  assert.equal(fake.messagingServices.size, 1);
  assert.equal(fake.subaccounts.size, 1);
});

test("provider failures are retried and counted, not lost", async () => {
  const fake = new FakeNumberProvider();
  fake.failNext("createSubaccount");
  const r1 = await runProvisioningStep(requested(), ctx(fake));
  assert.equal(r1.outcome, "FAILED");
  assert.equal(r1.record.state, "DETAILS_REQUIRED");
  assert.equal(r1.record.attempts, 1);
  const r2 = await runProvisioningStep(r1.record, ctx(fake));
  assert.equal(r2.record.state, "SUBACCOUNT_CREATED");
  assert.equal(r2.record.attempts, 0);
  fake.failNext("submitRegulatoryBundle", new ProviderRequestError("fake", 400, "invalid attributes"));
  const r3 = await runProvisioningStep(r2.record, ctx(fake));
  assert.equal(r3.outcome, "NEEDS_ATTENTION");
});

test("no suitable number: waits and retries, never buys a landline or voice-only number", async () => {
  const fake = new FakeNumberProvider([
    { e164: "+441632960001", capabilities: { voice: true, sms: true, mms: false }, locality: "Leeds" },
    { e164: "+447700900002", capabilities: { voice: true, sms: false, mms: false }, locality: null },
  ]);
  let r = await runUntilSettled(requested(), ctx(fake));
  fake.setBundleStatus(r.record.bundleSid as string, "APPROVED");
  r = await runUntilSettled(r.record, ctx(fake));
  assert.equal(r.outcome, "NO_NUMBERS_AVAILABLE");
  assert.equal(r.record.state, "NUMBER_SEARCHING");
  assert.equal(fake.log.filter((l) => l.method === "purchase").length, 0);
});

test("configuration drift sends the record back to be configured again", async () => {
  const fake = new FakeNumberProvider();
  let r = await runUntilSettled(requested(), ctx(fake));
  fake.setBundleStatus(r.record.bundleSid as string, "APPROVED");
  r = await runUntilSettled(r.record, ctx(fake));
  assert.equal(r.record.state, "ACTIVE");
  // Pretend we were at CONFIGURED and the carrier lost the voice URL.
  const configured = { ...r.record, state: "CONFIGURED" as const };
  for (const n of fake.owned.values()) n.voiceUrl = null;
  const drift = await runProvisioningStep(configured, ctx(fake));
  assert.equal(drift.record.state, "NUMBER_PURCHASED");
  assert.equal(drift.outcome, "FAILED");
  assert.equal(drift.record.attempts, 1);
  const back = await runUntilSettled(drift.record, ctx(fake));
  assert.equal(back.record.state, "ACTIVE");
});

test("release at period end, then quarantine, then free", async () => {
  const fake = new FakeNumberProvider();
  let r = await runUntilSettled(requested(), ctx(fake));
  fake.setBundleStatus(r.record.bundleSid as string, "APPROVED");
  r = await runUntilSettled(r.record, ctx(fake));
  const sched = applyProvisioningEvent(r.record, { type: "SCHEDULE_RELEASE", releaseAfter: "2026-10-28T00:00:00.000Z" });
  const early = await runProvisioningStep(sched, ctx(fake));
  assert.equal(early.outcome, "WAIT_UNTIL");
  assert.equal(early.runAt, "2026-10-28T00:00:00.000Z");
  assert.equal(fake.released.length, 0);
  const due = await runUntilSettled(sched, ctx(fake, { now: new Date("2026-10-28T00:00:01Z") }));
  assert.equal(due.record.state, "QUARANTINED");
  assert.equal(fake.released.length, 1);
  assert.equal(due.record.quarantineUntil, new Date(Date.parse("2026-10-28T00:00:01Z") + 90 * 86400000).toISOString());
  // Releasing twice (a retried job) is harmless.
  await fake.release({ accountSid: "x", phoneNumberSid: sched.phoneNumberSid as string });
  assert.equal(fake.released.length, 1);
  const stillQ = await runProvisioningStep(due.record, ctx(fake, { now: new Date("2026-12-01T00:00:00Z") }));
  assert.equal(stillQ.outcome, "WAIT_UNTIL");
  const freed = await runProvisioningStep(due.record, ctx(fake, { now: new Date("2027-02-01T00:00:00Z") }));
  assert.equal(freed.record.state, "NOT_REQUESTED");
});

test("the picker refuses quarantined, landline and voice-only numbers", () => {
  const list = [
    { e164: "+447700900009", capabilities: { voice: true, sms: true, mms: false }, locality: null },
    { e164: "+447700900001", capabilities: { voice: true, sms: true, mms: false }, locality: null },
    { e164: "+447700900000", capabilities: { voice: true, sms: false, mms: false }, locality: null },
    { e164: "+441632960000", capabilities: { voice: true, sms: true, mms: false }, locality: null },
    { e164: "+447012345678", capabilities: { voice: true, sms: true, mms: false }, locality: null },
  ];
  assert.equal(pickNumber(list)?.e164, "+447700900001");
  assert.equal(pickNumber(list, new Set(["+447700900001"]))?.e164, "+447700900009");
  assert.equal(pickNumber(list.slice(2)), null);
});

// ------------------------------------------------------------------ sender

const PLATFORM = { messagingServiceSid: "MGplatform", from: "+447700900999" };
const num = (state: WorkspaceNumber["state"], over: Partial<WorkspaceNumber> = {}): WorkspaceNumber => ({
  businessId: "b1",
  state,
  e164: "+447700900001",
  messagingServiceSid: "MGb1",
  ...over,
});

test("SMS sender: dedicated when ACTIVE or release scheduled, else the shared platform sender", () => {
  assert.deepEqual(resolveSmsSender(num("ACTIVE"), PLATFORM), { kind: "DEDICATED", messagingServiceSid: "MGb1", from: "+447700900001" });
  assert.equal(resolveSmsSender(num("RELEASE_SCHEDULED"), PLATFORM).kind, "DEDICATED");
  for (const s of ["CONFIGURED", "BUNDLE_IN_REVIEW", "RELEASED", "QUARANTINED"] as const) {
    assert.equal(resolveSmsSender(num(s), PLATFORM).kind, "PLATFORM_SHARED", s);
  }
  assert.equal(resolveSmsSender(null, PLATFORM).kind, "PLATFORM_SHARED");
  assert.equal(resolveSmsSender(num("ACTIVE", { messagingServiceSid: null }), PLATFORM).kind, "PLATFORM_SHARED");
  assert.deepEqual(resolveSmsSender(null, { messagingServiceSid: null, from: null }), { kind: "NONE", reason: "NO_PLATFORM_SENDER" });
});

test("voice caller id: only an ACTIVE dedicated number; otherwise voice is not allowed", () => {
  assert.deepEqual(resolveVoiceCallerId(num("ACTIVE")), { allowed: true, callerId: "+447700900001" });
  assert.deepEqual(resolveVoiceCallerId(num("RELEASE_SCHEDULED")), { allowed: false, reason: "RELEASE_SCHEDULED" });
  assert.deepEqual(resolveVoiceCallerId(num("CONFIGURED")), { allowed: false, reason: "NUMBER_NOT_ACTIVE" });
  assert.deepEqual(resolveVoiceCallerId(null), { allowed: false, reason: "NO_DEDICATED_NUMBER" });
  assert.deepEqual(resolveVoiceCallerId(num("ACTIVE", { e164: null })), { allowed: false, reason: "NO_DEDICATED_NUMBER" });
});

test("inbound calls and SMS resolve to the workspace and the lead", () => {
  const leads = [
    { leadId: "l1", businessId: "b1", phone: "07700 900123", lastActivityAt: "2026-09-01T00:00:00Z" },
    { leadId: "l2", businessId: "b1", phone: "+447700900123", lastActivityAt: "2026-09-20T00:00:00Z" },
    { leadId: "l3", businessId: "b2", phone: "+447700900123", lastActivityAt: "2026-09-25T00:00:00Z" },
    { leadId: "l4", businessId: "b1", phone: "+447700900123", lastActivityAt: "2026-09-26T00:00:00Z", anonymised: true },
  ];
  const r = resolveInbound({ to: "07700 900001", from: "+44 7700 900123", now: NOW, numbers: [num("ACTIVE")], leads });
  assert.deepEqual(r, { kind: "WORKSPACE", businessId: "b1", leadId: "l2", ambiguous: true, callerE164: "+447700900123" });
  const unknownCaller = resolveInbound({ to: "+447700900001", from: "+447700900777", now: NOW, numbers: [num("ACTIVE")], leads });
  assert.deepEqual(unknownCaller, { kind: "WORKSPACE", businessId: "b1", leadId: null, ambiguous: false, callerE164: "+447700900777" });
  const withheld = resolveInbound({ to: "+447700900001", from: null, now: NOW, numbers: [num("ACTIVE")], leads });
  assert.ok(withheld.kind === "WORKSPACE" && withheld.leadId === null);
  assert.deepEqual(resolveInbound({ to: "+447700900555", from: "+447700900123", now: NOW, numbers: [num("ACTIVE")], leads }), {
    kind: "UNROUTED",
    reason: "UNKNOWN_NUMBER",
  });
  assert.deepEqual(resolveInbound({ to: "garbage", from: null, now: NOW, numbers: [], leads }), { kind: "UNROUTED", reason: "INVALID_NUMBER" });
});

test("a quarantined or released number never routes to its former workspace", () => {
  const leads = [{ leadId: "l1", businessId: "b1", phone: "+447700900123", lastActivityAt: "2026-09-01T00:00:00Z" }];
  const q = resolveInbound({ to: "+447700900001", from: "+447700900123", now: NOW, numbers: [num("QUARANTINED", { quarantineUntil: "2026-12-01T00:00:00Z" })], leads });
  assert.deepEqual(q, { kind: "UNROUTED", reason: "NUMBER_QUARANTINED" });
  const rel = resolveInbound({ to: "+447700900001", from: "+447700900123", now: NOW, numbers: [num("RELEASED")], leads });
  assert.deepEqual(rel, { kind: "UNROUTED", reason: "NUMBER_RELEASED" });
  // A new tenant's ACTIVE record wins over an old quarantined one.
  const reused = resolveInbound({
    to: "+447700900001",
    from: "+447700900123",
    now: NOW,
    numbers: [num("QUARANTINED"), num("ACTIVE", { businessId: "b9" })],
    leads,
  });
  assert.ok(reused.kind === "WORKSPACE" && reused.businessId === "b9" && reused.leadId === null);
});
