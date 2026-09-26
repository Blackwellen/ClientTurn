import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOptInKeyword, optInChannelFor } from "../src/lib/messaging/types.ts";
import {
  decideSmsSender,
  requiresAlternativeOptOut,
  twilioErrorSuppression,
} from "../src/lib/messaging/sms-compliance.ts";
import {
  complainedAddress,
  isAbuseReport,
  oneClickUnsubscribeUrl,
} from "../src/lib/email/unsubscribe-links.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/* ------------------------------------------------------------------ B3 --- */

test("B3: START is honoured only on SMS and WhatsApp", () => {
  assert.equal(isOptInKeyword("Start"), true);
  assert.equal(optInChannelFor("sms"), "SMS");
  assert.equal(optInChannelFor("whatsapp"), "WHATSAPP");
  // "Start" in an email or a DM is an ordinary reply, never a lift.
  assert.equal(optInChannelFor("email"), null);
  assert.equal(optInChannelFor("messenger"), null);
  assert.equal(optInChannelFor("instagram"), null);
});

test("B3: the inbound handler gates recordOptIn on the channel", () => {
  const source = read("src/lib/jobs/handlers/message-inbound.ts");
  assert.match(source, /optInChannel && isOptInKeyword\(message\.body\)/);
  assert.doesNotMatch(source, /liftSuppressionForDestination\(/);
  // Phase 1 (0123): the lead-wide flag is derived from the suppression list,
  // so START no longer writes it; it clears by itself once no all-channel
  // opt-out remains. See tests/per-channel-opt-out.test.ts.
  assert.match(source, /await liftOptOutForChannel\(business\.businessId, channel,/);
  assert.doesNotMatch(source, /\.update\(\{ opted_out: false \}\)/);
});

test("B3: lift_opt_out_for_channel lifts only this channel's OPT_OUT", () => {
  const sql = read("supabase/migrations/0111_lift_opt_out_for_channel.sql");
  const body = sql.slice(sql.indexOf("as $$"), sql.lastIndexOf("$$;"));
  // Only SMS / WHATSAPP.
  assert.match(body, /p_channel not in \('SMS', 'WHATSAPP'\)/);
  // Every delete is OPT_OUT-only and workspace-scoped.
  const deletes = body.split(/delete from/i).slice(1);
  assert.equal(deletes.length, 2);
  for (const statement of deletes) {
    const where = statement.split(";")[0];
    assert.match(where, /s\.reason = 'OPT_OUT'/);
    assert.match(where, /s\.business_id = p_business_id/);
    assert.doesNotMatch(where, /MANUAL|INVALID|BOUNCE|COMPLAINT/);
  }
  // The channel delete never touches ALL; the ALL row is split first.
  assert.match(deletes[0], /s\.channel = p_channel/);
  assert.match(body, /c\.channel <> p_channel/);
});

/* ------------------------------------------------------------------ B4 --- */

test("B4: Twilio 21610 is an SMS opt-out", () => {
  assert.deepEqual(twilioErrorSuppression("21610", "sms"), { reason: "OPT_OUT", channel: "SMS" });
  assert.deepEqual(twilioErrorSuppression(21610, "whatsapp"), { reason: "OPT_OUT", channel: "SMS" });
});

test("B4: invalid-number codes are INVALID on the message's channel", () => {
  assert.deepEqual(twilioErrorSuppression("21211", "sms"), { reason: "INVALID", channel: "SMS" });
  assert.deepEqual(twilioErrorSuppression("21614", "sms"), { reason: "INVALID", channel: "SMS" });
  assert.deepEqual(twilioErrorSuppression("21211", "whatsapp"), {
    reason: "INVALID",
    channel: "WHATSAPP",
  });
});

test("B4: other failures say nothing about the recipient", () => {
  for (const code of ["30003", "20429", "63016", "", undefined, null, "abc"]) {
    assert.equal(twilioErrorSuppression(code, "sms"), null);
  }
});

test("B4: webhook and provider both record the suppression", () => {
  const route = read("src/app/api/webhooks/twilio/route.ts");
  assert.match(route, /twilioErrorSuppression\(errorCode, message\.channel\)/);
  assert.match(route, /await suppress\(/);
  const provider = read("src/lib/messaging/twilio.ts");
  assert.match(provider, /recordRecipientFailure\(request, result\.errorCode\)/);
});

test("B4: an ARF abuse report is recognised and names the recipient", () => {
  const report = [
    "Feedback-Type: abuse",
    "User-Agent: SomeFBL/1.0",
    "Version: 1",
    "Original-Mail-From: <sales@agency.example>",
    "Original-Rcpt-To: <Jane@Client.example>",
  ].join("\n");
  assert.equal(isAbuseReport("Abuse report", report), true);
  assert.equal(complainedAddress(report), "jane@client.example");
});

test("B4: an ordinary reply mentioning spam is not a complaint", () => {
  assert.equal(isAbuseReport("Re: your email", "Is this spam? Please stop."), false);
  assert.equal(isAbuseReport("Spam complaint", "I am complaining."), false);
  assert.equal(complainedAddress("no addresses here"), null);
});

/* ------------------------------------------------------------------ B5 --- */

test("B5: List-Unsubscribe points at the POST route, not the page", () => {
  assert.equal(
    oneClickUnsubscribeUrl("https://clientturn.com/unsubscribe/0b0e7c2e-1111-4a4a-9c9c-123456789abc"),
    "https://clientturn.com/api/unsubscribe/0b0e7c2e-1111-4a4a-9c9c-123456789abc",
  );
  assert.equal(oneClickUnsubscribeUrl("https://x.test/other"), "https://x.test/other");
  const smtp = read("src/lib/email/smtp.ts");
  assert.match(smtp, /"List-Unsubscribe": `<\$\{oneClickUnsubscribeUrl\(request\.unsubscribeUrl\)\}>`/);
});

test("B5: a POST handler exists and the page does not unsubscribe on GET", () => {
  const route = read("src/app/api/unsubscribe/[token]/route.ts");
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  const page = read("src/app/unsubscribe/[token]/page.tsx");
  // The only call to performUnsubscribe is inside the server action.
  const calls = page.match(/performUnsubscribe\(/g) ?? [];
  assert.equal(calls.length, 1);
  const action = page.slice(page.indexOf("async function confirmUnsubscribe"), page.indexOf("type View"));
  assert.match(action, /"use server"/);
  assert.match(action, /performUnsubscribe\(token\)/);
});

/* ----------------------------------------------------------------- B26 --- */

test("B26: an alphanumeric sender needs another opt-out route", () => {
  assert.equal(requiresAlternativeOptOut("ClientTurn"), true);
  assert.equal(requiresAlternativeOptOut("+447700900123"), false);
  assert.equal(requiresAlternativeOptOut("60123"), false);
  assert.equal(requiresAlternativeOptOut("whatsapp:+447700900123"), false);
  assert.equal(requiresAlternativeOptOut("MG0123456789abcdef0123456789abcdef"), false);
  assert.equal(requiresAlternativeOptOut(null), false);
});

test("B26: one-way sender is blocked without an opt-out URL, appended with one", () => {
  assert.deepEqual(decideSmsSender({ from: "+447700900123", body: "Hi" }), {
    action: "send",
    body: "Hi",
  });
  const blocked = decideSmsSender({ from: "ClientTurn", body: "Hi" });
  assert.equal(blocked.action, "block");
  const sent = decideSmsSender({ from: "ClientTurn", body: "Hi", optOutUrl: "https://x.test/u/1" });
  assert.deepEqual(sent, { action: "send", body: "Hi\n\nOpt out: https://x.test/u/1" });
});
