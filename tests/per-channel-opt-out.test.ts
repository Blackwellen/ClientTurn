/**
 * Per-channel opt-out and derived contactability states
 * (docs/revenue-engine/03-phase1-spine-design.md §§5-6, the Phase 0 START
 * follow-up in 02-phase0-log.md).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { isOptOutKeyword, optOutScope } from "../src/lib/messaging/types.ts";
import { guardOptedOut } from "../src/lib/jobs/send-core.ts";
import {
  CONTACTABILITY_STATES,
  contactabilityState,
} from "../src/lib/policy/contactability-state.ts";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");
const dir = path.join(root, "supabase", "migrations");
const migration = read("supabase", "migrations", readdirSync(dir).find((f) => f.startsWith("0123_"))!);

describe("the scope of an opt-out", () => {
  test("a carrier STOP keyword on SMS or WhatsApp is that channel only", () => {
    assert.equal(optOutScope("sms", "STOP"), "SMS");
    assert.equal(optOutScope("sms", "Stop."), "SMS");
    assert.equal(optOutScope("sms", "UNSUBSCRIBE"), "SMS");
    assert.equal(optOutScope("whatsapp", "stop"), "WHATSAPP");
    assert.equal(optOutScope("whatsapp", "cancel"), "WHATSAPP");
  });

  test("STOPALL is everything, as it says", () => {
    assert.equal(optOutScope("sms", "STOPALL"), "ALL");
  });

  test("plain English is everything", () => {
    assert.equal(isOptOutKeyword("stop contacting me"), false);
    assert.equal(optOutScope("sms", "stop contacting me"), "ALL");
    assert.equal(optOutScope("sms", "please take me off your list"), "ALL");
    assert.equal(optOutScope("whatsapp", "don't message me again"), "ALL");
  });

  test("STOP anywhere other than a carrier channel is everything", () => {
    assert.equal(optOutScope("email", "STOP"), "ALL");
    assert.equal(optOutScope("messenger", "stop"), "ALL");
    assert.equal(optOutScope("instagram", "unsubscribe"), "ALL");
  });
});

describe("the inbound handler writes the scope, and never the lead flag", () => {
  const inbound = read("src", "lib", "jobs", "handlers", "message-inbound.ts");
  const fnBody = (name: string) => {
    const start = inbound.indexOf(`async function ${name}(`);
    const next = inbound.indexOf("\nasync function ", start + 1);
    return inbound.slice(start, next === -1 ? undefined : next);
  };
  const optOut = fnBody("recordOptOut");
  const optIn = fnBody("recordOptIn");

  test("the suppression is written at the requested scope", () => {
    assert.match(optOut, /channel: scope,/);
    assert.match(inbound, /optOutScope\(channel, message\.body\)/);
  });

  test("opted_out is not written: it is derived from the list (0123)", () => {
    assert.doesNotMatch(optOut, /opted_out:/);
    assert.doesNotMatch(optIn, /opted_out:/);
    assert.doesNotMatch(optIn, /\.from\("leads"\)/);
    // Follow-up still stops on any STOP.
    assert.match(optOut, /automation_active: false/);
  });

  test("START still lifts only that channel's opt-out", () => {
    assert.match(optIn, /liftOptOutForChannel\(business\.businessId, channel,/);
  });
});

describe("leads.opted_out is derived from the list", () => {
  test("true only for an ALL-channel OPT_OUT, COMPLAINT or LEGAL", () => {
    const fn = migration.slice(migration.indexOf("function public.lead_all_channel_opt_out"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    assert.match(body, /s\.channel = 'ALL'/);
    assert.match(body, /s\.reason in \('OPT_OUT', 'COMPLAINT', 'LEGAL'\)/);
    assert.match(body, /s\.expires_at is null or s\.expires_at > now\(\)/);
  });

  test("a trigger on leads derives it on every write, and one on suppression_entries re-derives on insert and delete", () => {
    assert.match(migration, /create trigger leads_derive_opted_out\s+before insert or update of opted_out, email, phone, phone_normalized on public\.leads/);
    assert.match(migration, /create trigger suppression_entries_sync_leads\s+after insert or update or delete on public\.suppression_entries/);
  });

  test("the backfill only ever errs toward opted out", () => {
    const backfill = migration.slice(migration.indexOf("-- Backfill first"), migration.indexOf("create or replace function public.leads_derive_opted_out"));
    assert.match(backfill, /'ALL', 'OPT_OUT', 'MIGRATION_0123'/);
    // A lead whose opt-outs are already channel-scoped keeps them; no ALL row
    // is invented over a START that re-permitted a channel.
    assert.match(backfill, /not exists \(/);
  });
});

describe("the send guard reads channel suppression, not the flag", () => {
  const lead = { opted_out: true, email: "jo@acme.co.uk", phone: "+447700900123", phone_normalized: "+447700900123" };

  test("a lead reachable on this channel is judged by that channel's suppression lookup", () => {
    assert.equal(guardOptedOut(lead, "sms"), false);
    assert.equal(guardOptedOut(lead, "whatsapp"), false);
    assert.equal(guardOptedOut(lead, "email"), false);
  });

  test("the flag still binds where the lookup cannot see the opt-out", () => {
    // A DM goes to a platform address no email or phone opt-out row names.
    assert.equal(guardOptedOut(lead, "messenger"), true);
    // A channel the lead holds no address for.
    assert.equal(guardOptedOut({ ...lead, email: null }, "email"), true);
    assert.equal(guardOptedOut({ opted_out: false, email: null, phone: null }, "instagram"), false);
  });

  test("send-store passes the guard value to both the stop check and the policy engine", () => {
    const store = read("src", "lib", "jobs", "handlers", "send-store.ts");
    assert.match(store, /optedOut: guardOptedOut\(lead, message\.channel\) \}/);
    assert.match(store, /optedOut: guardOptedOut\(lead, message\.channel\),/);
    assert.doesNotMatch(store, /optedOut: lead\.opted_out/);
  });
});

describe("contactability states (§6)", () => {
  test("the vocabulary matches the database CHECK exactly", () => {
    const check = migration.slice(migration.indexOf("contactability_results_state_check"));
    const body = check.slice(0, check.indexOf("));"));
    const inSql = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(inSql, [...CONTACTABILITY_STATES].sort());
  });

  test("the SQL trigger and the pure mirror name the same states", () => {
    const fn = migration.slice(migration.indexOf("function public.contactability_results_derive_state"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    for (const state of [
      "HARD_BOUNCE", "COMPLAINT", "LEGAL_HOLD", "INVALID", "DO_NOT_CONTACT", "BLOCKED",
      "OPTED_OUT", "TEMPORARILY_PAUSED", "EXISTING_CUSTOMER", "CONSENTED",
      "LEGITIMATE_INTERESTS_REVIEWED", "PERMITTED", "UNKNOWN",
    ]) {
      assert.ok(body.includes(`'${state}'`), state);
    }
  });

  const row = (overrides: Partial<Parameters<typeof contactabilityState>[0]> = {}) => ({
    result: "ALLOWED",
    reasonCode: "ALLOWED",
    relationshipType: "THEY_CONTACTED_US",
    channel: "EMAIL",
    evidence: { suppression: null, consent_status: "UNKNOWN" },
    ...overrides,
  });

  test("suppression reasons map to the address and refusal states", () => {
    const cases: [string, string][] = [
      ["BOUNCE", "HARD_BOUNCE"],
      ["COMPLAINT", "COMPLAINT"],
      ["LEGAL", "LEGAL_HOLD"],
      ["INVALID", "INVALID"],
      ["MANUAL", "DO_NOT_CONTACT"],
      ["OPT_OUT", "OPTED_OUT"],
    ];
    for (const [reason, state] of cases) {
      assert.equal(
        contactabilityState(row({ result: "BLOCKED", reasonCode: "BLOCKED_OPT_OUT", evidence: { suppression: { reason } } })),
        state,
        reason,
      );
    }
  });

  test("temporary blocks are pauses, not refusals", () => {
    assert.equal(contactabilityState(row({ result: "BLOCKED", reasonCode: "BLOCKED_QUIET_HOURS" })), "TEMPORARILY_PAUSED");
    assert.equal(contactabilityState(row({ result: "BLOCKED", reasonCode: "BLOCKED_DAILY_LIMIT" })), "TEMPORARILY_PAUSED");
  });

  test("permission states", () => {
    assert.equal(contactabilityState(row()), "PERMITTED");
    assert.equal(contactabilityState(row({ relationshipType: "EXISTING_CUSTOMER" })), "EXISTING_CUSTOMER");
    assert.equal(contactabilityState(row({ evidence: { consent_status: "GRANTED" } })), "CONSENTED");
    assert.equal(contactabilityState(row({ evidence: { consent_status: "WITHDRAWN" } })), "OPTED_OUT");
  });

  test("LEGITIMATE_INTERESTS_REVIEWED requires an active LIA covering the channel", () => {
    const cold = row({ relationshipType: "FOUND_BY_US" });
    assert.equal(contactabilityState(cold), "PERMITTED");
    assert.equal(contactabilityState(cold, ["SMS"]), "PERMITTED");
    assert.equal(contactabilityState(cold, ["EMAIL"]), "LEGITIMATE_INTERESTS_REVIEWED");
  });

  test("SOFT_OPT_IN is never derived without a first-party sale or negotiation record (0131; see tests/engine-gaps)", () => {
    for (const relationshipType of ["EXISTING_CUSTOMER", "THEY_CONTACTED_US", "IMPORTED", "UNKNOWN"]) {
      assert.notEqual(contactabilityState(row({ relationshipType }), ["EMAIL"]), "SOFT_OPT_IN");
    }
  });

  test("a review is UNKNOWN", () => {
    assert.equal(contactabilityState(row({ result: "REVIEW_REQUIRED", reasonCode: "REVIEW_REQUIRED" })), "UNKNOWN");
  });
});
