/**
 * Story R: intent-driven re-engagement (reengagement/*).
 *
 *   R1 a lead who said "not now, try me in March" is re-contacted at their
 *      resume date through the normal agent path (a FOLLOW_UP_DUE turn), with
 *      the conversation (their own words) in front of the model;
 *   R2 a booking marked no-show gets one rebooking message, planned by the
 *      domain-event consumer; the 24h nudge is then held back by the
 *      cross-loop frequency guard (1 automated touch a day) rather than sent
 *      straight after it.
 *
 * Same safety design as every story (README.md). The harness clock: the
 * resume date is set in the past, and each lead's earlier messages are moved
 * back in time so the frequency guard judges the trigger on its own (the
 * form's instant first text would otherwise, correctly, defer it a day).
 * Delayed trigger jobs are fast-forwarded. Imported after Q, so the engine is
 * LIVE, as it is for a workspace that records NOT_NOW signals.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as H from "./harness.ts";
import { check, configureBusiness } from "./kit.ts";
import { RUN } from "./safety.ts";

const { admin } = H;
const DAY = 86_400_000;

async function formLead(label: string) {
  const { ingestLead } = await import("../../src/lib/ingest/service.ts");
  const { data: service } = await admin.from("services").select("id").eq("business_id", H.mustWorld().businessId).eq("active", true).limit(1).single();
  const person = { email: H.testEmail(label), phone: H.dramaPhone() };
  const result = await ingestLead({
    businessId: H.mustWorld().businessId,
    serviceId: service!.id as string,
    source: {
      type: "AD_FORM",
      provider: "meta",
      providerRecordId: `r-${RUN}-${label}`,
      formId: "FORM_R",
      caller: { type: "SYSTEM", id: "story" },
      submittedAt: new Date().toISOString(),
    },
    person: {
      firstName: label.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
      lastName: "Story",
      email: person.email,
      phone: person.phone,
      companyName: `${label} Ltd`,
      postcode: "LS6 2AB",
    },
  });
  await H.runJobs();
  return { ...person, leadId: result.leadId as string };
}

/** The harness clock: this lead's history happened `days` ago. */
async function ageMessages(leadId: string, days: number) {
  const { data } = await admin.from("messages").select("id, created_at, sent_at").eq("lead_id", leadId);
  for (const row of (data ?? []) as { id: string; created_at: string; sent_at: string | null }[]) {
    await H.must(
      admin
        .from("messages")
        .update({
          created_at: new Date(Date.parse(row.created_at) - days * DAY).toISOString(),
          ...(row.sent_at ? { sent_at: new Date(Date.parse(row.sent_at) - days * DAY).toISOString() } : {}),
        })
        .eq("id", row.id),
      "age message",
    );
  }
}

describe("R. Re-engagement: NOT_NOW resume and no-show rebooking", () => {
  before(async () => {
    await configureBusiness({
      name: "Keystone Digital",
      archetype: "MARKETING_AGENCY",
      motions: ["BOOK_MEETING_B2B"],
      industryCode: "73.11",
      bookingMode: "handover",
      services: [{ name: "SEO retainer", averageValue: 3000 }],
      questions: [{ text: "What are you hoping to improve first?", type: "text", required: false }],
    });
    H.scriptAi(null);
    H.signInAsOwner();
  });

  after(() => H.scriptAi(null));

  test("R1 a NOT_NOW lead is re-contacted at the resume date through the agent", async () => {
    await check(
      {
        id: "R1",
        flow: "Re-engagement: NOT_NOW resume",
        scenario: "lead says 'not now, try me in March'; resume date reached",
        expected: "NOT_NOW signal with resume_at; at resume a reengage.trigger runs, opens one FOLLOW_UP_DUE agent turn keyed on the signal, the model sees the lead's own words, and one SMS goes out",
      },
      async () => {
        const p = await formLead("rhea.notnow");
        await H.leadSays(p.phone, "Thanks, but not right now. Try me again in March please.");
        const { data: signals } = await admin
          .from("lead_intent_signals")
          .select("id, resume_at, observed_at")
          .eq("lead_id", p.leadId)
          .eq("signal_type", "NOT_NOW")
          .is("retracted_at", null)
          .order("observed_at", { ascending: false })
          .limit(1);
        const signal = signals?.[0] as { id: string; resume_at: string | null } | undefined;
        assert.ok(signal?.resume_at, `no NOT_NOW signal with a resume date: ${JSON.stringify(signals)}`);
        const statedResume = signal.resume_at;

        // Harness clock: the conversation was 40 days ago; the resume date was two hours ago.
        await ageMessages(p.leadId, 40);
        const past = new Date(Date.now() - 2 * 3_600_000).toISOString();
        await H.must(
          admin
            .from("lead_intent_signals")
            .update({ observed_at: new Date(Date.now() - 40 * DAY).toISOString(), resume_at: past, flat_until: past, expires_at: past })
            .eq("id", signal.id),
          "signal resume in the past",
        );

        const { planIntentTriggersForLead } = await import("../../src/lib/reengagement/planner.ts");
        // The outbox consumer usually planned it already, when the NOT_NOW was
        // scored (a job due at the original resume date); planning again is a
        // no-op then. Either way exactly one trigger job exists.
        const planned = await planIntentTriggersForLead(H.mustWorld().businessId, p.leadId);
        const { data: triggerJobs } = await admin.from("jobs").select("id, state").eq("idempotency_key", `reengage.trigger:NOT_NOW_RESUME:${signal.id}`);
        assert.equal(triggerJobs?.length, 1, `trigger jobs=${JSON.stringify(triggerJobs)} (planned now: ${planned})`);
        const sent = H.smsOutbox.length;
        const aiBefore = H.aiCalls.length;
        const logBefore = H.jobLog.length;
        await H.runJobs({ fastForward: ["reengage.trigger", "lead.score"] });

        const { data: runs } = await admin
          .from("conversation_agent_runs")
          .select("id, trigger_event_type, idempotency_key, outcome, status, error_code")
          .eq("lead_id", p.leadId)
          .eq("trigger_event_type", "FOLLOW_UP_DUE");
        const jobs = H.jobLog.slice(logBefore);
        assert.equal(runs?.length, 1, `FOLLOW_UP_DUE runs=${JSON.stringify(runs)}; jobs=${JSON.stringify(jobs)}`);
        assert.equal((runs![0] as { idempotency_key: string }).idempotency_key, `reengage:NOT_NOW_RESUME:${signal.id}`);
        const texts = H.smsOutbox.slice(sent).filter((m) => m.to === p.phone);
        assert.equal(texts.length, 1, `SMS after resume: ${JSON.stringify(texts)}; run=${JSON.stringify(runs![0])}`);
        const prompt = H.aiCalls.slice(aiBefore).find((c) => c.taskType === "agent_decision")?.user ?? "";
        assert.match(prompt, /March/, "the model did not see what the lead said");
        return `signal resume ${statedResume} -> moved to ${past}; run ${(runs![0] as { outcome: string }).outcome}; SMS "${texts[0].body.slice(0, 80)}"`;
      },
    );
  });

  test("R2 a no-show gets one rebooking message; the 24h nudge is held by the frequency guard", async () => {
    await check(
      {
        id: "R2",
        flow: "Re-engagement: no-show rebooking",
        scenario: "a scheduled meeting is marked no-show",
        expected: "meeting.no_show plans NO_SHOW_REBOOK (+15 min) and NO_SHOW_NUDGE (+24h); one rebooking message is sent with origin automation and send key reengage:NO_SHOW_REBOOK:<booking>; the nudge, fast-forwarded to now, is deferred then skipped by the 1-a-day cap",
      },
      async () => {
        const p = await formLead("rory.noshow");
        await ageMessages(p.leadId, 3);
        const w = H.mustWorld();
        const starts = new Date(Date.now() - 2 * 3_600_000);
        const { data: booking } = await H.must(
          admin
            .from("bookings")
            .insert({
              business_id: w.businessId,
              lead_id: p.leadId,
              provider: "manual",
              status: "scheduled",
              starts_at: starts.toISOString(),
              ends_at: new Date(starts.getTime() + 3_600_000).toISOString(),
            })
            .select("id")
            .single(),
          "booking",
        );
        const bookingId = (booking as { id: string }).id;
        await admin.from("leads").update({ status: "BOOKED", booked_at: starts.toISOString() }).eq("id", p.leadId);
        await H.runJobs();
        // Backdate the booking row too: the rebook must not read it as "booked since".
        await H.must(admin.from("bookings").update({ status: "no_show" }).eq("id", bookingId), "mark no-show");
        await H.runJobs({ fastForward: ["reengage.trigger"] });

        const { data: messages } = await admin
          .from("messages")
          .select("id, send_key, status, origin, channel, body, error_code")
          .eq("lead_id", p.leadId)
          .like("send_key", "reengage:%");
        const rebook = (messages ?? []).filter((m) => (m.send_key as string).startsWith("reengage:NO_SHOW_REBOOK:"));
        const nudge = (messages ?? []).filter((m) => (m.send_key as string).startsWith("reengage:NO_SHOW_NUDGE:"));
        assert.equal(rebook.length, 1, `messages=${JSON.stringify(messages)}`);
        assert.equal(rebook[0].send_key, `reengage:NO_SHOW_REBOOK:${bookingId}`);
        assert.equal(rebook[0].status, "SENT", `rebook ${JSON.stringify(rebook[0])}`);
        assert.equal(rebook[0].origin, "automation");
        assert.equal(nudge.length, 0, `the nudge went straight after the rebook: ${JSON.stringify(nudge)}`);
        const { data: audit } = await admin
          .from("audit_log")
          .select("action, metadata")
          .eq("business_id", w.businessId)
          .eq("entity_id", p.leadId)
          .in("action", ["reengagement.trigger_fired", "reengagement.trigger_skipped"]);
        const skippedNudge = (audit ?? []).find(
          (row) => row.action === "reengagement.trigger_skipped" && (row.metadata as { trigger?: string }).trigger === "NO_SHOW_NUDGE",
        );
        assert.equal((skippedNudge?.metadata as { reason?: string } | undefined)?.reason, "frequency", `audit=${JSON.stringify(audit)}`);
        return `rebook ${rebook[0].channel} "${String(rebook[0].body).slice(0, 80)}"; nudge ${JSON.stringify(skippedNudge?.metadata)}`;
      },
    );
  });
});
