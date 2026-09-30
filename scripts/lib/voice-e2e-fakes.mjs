/**
 * Provider fakes at the network edge for the voice wiring harness
 * (scripts/voice-e2e-wiring.ts, tests/voice-e2e-wiring.test.ts).
 *
 * Loaded AFTER scripts/lib/egress-guard.mjs:
 *
 *   node --import ./scripts/lib/egress-guard.mjs --import ./scripts/lib/voice-e2e-fakes.mjs ...
 *
 * It wraps `globalThis.fetch` and answers, from a JSON state file, exactly the
 * provider endpoints the voice agent and the calendar adapters call, so the
 * real ClientTurn code (route handlers, jobs, adapters) runs unchanged and
 * only the provider's HTTP answer is scripted:
 *
 *   oauth2.googleapis.com/token                        token refresh
 *   www.googleapis.com/calendar/v3/freeBusy            busy blocks (state.google.busy)
 *   www.googleapis.com/calendar/v3/calendars/{id}/events (POST)  an event write,
 *                                                      appended to state.google.events
 *                                                      and to the busy blocks
 *   api.calendly.com/event_type_available_times        state.calendly.available,
 *                                                      with Calendly's own argument rules
 *                                                      (start_time in the future, <= 7 days)
 *   api.retellai.com/v2/get-call/{id}                  state.retell.calls[id]
 *
 * Everything else falls through to the guarded fetch (the Supabase project
 * passes, any other host is refused by the egress guard). Every faked request
 * is appended to VOICE_E2E_LOG as one JSON line, so the harness can assert
 * what reached the provider edge. Nothing here opens a socket.
 *
 * Env: VOICE_E2E_STATE (the state file; absent = the fakes are inert).
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const STATE = process.env.VOICE_E2E_STATE ?? "";
const LOG = process.env.VOICE_E2E_LOG ?? "";

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    writeFileSync(STATE, JSON.stringify(state, null, 2));
  } catch {
    /* the answer still goes back */
  }
}

function log(entry) {
  if (!LOG) return;
  try {
    appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry })}\n`);
  } catch {
    /* logging never changes the answer */
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function bodyOf(input, init) {
  try {
    if (init?.body && typeof init.body === "string") return init.body;
    if (input instanceof Request) return await input.clone().text();
  } catch {
    /* no body */
  }
  return null;
}

async function answer(url, method, rawBody) {
  const state = readState();
  const host = url.hostname;
  const delay = Number(state.delayMs ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  if (host === "oauth2.googleapis.com" && url.pathname === "/token") {
    return json(200, { access_token: "voice-e2e-google-token", expires_in: 3600, token_type: "Bearer" });
  }

  if (host === "www.googleapis.com" && url.pathname === "/calendar/v3/freeBusy" && method === "POST") {
    const google = state.google ?? {};
    if (google.status && google.status !== 200) return json(google.status, { error: { message: "fake failure" } });
    const req = rawBody ? JSON.parse(rawBody) : {};
    const min = Date.parse(req.timeMin);
    const max = Date.parse(req.timeMax);
    const busy = [...(google.busy ?? []), ...(google.events ?? []).map((e) => ({ start: e.start, end: e.end }))].filter(
      (b) => Date.parse(b.end) > min && Date.parse(b.start) < max,
    );
    const calendars = {};
    for (const item of req.items ?? []) calendars[item.id] = google.calendarErrors ? { errors: [{ reason: "notFound" }] } : { busy };
    return json(200, { kind: "calendar#freeBusy", timeMin: req.timeMin, timeMax: req.timeMax, calendars });
  }

  const eventsPath = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
  if (host === "www.googleapis.com" && eventsPath && method === "POST") {
    const req = rawBody ? JSON.parse(rawBody) : {};
    const google = state.google ?? (state.google = {});
    const start = new Date(req.start?.dateTime).toISOString();
    const end = new Date(req.end?.dateTime).toISOString();
    // Google itself does not refuse an overlapping event; the adapter's
    // re-check is what must prevent a double booking. Recorded as is.
    const event = {
      id: `voice-e2e-event-${(google.events ?? []).length + 1}`,
      calendarId: decodeURIComponent(eventsPath[1]),
      start,
      end,
      timeZone: req.start?.timeZone ?? null,
      attendees: (req.attendees ?? []).map((a) => a.email),
      sendUpdates: url.searchParams.get("sendUpdates"),
      summary: req.summary ?? null,
    };
    google.events = [...(google.events ?? []), event];
    writeState(state);
    return json(200, { id: event.id, htmlLink: `https://calendar.google.com/event?eid=${event.id}`, status: "confirmed" });
  }

  if (host === "api.calendly.com" && url.pathname === "/event_type_available_times") {
    const calendly = state.calendly ?? {};
    const start = Date.parse(url.searchParams.get("start_time") ?? "");
    const end = Date.parse(url.searchParams.get("end_time") ?? "");
    // Calendly's documented argument rules: the range starts in the future
    // and spans at most 7 days.
    if (!Number.isFinite(start) || start <= Date.now()) {
      return json(400, { title: "Invalid Argument", message: "The supplied parameters are invalid.", details: [{ parameter: "start_time", message: "must be in the future" }] });
    }
    if (!Number.isFinite(end) || end - start > 7 * 24 * 60 * 60_000) {
      return json(400, { title: "Invalid Argument", message: "The supplied parameters are invalid.", details: [{ parameter: "end_time", message: "date range can be no greater than 1 week (7 days)" }] });
    }
    if (calendly.status && calendly.status !== 200) return json(calendly.status, { title: "fake failure" });
    const collection = (calendly.available ?? [])
      .filter((s) => Date.parse(s.start_time) >= start && Date.parse(s.start_time) <= end)
      .map((s) => ({ status: "available", invitees_remaining: 1, scheduling_url: `https://calendly.com/voice-e2e/${s.start_time}`, ...s }));
    return json(200, { collection });
  }

  const getCall = /^\/v2\/get-call\/(.+)$/.exec(url.pathname);
  if (host === "api.retellai.com" && getCall && method === "GET") {
    const call = state.retell?.calls?.[decodeURIComponent(getCall[1])];
    return call ? json(200, call) : json(404, { error_message: "Call not found" });
  }

  return null;
}

if (STATE && typeof globalThis.fetch === "function") {
  const guarded = globalThis.fetch;
  globalThis.fetch = async function voiceE2eFetch(input, init) {
    let url = null;
    try {
      url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    } catch {
      url = null;
    }
    const FAKED = ["oauth2.googleapis.com", "www.googleapis.com", "api.calendly.com", "api.retellai.com"];
    if (url && FAKED.includes(url.hostname)) {
      const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const rawBody = await bodyOf(input, init);
      const response = await answer(url, method, rawBody);
      log({ host: url.hostname, path: url.pathname, search: url.search, method, body: rawBody ? rawBody.slice(0, 2000) : null, status: response?.status ?? "UNFAKED" });
      if (response) return response;
    }
    return guarded.call(this, input, init);
  };
}
