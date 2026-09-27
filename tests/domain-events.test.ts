/**
 * The domain event outbox (docs/revenue-engine/03-phase1-spine-design.md §4):
 * the catalogue, the dispatcher's routing, loop protection, the re-score
 * triggers, and the emit sites (TypeScript and SQL).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  AUTOMATION_PROJECTION,
  DOMAIN_EVENT_TYPES,
  INTERNAL_EVENT_TYPES,
  MAX_CAUSATION_DEPTH,
  RESCORE_ON,
  exceedsCausationDepth,
  isKnownEventType,
  isWebhookForwarded,
  rescoreFor,
  webhookEventIdFor,
} from "../src/lib/events/types.ts";
import { WEBHOOK_EVENTS } from "../src/lib/webhooks/events.ts";
import { AUTOMATION_EVENT_TYPES } from "../src/lib/automation/event-types.ts";
import { leadScorePayload } from "../src/lib/jobs/handlers/payloads.ts";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");
const dir = path.join(root, "supabase", "migrations");
const migration = read("supabase", "migrations", readdirSync(dir).find((f) => f.startsWith("0123_"))!);

describe("catalogue", () => {
  test("the public catalogue is the design's §4 list", () => {
    assert.deepEqual([...DOMAIN_EVENT_TYPES].sort(), [
      "ai.escalated",
      "contact.suppressed",
      "contact.unsubscribed",
      "integration.failed",
      "lead.booking_ready",
      "lead.created",
      "lead.engaged",
      "lead.intent_changed",
      "lead.qualified",
      "lead.scored",
      "lead.touched",
      "meeting.booked",
      "meeting.cancelled",
      "meeting.no_show",
      "meeting.pending",
      "opportunity.created",
      "opportunity.lost",
      "opportunity.won",
      "prospect.created",
      "reply.received",
      "score.changed",
    ]);
  });

  test("every type fits the domain_events CHECK pattern", () => {
    for (const type of [...DOMAIN_EVENT_TYPES, ...INTERNAL_EVENT_TYPES]) {
      assert.match(type, /^[a-z_]+\.[a-z_]+$/);
      assert.equal(isKnownEventType(type), true);
    }
    assert.equal(isKnownEventType("lead.exploded"), false);
  });

  test("internal events never reach a customer webhook", () => {
    for (const type of INTERNAL_EVENT_TYPES) assert.equal(isWebhookForwarded(type), false);
    assert.equal(isWebhookForwarded("meeting.booked"), true);
  });
});

describe("webhook forwarding", () => {
  const outbox = read("src", "lib", "events", "outbox.ts");
  const forwarded = [...outbox.slice(outbox.indexOf("export const WEBHOOK_FORWARDED"), outbox.indexOf("] as const satisfies"))
    .matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]);

  test("the forwarded list is non-empty and inside the public catalogue", () => {
    assert.ok(forwarded.length >= 10);
    for (const type of forwarded) {
      assert.ok((DOMAIN_EVENT_TYPES as readonly string[]).includes(type), type);
    }
  });

  test("every forwarded type is subscribable in WEBHOOK_EVENTS, and every outbox entry there is forwarded", () => {
    const subscribable = new Set(WEBHOOK_EVENTS.map((event) => event.type as string));
    for (const type of forwarded) assert.ok(subscribable.has(type), `${type} is forwarded but not subscribable`);
    for (const event of WEBHOOK_EVENTS) {
      if (event.emittedBy !== "lib/events/outbox.ts") continue;
      assert.ok(forwarded.includes(event.type), `${event.type} claims the outbox but is not forwarded`);
    }
  });

  test("lead.created shares its webhook id with lead.process, so it is delivered once", () => {
    assert.equal(webhookEventIdFor({ id: "evt", type: "lead.created", subject_id: "lead-1" }), "lead-1");
    assert.equal(webhookEventIdFor({ id: "evt", type: "meeting.booked", subject_id: "b-1" }), "evt");
    assert.match(read("src", "lib", "jobs", "handlers", "lead-process.ts"), /eventId: lead\.id/);
  });

  test("the developer docs describe every new event", () => {
    const docs = read("docs", "DEVELOPER_PLATFORM.md");
    for (const type of forwarded) assert.ok(docs.includes(`\`${type}\``), `${type} is undocumented`);
  });
});

describe("loop protection", () => {
  test("anything deeper than three hops is dropped", () => {
    assert.equal(MAX_CAUSATION_DEPTH, 3);
    assert.equal(exceedsCausationDepth(3), false);
    assert.equal(exceedsCausationDepth(4), true);
  });

  test("scoring never triggers scoring", () => {
    assert.equal(RESCORE_ON.includes("lead.scored"), false);
    assert.equal(RESCORE_ON.includes("score.changed"), false);
    assert.equal(rescoreFor({ id: "e", type: "lead.scored", subject_type: "lead", subject_id: "L", payload: {} }), null);
  });

  test("the dispatcher checks depth before any consumer runs and marks the event dispatched", () => {
    const outbox = read("src", "lib", "events", "outbox.ts");
    const fn = outbox.slice(outbox.indexOf("export async function handleEventDispatch"));
    const check = fn.indexOf("exceedsCausationDepth(");
    const consumers = fn.indexOf("for (const consumer of EVENT_CONSUMERS)");
    assert.ok(check > 0 && consumers > check);
    assert.match(fn, /console\.warn\(/);
  });

  test("a re-score carries the causing event and one more hop", () => {
    const outbox = read("src", "lib", "events", "outbox.ts");
    assert.match(outbox, /causationDepth: event\.causation_depth \+ 1/);
  });
});

describe("re-score triggers, in one place", () => {
  const base = { id: "7b6f7c8e-7c1e-4f3a-9a53-1f4a5e2d9c10", subject_type: "lead", subject_id: "L1", payload: {} };

  test("reply classified, qualification answered, bookings, opt-out and lead touched re-score", () => {
    for (const type of [
      "reply.classified",
      "qualification.answered",
      "meeting.booked",
      "meeting.pending",
      "meeting.cancelled",
      "meeting.no_show",
      "contact.unsubscribed",
      "lead.touched",
    ]) {
      assert.deepEqual(rescoreFor({ ...base, type }), { leadId: "L1", triggerEvent: `${type}:${base.id}` }, type);
    }
  });

  test("qualification intelligence (08 §B.5): opportunity changes and decay boundaries re-assess", () => {
    for (const type of ["opportunity.created", "opportunity.stage_changed", "opportunity.won", "opportunity.lost"]) {
      assert.deepEqual(
        rescoreFor({ ...base, type, subject_type: "opportunity", subject_id: "O1", payload: { lead_id: "L7" } }),
        { leadId: "L7", triggerEvent: `${type}:${base.id}` },
        type,
      );
    }
    assert.deepEqual(rescoreFor({ ...base, type: "intent.decay_due" }), { leadId: "L1", triggerEvent: `intent.decay_due:${base.id}` });
    // A lost deal with no lead has nothing to re-assess.
    assert.equal(rescoreFor({ ...base, type: "opportunity.lost", subject_type: "opportunity", subject_id: "O1", payload: {} }), null);
  });

  test("an intent change never re-triggers the assessment that caused it", () => {
    assert.equal(RESCORE_ON.includes("lead.intent_changed"), false);
    assert.equal(rescoreFor({ ...base, type: "lead.intent_changed" }), null);
    assert.ok((INTERNAL_EVENT_TYPES as readonly string[]).includes("opportunity.stage_changed"));
    assert.ok((INTERNAL_EVENT_TYPES as readonly string[]).includes("intent.decay_due"));
  });

  test("the lead comes from the payload when the subject is not the lead", () => {
    assert.deepEqual(
      rescoreFor({ ...base, type: "reply.classified", subject_type: "message", subject_id: "M1", payload: { lead_id: "L9" } }),
      { leadId: "L9", triggerEvent: `reply.classified:${base.id}` },
    );
    assert.equal(rescoreFor({ ...base, type: "meeting.booked", subject_type: "booking", subject_id: "B", payload: {} }), null);
  });

  test("every trigger event is a valid lead.score payload", () => {
    for (const type of RESCORE_ON) {
      const parsed = leadScorePayload.safeParse({
        leadId: "7b6f7c8e-7c1e-4f3a-9a53-1f4a5e2d9c11",
        triggerEvent: `${type}:${base.id}`,
        causationId: base.id,
        causationDepth: 1,
      });
      assert.equal(parsed.success, true, type);
    }
  });
});

describe("automation_events projection", () => {
  test("projects only into the automation_events CHECK vocabulary", () => {
    for (const projected of Object.values(AUTOMATION_PROJECTION)) {
      assert.ok((AUTOMATION_EVENT_TYPES as readonly string[]).includes(projected!), projected);
    }
  });
});

describe("emit sites", () => {
  test("ingest emits lead.created / lead.touched", () => {
    const service = read("src", "lib", "ingest", "service.ts");
    assert.match(service, /await emitDomainEvent\(/);
    const plan = read("src", "lib", "ingest", "plan.ts");
    assert.match(plan, /"lead\.created"/);
    assert.match(plan, /"lead\.touched"/);
  });

  test("lead.score emits lead.intent_changed only when the state changed, keyed by the assessment row", () => {
    const handler = read("src", "lib", "jobs", "handlers", "lead-score.ts");
    assert.match(handler, /type: "lead\.intent_changed"/);
    assert.match(handler, /dedupeKey: `lead\.intent_changed:\$\{recorded\.assessmentId\}`/);
    assert.match(handler, /if \(recorded\.stateChanged\)/);
  });

  test("opportunities emit opportunity.stage_changed on an advance, once per stage", () => {
    const service = read("src", "lib", "opportunities", "service.ts");
    assert.match(service, /type: "opportunity\.stage_changed"/);
    assert.match(service, /dedupeKey: `opportunity\.stage_changed:\$\{input\.opportunityId\}:\$\{input\.stage\}`/);
  });

  test("the intent sweep emits intent.decay_due through the outbox and is scheduled by the worker", () => {
    const sweep = read("src", "lib", "jobs", "handlers", "intent-sweep.ts");
    assert.match(sweep, /type: "intent\.decay_due"/);
    assert.match(read("src", "lib", "jobs", "register.ts"), /registerHandler\("intent\.sweep", handleIntentSweep\)/);
    assert.match(read("src", "app", "api", "cron", "worker", "route.ts"), /await scheduleIntentSweep\(\)/);
  });

  test("lead.score emits lead.scored and score.changed, keyed by the score row", () => {
    const handler = read("src", "lib", "jobs", "handlers", "lead-score.ts");
    assert.match(handler, /type: "lead\.scored"/);
    assert.match(handler, /dedupeKey: `lead\.scored:\$\{outcome\.scoreId\}`/);
    assert.match(handler, /if \(outcome\.gradeChanged\)/);
    assert.match(handler, /type: "score\.changed"/);
  });

  test("bookings, handoffs, suppressions, replies and answers emit from triggers in the same transaction", () => {
    for (const trigger of [
      "create trigger bookings_emit_domain_event",
      "create trigger agent_handoffs_emit_domain_event",
      "create trigger messages_emit_domain_event",
      "create trigger qualification_answers_emit_domain_event",
      "create trigger suppression_entries_sync_leads",
    ]) {
      assert.ok(migration.includes(trigger), trigger);
    }
    for (const type of [
      "'meeting.pending'",
      "'meeting.booked'",
      "'meeting.cancelled'",
      "'meeting.no_show'",
      "'ai.escalated'",
      "'reply.received'",
      "'reply.classified'",
      "'qualification.answered'",
      "'contact.unsubscribed'",
      "'contact.suppressed'",
    ]) {
      assert.ok(migration.includes(type), type);
    }
  });

  test("an outbox failure in a trigger can never fail the business write", () => {
    const fn = migration.slice(migration.indexOf("function public.emit_domain_event_safe"));
    assert.match(fn.slice(0, fn.indexOf("$$;")), /exception when others then\s+raise warning/);
  });

  test("emit is idempotent on dedupe_key and queues exactly one dispatch", () => {
    const fn = migration.slice(migration.indexOf("function public.emit_domain_event("));
    const body = fn.slice(0, fn.indexOf("$$;"));
    assert.match(body, /on conflict \(dedupe_key\) do nothing/);
    assert.match(body, /'event\.dispatch'/);
    assert.match(body, /'event\.dispatch:' \|\| v_id/);
  });

  test("the event.dispatch and ingest.webhook jobs are registered", () => {
    const register = read("src", "lib", "jobs", "register.ts");
    assert.match(register, /registerHandler\("event\.dispatch", handleEventDispatch\)/);
    assert.match(register, /registerHandler\("ingest\.webhook", handleIngestWebhook\)/);
  });

  test("domain_events and ingest_requests are server-only; the read tables are member-read", () => {
    const rls = migration.slice(migration.indexOf("-- RLS"));
    assert.match(rls, /'lead_touches','merge_events','merge_candidates','legitimate_interest_assessments'/);
    assert.match(rls, /array\['ingest_requests','domain_events'\]/);
    assert.match(rls, /force row level security/);
  });
});
