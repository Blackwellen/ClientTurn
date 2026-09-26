/**
 * The Calendly event type the assistant offers times from
 * (`integrations.config.event_type_uri`, read by agent/availability).
 *
 * Calendly's API wants the event type's URI,
 * `https://api.calendly.com/event_types/<uuid>`. People rarely have that, but
 * the event type's edit page in Calendly is `calendly.com/event_types/<uuid>/edit`,
 * which carries the same id, so either is accepted and stored as the URI. A
 * public booking link (`calendly.com/<name>/<slug>`) has no id in it and is
 * refused with a pointer to the edit page.
 *
 * Pure: no React, no `server-only`.
 */

const API_BASE = "https://api.calendly.com/event_types/";
const ID = "[A-Za-z0-9-]{8,64}";
const API_URI = new RegExp(`^https://api\\.calendly\\.com/event_types/(${ID})/?$`);
const EDIT_PAGE = new RegExp(`^https://(?:www\\.)?calendly\\.com/event_types/(${ID})(?:/[a-z_-]*)?/?(?:[?#].*)?$`);

export type CalendlyEventTypeParse =
  | { ok: true; uri: string | null }
  | { ok: false; error: string };

/** Blank clears the setting; anything else must name one event type. */
export function parseCalendlyEventType(input: string): CalendlyEventTypeParse {
  const value = input.trim();
  if (!value) return { ok: true, uri: null };
  const match = API_URI.exec(value) ?? EDIT_PAGE.exec(value);
  if (match) return { ok: true, uri: `${API_BASE}${match[1]}` };
  return {
    ok: false,
    error:
      "Paste the address of the event type's edit page in Calendly (calendly.com/event_types/…), or its API URI. A public booking link does not identify the event type.",
  };
}
