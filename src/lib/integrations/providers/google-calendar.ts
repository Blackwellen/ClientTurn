import "server-only";
import { serverEnv } from "@/lib/env";
import { getLiveAccessToken, type OAuthConfig, type TokenResponse } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";

/**
 * Google Calendar — OAuth connect for the availability + booking-write half
 * of the booking engine. `src/lib/agent/availability/index.ts` already reads
 * free/busy from a connected `google_calendar` integration; this file is what
 * actually creates that integration row (OAuth adapter) and, separately,
 * writes a confirmed booking onto the connected calendar.
 *
 * Docs consulted while building this (fetched live, not from training data):
 * - OAuth endpoints: https://developers.google.com/identity/protocols/oauth2/web-server
 *   (authorize: https://accounts.google.com/o/oauth2/v2/auth,
 *    token: https://oauth2.googleapis.com/token)
 * - Calendar scope: https://developers.google.com/calendar/api/auth
 *   (`https://www.googleapis.com/auth/calendar` — full read/write access,
 *   required because this integration both reads free/busy and creates events,
 *   not just the read-only `.../calendar.readonly` or `.../calendar.events`
 *   scope alone)
 * - `access_type=offline` + `prompt=consent` to reliably get a `refresh_token`
 *   on repeat consent: https://developers.google.com/identity/protocols/oauth2/web-server#offline
 *   (same requirement `google-ads.ts` already documents and sets)
 * - Userinfo endpoint for `identify()`:
 *   https://developers.google.com/identity/protocols/oauth2/openid-connect#obtaininguserprofileinformation
 *   (`GET https://www.googleapis.com/oauth2/v2/userinfo` returns
 *   `{ id, email, verified_email, name, ... }` for a token carrying the
 *   `userinfo.email` scope). This app does not request that scope — only
 *   `.../auth/calendar` — so `identify()` instead reads
 *   `GET https://www.googleapis.com/calendar/v3/calendars/primary`, which the
 *   calendar scope alone grants, and returns `{ id, summary, timeZone, ... }`
 *   where `id` is the connected account's own email address for the primary
 *   calendar. That is a reasonable `externalAccountId`/`displayName` without
 *   requesting a broader scope than the integration needs.
 * - Event insert: https://developers.google.com/calendar/api/v3/reference/events/insert
 *   `POST /calendars/{calendarId}/events` with a body of at least
 *   `{ summary, description, start: { dateTime, timeZone }, end: { dateTime, timeZone } }`.
 *   Response includes `id`, `htmlLink`, `status`. Verified against the current
 *   v3 reference page as of this build.
 *
 * GENUINE UNCERTAINTY (flagged per this task's instructions): I could not
 * execute a live call against a real Google Calendar during this build (no
 * connected test account in this environment), unlike the Calendly work this
 * mirrors, which was checked against a live OAuth app. The request/response
 * shapes above are taken directly from Google's current public API reference
 * rather than guessed, but `createGoogleCalendarEvent` below still parses the
 * response defensively (tolerant of missing `htmlLink`/`id`) rather than
 * assuming every documented field is always present.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar";

/**
 * The one definition of this OAuth config. `availability/index.ts` imports
 * this rather than keeping its own separately-defined constant, so the two
 * halves of Calendar (read free/busy, write a booking) can never drift apart
 * on client id/secret/scope.
 */
export function googleCalendarConfig(): OAuthConfig | null {
  const { clientId, clientSecret } = serverEnv.google;
  if (!clientId || !clientSecret) return null;

  return {
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    scope: SCOPE,
    // See header comment: without these, Google omits refresh_token on a
    // repeat consent from the same Google account.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  };
}

type PrimaryCalendarResponse = {
  id?: string;
  summary?: string;
};

async function identify(token: TokenResponse) {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary",
    { headers: { Authorization: `Bearer ${token.accessToken}` } },
  ).catch(() => null);

  if (!response?.ok) {
    throw new Error("Could not verify the Google Calendar account after connecting.");
  }

  const json = (await response.json().catch(() => ({}))) as PrimaryCalendarResponse;

  return {
    // The primary calendar's `id` is the connected Google account's email.
    externalAccountId: json.id ?? null,
    displayName: json.summary ?? json.id ?? null,
    scopes: [SCOPE],
    // Left unset deliberately: availability/index.ts already defaults to
    // ["primary"] when `config.calendar_ids` is absent, and a calendar-picker
    // UI is out of scope here (see task brief). One definition of the default,
    // not two that could disagree.
  };
}

registerOAuthProvider("google_calendar", { getConfig: googleCalendarConfig, identify });

// -------------------------------------------------------------- event write

export type CreateGoogleCalendarEventInput = {
  integrationId: string;
  calendarId?: string;
  summary: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  /**
   * Invitees. When present the event is created with `sendUpdates=all`, so
   * Google emails each attendee a real calendar invitation (B10: the lead
   * must receive the booking, not only the business).
   */
  attendees?: { email: string; displayName?: string | null }[];
};

export type CreateGoogleCalendarEventResult =
  | { ok: true; eventId: string; htmlLink: string | null }
  | { ok: false; detail: string };

type EventsInsertResponse = {
  id?: string;
  htmlLink?: string;
};

/**
 * Writes a booking onto the connected Google Calendar. Never throws — the
 * caller decides what a failure means. Since B10 that decision is: a failed
 * write is NOT a booking; the time stays a `pending` request and the lead is
 * told a person will confirm it (see `createBooking` in agent/tools.ts).
 */
export async function createGoogleCalendarEvent(
  input: CreateGoogleCalendarEventInput,
): Promise<CreateGoogleCalendarEventResult> {
  const config = googleCalendarConfig();
  if (!config) {
    return { ok: false, detail: "Google Calendar is not configured on this environment." };
  }

  let accessToken: string;
  try {
    accessToken = await getLiveAccessToken(input.integrationId, config);
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Could not refresh the calendar token.",
    };
  }

  const calendarId = input.calendarId ?? "primary";

  let response: Response;
  try {
    response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
        (input.attendees?.length ? "?sendUpdates=all" : ""),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          summary: input.summary,
          description: input.description ?? undefined,
          start: { dateTime: input.startsAt, timeZone: input.timezone },
          end: { dateTime: input.endsAt, timeZone: input.timezone },
          attendees: input.attendees?.length
            ? input.attendees.map((attendee) => ({
                email: attendee.email,
                displayName: attendee.displayName ?? undefined,
              }))
            : undefined,
        }),
      },
    );
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Calendar request failed.",
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      detail: `Google Calendar rejected the event (status ${response.status}): ${body.slice(0, 300)}`,
    };
  }

  const json = (await response.json().catch(() => ({}))) as EventsInsertResponse;

  if (!json.id) {
    return { ok: false, detail: "Google Calendar did not return an event id." };
  }

  return { ok: true, eventId: json.id, htmlLink: json.htmlLink ?? null };
}
