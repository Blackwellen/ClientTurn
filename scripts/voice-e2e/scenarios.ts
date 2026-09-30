/**
 * The call scenarios the wiring harness replays (see harness.ts). Each step
 * sends what Retell sends, then asserts the database effect.
 */
import { VoiceHarness, londonInstant, londonParts, nextWeekday, type Json } from "./harness.ts";

type CallRef = { id: string; providerCallId: string };

async function one<T = Json>(h: VoiceHarness, table: string, match: Record<string, string>, columns = "*"): Promise<T | null> {
  let q = h.admin.from(table).select(columns);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T | null;
}

async function many<T = Json>(h: VoiceHarness, table: string, match: Record<string, string>, columns = "*"): Promise<T[]> {
  let q = h.admin.from(table).select(columns);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = await q.limit(200);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}

function retellCall(call: CallRef, extra: Json = {}): Json {
  return { call_id: call.providerCallId, call_status: "ongoing", metadata: { voice_call_id: call.id }, ...extra };
}

/* ======================================================= the brief */

export async function briefFor(h: VoiceHarness, callId: string): Promise<{ text: string; vars: Record<string, string> } | null> {
  const { serverVoiceDeps } = await import("../../src/lib/voice/server-deps.ts");
  const { loadVoiceCallBrief } = await import("../../src/lib/voice/server-p3.ts");
  const { buildLockedPreamble } = await import("../../src/lib/voice/opener.ts");
  const deps = serverVoiceDeps();
  const call = await deps.repo.loadCall(callId);
  if (!call) return null;
  const ctx = await deps.repo.loadDialContext(call.business_id, call.lead_id, call.route, call.id);
  const identity = { callingAsName: "Blackwellen", legalEntityName: "Blackwellen Ltd", identificationContact: "hello@blackwellen-demo.example", personaName: "Ellie" };
  const preamble = buildLockedPreamble({ callingAsName: "Blackwellen", enquiryAt: new Date(), now: new Date(), timezone: "Europe/London", recordingEnabled: false });
  const brief = await loadVoiceCallBrief({ call, ctx, identity, preamble } as never);
  if (!brief) return null;
  return { text: brief.dynamicVariables.call_brief ?? "", vars: brief.dynamicVariables };
}

/* ================================================ the main call */

export async function qualificationCall(h: VoiceHarness, calendar: "google" | "calendly" | "none") {
  h.step = `call:${calendar}:setup`;
  const now = new Date();
  // Calendar per scenario.
  await h.disconnectCalendars();
  if (calendar === "google") {
    await h.connectCalendar("google");
    await h.setSettings({ booking_mode: "google_calendar", booking_url: "https://calendly.com/blackwellen-demo/intro", ai_assist_enabled: true });
  } else if (calendar === "calendly") {
    await h.connectCalendar("calendly");
    await h.setSettings({ booking_mode: "calendly", booking_url: "https://calendly.com/blackwellen-demo/intro", ai_assist_enabled: true });
  } else {
    await h.setSettings({ booking_mode: "handover", booking_url: null, ai_assist_enabled: true });
  }
  await h.setVoiceSettings({ voice_enabled: true });

  // Busy blocks / Calendly times for the next open weekday.
  const day = nextWeekday(now, 1);
  const nine = londonInstant(day, 9, 0);
  const tenFifteen = londonInstant(day, 10, 15);
  h.setState({
    google: { busy: [{ start: nine, end: londonInstant(day, 10, 0) }], events: [] },
    calendly: { available: [londonInstant(day, 11, 0), londonInstant(day, 14, 30), londonInstant(nextWeekday(day, 1), 9, 30)].map((t) => ({ start_time: t })) },
    retell: { calls: {} },
  });

  const lead = await h.createLead(calendar);
  const call = await h.createCall(lead);
  const refs = { leadIds: [lead.id], callIds: [call.id] };

  // Minutes held as dialCall holds them.
  const { reserveCallMinutes } = await import("../../src/lib/voice/minutes.ts");
  const reserved = await reserveCallMinutes({ businessId: h.businessId, callId: call.id, route: "QUALIFICATION", seconds: 420 });
  h.check("minutes reserved before the call", reserved.ok === true, reserved);
  if (reserved.ok) await h.admin.from("voice_calls").update({ reserved_sec: reserved.reservation.heldSec }).eq("id", call.id);

  /* ---- the brief states the right booking capability ---- */
  h.step = `call:${calendar}:brief`;
  const brief = await briefFor(h, call.id);
  h.check("brief built", Boolean(brief?.text));
  const text = brief?.text ?? "";
  h.check("brief carries a QUESTION PLAN with keys", /QUESTION PLAN/.test(text) && /\[(BUDGET|TIMING|AUTHORITY)\]/.test(text), text.slice(0, 900));
  if (calendar === "none") {
    h.check("no calendar: brief never offers check_availability", !/call check_availability/i.test(text) || /never call check_availability/i.test(text), text);
  } else {
    h.check(`${calendar}: brief offers real times via check_availability`, /check_availability/.test(text) && !/NO CALENDAR ON THIS CALL/.test(text) && !/BOOKING IS OFF/.test(text), text);
  }
  h.log("BRIEF", text);

  /* ---- call_started ---- */
  h.step = `call:${calendar}:started`;
  const started = await h.webhook("call_started", retellCall(call, { start_timestamp: Date.now() }));
  h.check("call_started accepted (204)", started === 204, started);
  let jobs = await h.runJobs(refs);
  if ((await callState(h, call.id)) !== "IN_CONVERSATION") await h.explainIngest(call.providerCallId);
  h.check("webhook ingest ran", jobs.some((j) => j.type === "voice.webhook_ingest" && j.ok) || (await callState(h, call.id)) === "IN_CONVERSATION", jobs);
  const afterStart = await one<{ state: string; answered_at: string | null }>(h, "voice_calls", { id: call.id }, "state, answered_at");
  h.check("call IN_CONVERSATION with answered_at", afterStart?.state === "IN_CONVERSATION" && Boolean(afterStart?.answered_at), afterStart);

  /* ---- record_fact for each plan question ---- */
  h.step = `call:${calendar}:record_fact`;
  const questions = await many<{ id: string; dimension_key: string | null; response_type: string; required: boolean }>(h, "qualification_questions", { business_id: h.businessId, active: "true" }, "id, dimension_key, response_type, required");
  const byDim = new Map(questions.map((q) => [q.dimension_key ?? `Q.${q.id}`, q]));
  // The plan's keys, answered as a lead would say them (spoken forms, not option codes).
  const answers: [string, string][] = [
    ["SERVICE_NEEDED", "A new website, yes"],
    ["BUDGET", "under five grand, so under £5,000"],
    ["TIMING", "next month ideally"],
    ["AUTHORITY", "Me and my business partner decide together"],
  ];
  for (const [key, value] of answers) {
    const r = await h.tool(call, "record_fact", { dimension: key, value });
    h.check(`record_fact ${key} answered ok`, r.status === 200 && r.json?.ok === true, r.json);
    const q = byDim.get(key);
    if (q) {
      const a = await one<{ answer_value: string | null; source: string }>(h, "qualification_answers", { lead_id: lead.id, question_id: q.id }, "answer_value, source, answer_text");
      h.check(`record_fact ${key} reached qualification_answers for its configured question`, Boolean(a), a);
      if (q.response_type !== "text") h.check(`record_fact ${key}: the spoken answer matched an option deterministically`, Boolean(a?.answer_value), a);
    }
  }
  const facts = await many<{ dimension: string; question_id: string | null; source: string; state: string }>(h, "lead_qualification_facts", { lead_id: lead.id }, "dimension, question_id, source, state, value");
  h.check("call facts stored (not only LEAD_FIELD)", facts.some((f) => f.source === "AI_ASSIST" || f.source === "REPLY"), facts);
  h.check("call facts carry their configured question id", facts.filter((f) => ["BUDGET", "TIMING", "AUTHORITY"].includes(f.dimension)).length === 3 && facts.filter((f) => ["BUDGET", "TIMING", "AUTHORITY"].includes(f.dimension)).every((f) => Boolean(f.question_id)), facts);
  jobs = await h.runJobs(refs);
  const leadRow = await one<{ qualification_state: string; qualification_completeness: number | null; intent_state: string | null; assessed_at: string | null }>(
    h,
    "leads",
    { id: lead.id },
    "qualification_state, qualification_completeness, intent_state, assessed_at, next_action",
  );
  h.check("lead re-assessed after the answers (lead.score ran)", Boolean(leadRow?.assessed_at), { leadRow, jobs });
  h.check("qualification engine re-ran: QUALIFIED on the rules", leadRow?.qualification_state === "QUALIFIED", leadRow);
  h.check("completeness moved above 0", (leadRow?.qualification_completeness ?? 0) > 0, leadRow);
  const signals = await many(h, "lead_intent_signals", { lead_id: lead.id }, "signal_type, source, source_ref");
  h.log("signals", signals);

  /* ---- log_objection ---- */
  h.step = `call:${calendar}:objection`;
  const obj = await h.tool(call, "log_objection", { key: "PRICE", excerpt: "sounds pricey", handled: "PARTIALLY_RESOLVED" });
  h.check("log_objection ok", obj.json?.ok === true, obj.json);
  const objRow = await one(h, "objection_events", { voice_call_id: call.id, objection_key: "PRICE" }, "id, channel, handled_outcome");
  h.check("objection_events row (VOICE)", Boolean(objRow), objRow);

  /* ---- check_availability / book_meeting ---- */
  h.step = `call:${calendar}:availability`;
  const avail = await h.tool(call, "check_availability", { date: londonParts(nine).ymd });
  const slots = ((avail.json?.data as Json | undefined)?.slots ?? []) as { start: string; end: string; label: string }[];
  if (calendar === "none") {
    h.check("no calendar: check_availability refused, never a made-up time", avail.json?.ok === false && slots.length === 0, avail.json);
  } else {
    h.check(`${calendar}: check_availability returns slots`, avail.json?.ok === true && slots.length > 0, avail.json);
    for (const s of slots) {
      const p = londonParts(s.start);
      if (calendar === "google") {
        h.check(`google slot ${p.hhmm} inside 09:00-17:30 and after the 09:00-10:00 busy block + 15m buffer`, p.ymd === londonParts(nine).ymd && p.hhmm >= "10:15" && p.hhmm <= "17:00", { slot: s, p });
      } else {
        h.check(`calendly slot ${p.hhmm} is one Calendly offered`, [londonInstant(day, 11, 0), londonInstant(day, 14, 30)].includes(new Date(s.start).toISOString()), s);
      }
      const [hh, mm] = p.hhmm.split(":").map(Number);
      const twelve = `${hh % 12 === 0 ? 12 : hh % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${hh < 12 ? "am" : "pm"}`;
      const twelveLong = `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")}${hh < 12 ? "am" : "pm"}`;
      h.check(`slot label is London time (${s.label})`, s.label.includes(twelve) || s.label.includes(twelveLong), { label: s.label, twelve });
    }
    const calendlyCall = h.providerLog().find((e) => e.host === "api.calendly.com");
    if (calendar === "calendly") h.check("Calendly was asked with a valid range (start in the future)", calendlyCall?.status === 200, calendlyCall);
    const say = String(avail.json?.say ?? "");
    h.check("the spoken times come from the tool's slots", slots.length === 0 || say.length > 0, say);

    h.step = `call:${calendar}:book`;
    const notOffered = await h.tool(call, "book_meeting", { start_iso: tenFifteen.replace(":15:", ":45:") });
    h.check("book_meeting at a time never offered is refused NOT_OFFERED", notOffered.json?.ok === false && notOffered.json?.code === "NOT_OFFERED", notOffered.json);
    if (slots[0]) {
      const booked = await h.tool(call, "book_meeting", { start_iso: slots[0].start });
      const bookings = await many<{ status: string; provider: string; starts_at: string; external_event_id: string | null }>(h, "bookings", { lead_id: lead.id }, "status, provider, starts_at, external_event_id, notes");
      if (calendar === "google") {
        h.check("google: book_meeting confirmed", booked.json?.ok === true && (booked.json?.data as Json)?.outcome === "confirmed", booked.json);
        h.check("google: booking row scheduled with the event id", bookings.length === 1 && bookings[0].status === "scheduled" && bookings[0].provider === "google_calendar" && Boolean(bookings[0].external_event_id), bookings);
        const events = ((h.state().google as Json)?.events ?? []) as { start: string; end: string; attendees: string[]; sendUpdates: string | null }[];
        h.check("google: exactly one event written at the offered time, with the lead invited", events.length === 1 && events[0].start === new Date(slots[0].start).toISOString() && events[0].attendees.includes(lead.email) && events[0].sendUpdates === "all", events);
        const again = await h.tool(call, "book_meeting", { start_iso: slots[1]?.start ?? slots[0].start });
        h.check("google: a second booking for the lead is refused (no double booking)", again.json?.ok === false, again.json);
        h.check("google: still one event at the provider", (((h.state().google as Json)?.events ?? []) as unknown[]).length === 1);
      } else {
        h.check("calendly: book_meeting holds the chosen time (not a dead end)", booked.json?.ok === true, booked.json);
        h.check("calendly: a pending booking request exists at the chosen time", bookings.length === 1 && bookings[0].status === "pending" && Date.parse(bookings[0].starts_at) === Date.parse(slots[0].start), bookings);
      }
    }
  }

  /* ---- schedule_callback: past time, then a time and a correction ---- */
  h.step = `call:${calendar}:callback`;
  const past = await h.tool(call, "schedule_callback", { at_iso: new Date(Date.now() - 30 * 60_000).toISOString(), by: "AI" });
  h.check("a past call-back time is refused PAST_TIME with a reprompt", past.json?.ok === false && past.json?.code === "PAST_TIME" && String(past.json?.say ?? "").length > 0, past.json);
  const cbDay = nextWeekday(now, 1);
  const cb1 = londonInstant(cbDay, 17, 0);
  const cb2 = londonInstant(cbDay, 18, 0);
  const first = await h.tool(call, "schedule_callback", { at_iso: cb1, by: "AI", note: "after work" });
  h.check("call-back accepted", first.json?.ok === true, first.json);
  const second = await h.tool(call, "schedule_callback", { at_iso: cb2, by: "AI", note: "corrected to 6pm" });
  h.check("corrected call-back accepted", second.json?.ok === true, second.json);
  h.check("the read-back says 6pm", /6pm/.test(String(second.json?.say ?? "")), second.json?.say);
  const callbacks = await many<{ id: string; state: string; route: string }>(h, "voice_calls", { lead_id: lead.id }, "id, state, route, queued_at");
  const queued = callbacks.filter((c) => c.id !== call.id && !["CANCELLED"].includes(c.state));
  const data2 = second.json?.data as Json | undefined;
  if (data2?.callback_call_id) {
    h.check("AI call-back: exactly one live call-back after the correction", queued.length === 1 && queued[0].id === data2.callback_call_id, callbacks);
    const q = await one<{ not_before: string }>(h, "voice_call_queue", { voice_call_id: String(data2.callback_call_id) }, "not_before");
    h.check("AI call-back queued for 18:00 UK time", q ? londonParts(q.not_before).hhmm === "18:00" : false, q);
  } else {
    const notes = await many<{ body: string }>(h, "lead_notes", { lead_id: lead.id }, "body, author_kind");
    h.check("person call-back: a note on the lead says 18:00 UK time", notes.some((n) => /Call back .*18:00/.test(n.body)), notes);
    h.check("person call-back: the superseded 17:00 is not the latest note", /18:00/.test(notes[notes.length - 1]?.body ?? ""), notes);
    h.notes.push(`schedule_callback by AI fell back to PERSON: ${JSON.stringify(data2)}`);
  }

  /* ---- send_booking_link ---- */
  if (calendar !== "none") {
    h.step = `call:${calendar}:booking_link`;
    const link = await h.tool(call, "send_booking_link", { channel: "email" });
    h.check("send_booking_link queued through the send path", link.json?.ok === true, link.json);
    const msg = await many<{ status: string; channel: string; body: string }>(h, "messages", { lead_id: lead.id }, "status, channel, body");
    h.check("a queued (not sent) email carries the configured link", msg.some((m) => m.channel === "email" && m.body.includes("calendly.com/blackwellen-demo/intro") && m.status !== "sent"), msg);
  }

  /* ---- end_call_summary, call_ended, call_analyzed ---- */
  h.step = `call:${calendar}:end`;
  const summary = await h.tool(call, "end_call_summary", { summary: "Qualified lead, keen on a new site.", disposition: calendar === "none" ? "CALLBACK_REQUESTED" : "MEETING_BOOKED", next_step: "Discovery meeting" });
  h.check("end_call_summary ok", summary.json?.ok === true, summary.json);
  h.check("the stored summary is guarded (no unearned 'qualified')", !/qualified lead/i.test(String((summary.json?.data as Json)?.summary ?? "")) || (await one<{ qualification_state: string }>(h, "leads", { id: lead.id }, "qualification_state"))?.qualification_state === "QUALIFIED", summary.json?.data);

  const endMs = Date.now();
  const state = h.state();
  const transcript = [
    { role: "agent", content: "Hi, is that Voicee2e? It's Ellie, the AI assistant for Blackwellen.", words: [{ start: 0.2, end: 3 }] },
    { role: "user", content: "Yes. About ten to fifteen grand, next month.", words: [{ start: 3.5, end: 6 }] },
    { role: "agent", content: "Thanks for your time. You've been speaking with Blackwellen's AI assistant, powered by ClientTurn.", words: [{ start: 80, end: 84 }] },
  ];
  (state.retell as Json).calls = { [call.providerCallId]: { call_id: call.providerCallId, call_status: "ended", start_timestamp: endMs - 95_000, end_timestamp: endMs, duration_ms: 95_000, disconnection_reason: "user_hangup", transcript_object: transcript, metadata: { voice_call_id: call.id }, call_cost: { combined_cost: 12 } } };
  h.setState(state);
  const ended = await h.webhook("call_ended", retellCall(call, { call_status: "ended", end_timestamp: endMs, duration_ms: 95_000, disconnection_reason: "user_hangup" }));
  h.check("call_ended accepted", ended === 204, ended);
  jobs = await h.runJobs(refs);
  h.check("ingest + post-call ran", jobs.some((j) => j.type === "voice.post_call" && j.ok), jobs);
  const analyzed = await h.webhook("call_analyzed", retellCall(call, { call_status: "ended", end_timestamp: endMs, call_analysis: { call_summary: "Provider summary", call_successful: true } }));
  h.check("call_analyzed accepted", analyzed === 204, analyzed);
  jobs = await h.runJobs(refs);
  h.check("no job failed in the chain", jobs.every((j) => j.ok), jobs);
  const finalCall = await one<{ state: string; billed_sec: number | null; duration_sec: number | null; outcome: string | null }>(h, "voice_calls", { id: call.id }, "state, billed_sec, duration_sec, outcome");
  h.check("call COMPLETE, 95 s billed", finalCall?.state === "COMPLETE" && finalCall?.billed_sec === 95 && finalCall?.outcome === "COMPLETED", finalCall);
  const reservation = await one<{ status: string; billed_sec: number | null }>(h, "voice_minute_reservations", { voice_call_id: call.id }, "status, billed_sec");
  h.check("minutes reservation SETTLED to the second", reservation?.status === "SETTLED" && reservation?.billed_sec === 95, reservation);
  const outcome = await one<{ disposition: string; summary: string; attribution_spoken: boolean | null }>(h, "voice_call_outcomes", { voice_call_id: call.id }, "disposition, summary, next_action, attribution_spoken");
  h.check("outcome stored with the agent's summary", Boolean(outcome?.summary) && !/Provider summary/.test(outcome?.summary ?? ""), outcome);
  h.check("closing attribution detected as spoken", outcome?.attribution_spoken === true, outcome);
  const transcriptRows = await many(h, "voice_call_transcripts", { voice_call_id: call.id }, "voice_call_id");
  h.check("transcript saved", transcriptRows.length > 0, transcriptRows.length);
  const events = await many<{ event_type: string }>(h, "voice_call_events", { voice_call_id: call.id }, "event_type, applied");
  h.check("call events recorded (started, ended, analyzed)", ["CALL_STARTED", "CALL_ENDED", "CALL_ANALYZED"].every((t) => events.some((e) => e.event_type === t)), events);
  const toolRows = await many<{ tool: string; status: string; latency_ms: number }>(h, "voice_tool_calls", { voice_call_id: call.id }, "tool, status, latency_ms, refusal_code");
  h.check("every tool call recorded", toolRows.length >= 8, toolRows.length);
  const leadEnd = await one(h, "leads", { id: lead.id }, "qualification_state, qualification_completeness, next_action, status, opted_out");
  h.log("lead after call", leadEnd);
  const pendingFollowUps = await many<{ type: string; state: string; run_at: string }>(h, "jobs", { business_id: h.businessId, state: "pending" }, "type, state, run_at, payload");
  h.log("pending jobs", pendingFollowUps.filter((j) => JSON.stringify(j).includes(lead.id)).map((j) => `${j.type}@${j.run_at}`));
  return { lead, call };
}

async function callState(h: VoiceHarness, id: string): Promise<string | null> {
  return (await one<{ state: string }>(h, "voice_calls", { id }, "state"))?.state ?? null;
}

/* ============================================== the opt-out call */

export async function optOutCall(h: VoiceHarness) {
  h.step = "optout:setup";
  await h.disconnectCalendars();
  await h.setSettings({ booking_mode: "handover", booking_url: "https://calendly.com/blackwellen-demo/intro", ai_assist_enabled: true });
  const lead = await h.createLead("optout", { automation_active: true });
  const call = await h.createCall(lead);
  const refs = { leadIds: [lead.id], callIds: [call.id] };
  await h.webhook("call_started", retellCall(call, { start_timestamp: Date.now() }));
  await h.runJobs(refs);

  h.step = "optout:tools";
  const cb = await h.tool(call, "schedule_callback", { at_iso: londonInstant(nextWeekday(new Date(), 1), 11, 0), by: "PERSON" });
  h.check("a call-back set before the opt-out", cb.json?.ok === true, cb.json);
  const out = await h.tool(call, "opt_out", { scope: "ALL" });
  h.check("opt_out ALL ok", out.json?.ok === true, out.json);
  const after = await h.tool(call, "send_booking_link", { channel: "email" });
  h.check("after the opt-out nothing more is sent (OPTED_OUT)", after.json?.ok === false && after.json?.code === "OPTED_OUT", after.json);
  const leadRow = await one<{ opted_out: boolean; automation_active: boolean }>(h, "leads", { id: lead.id }, "opted_out, automation_active");
  h.check("lead opted out, automation off", leadRow?.opted_out === true && leadRow?.automation_active === false, leadRow);
  const optNotes = await many<{ body: string }>(h, "lead_notes", { lead_id: lead.id }, "body");
  h.check("a note on the lead says no further contact", optNotes.some((n) => /Opted out on an AI call/.test(n.body)), optNotes);
  const sup = await h.admin.from("suppression_entries").select("channel, phone_e164, email").eq("business_id", h.businessId).or(`phone_e164.eq.${lead.phone},email.eq.${lead.email}`);
  const channels = new Set((sup.data ?? []).map((s) => s.channel as string));
  h.check("suppressed everywhere (ALL, and the voice number)", channels.has("ALL") || channels.has("all"), sup.data);
  const optedAt = new Date(Date.now() - 1000).toISOString();

  h.step = "optout:end";
  const endMs = Date.now();
  const state = h.state();
  (state.retell as Json).calls = { [call.providerCallId]: { call_id: call.providerCallId, call_status: "ended", start_timestamp: endMs - 40_000, end_timestamp: endMs, duration_ms: 40_000, disconnection_reason: "user_hangup", transcript_object: [{ role: "user", content: "Stop calling me, take me off your list.", words: [{ start: 1, end: 3 }] }], metadata: { voice_call_id: call.id } } };
  h.setState(state);
  await h.webhook("call_ended", retellCall(call, { call_status: "ended", end_timestamp: endMs, duration_ms: 40_000, disconnection_reason: "user_hangup" }));
  const jobs = await h.runJobs(refs);
  h.check("post-call ran after an opt-out", jobs.some((j) => j.type === "voice.post_call" && j.ok), jobs);
  const sentAfter = await h.admin.from("messages").select("id, channel, status").eq("business_id", h.businessId).eq("lead_id", lead.id).eq("direction", "outbound").gte("created_at", optedAt);
  h.check("no message queued to the lead after the opt-out", (sentAfter.data ?? []).length === 0, sentAfter.data);
  const outcome = await one<{ disposition: string }>(h, "voice_call_outcomes", { voice_call_id: call.id }, "disposition, next_action");
  h.check("outcome OPTED_OUT", outcome?.disposition === "OPTED_OUT", outcome);
  const retry = await h.admin.from("jobs").select("id").eq("type", "voice.retry").like("idempotency_key", `%${call.id}%`);
  h.check("no retry queued after an opt-out", (retry.data ?? []).length === 0, retry.data);
  const endNotes = await many<{ body: string }>(h, "lead_notes", { lead_id: lead.id }, "body, created_at");
  h.check("post-call added no call-back after the opt-out", !endNotes.some((n) => /Call back/.test(n.body) && !/Opted out/.test(n.body) && endNotes.indexOf(n) > endNotes.findIndex((m) => /Opted out/.test(m.body))), endNotes);
}

/* ======================================================= latency */

export function latencySummary(h: VoiceHarness): { tool: string; n: number; p50: number; max: number }[] {
  const by = new Map<string, number[]>();
  for (const l of h.latencies) by.set(l.tool, [...(by.get(l.tool) ?? []), l.ms]);
  return [...by.entries()].map(([tool, ms]) => {
    const s = [...ms].sort((a, b) => a - b);
    return { tool, n: s.length, p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
  });
}
