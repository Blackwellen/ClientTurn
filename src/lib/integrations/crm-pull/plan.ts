/**
 * CRM pull (brief §29): the pure decisions behind the opt-in inbound sync from
 * a connected CRM (HubSpot, Salesforce, Zoho).
 *
 * The job (`src/lib/jobs/handlers/crm-pull.ts`) fetches records modified since
 * a stored cursor and hands each one to `ingestLead` -- the one intake path --
 * as source type CRM. Everything that can be decided without a network or a
 * database is decided here, so it is unit-tested directly:
 *
 *   * the cursor: (modifiedAt, externalId), advanced only past records that
 *     were handled, never past a failure;
 *   * loop prevention: a record ClientTurn itself pushed to the CRM is not a
 *     new enquiry and is never re-ingested;
 *   * the ingest input: relationship IMPORTED (a CRM record is not a marketing
 *     basis, §29), the original created timestamp, the provider record id, and
 *     the owner mapped to a workspace member by email.
 *
 * Pure: no `server-only`, relative imports with explicit `.ts`.
 */

import type { IngestInput } from "../../ingest/types.ts";

export const CRM_PULL_PROVIDERS = ["hubspot", "salesforce", "zoho_crm"] as const;
export type CrmPullProvider = (typeof CRM_PULL_PROVIDERS)[number];

export function isCrmPullProvider(value: string): value is CrmPullProvider {
  return (CRM_PULL_PROVIDERS as readonly string[]).includes(value);
}

export const CRM_PULL_LABELS: Record<CrmPullProvider, string> = {
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  zoho_crm: "Zoho CRM",
};

/** One record as a CRM adapter returns it, already mapped to neutral fields. */
export type CrmPulledRecord = {
  /** The CRM's own id for the record. */
  externalId: string;
  /** "contact" (HubSpot) or "lead" (Salesforce, Zoho). */
  objectType: "contact" | "lead";
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  roleTitle: string | null;
  postcode: string | null;
  /** When the record was created in the CRM. Speed-to-lead starts here. */
  createdAt: string | null;
  /** When it was last modified. The cursor field. */
  modifiedAt: string;
  /** The CRM owner's email, when the adapter could resolve one. */
  ownerEmail: string | null;
};

export type CrmPullPage = {
  records: CrmPulledRecord[];
  /** Opaque continuation for the next page of the same query, or null. */
  nextPageToken: string | null;
  /** The provider asked us to slow down (HTTP 429 / quota). Stop this run. */
  rateLimited?: boolean;
};

/* ------------------------------------------------------------------ cursor */

export type CrmCursor = { modifiedAt: string; externalId: string };

/**
 * Stored in `lead_source_cursors.cursor_value` as JSON. Anything unreadable is
 * treated as "no cursor" -- the caller then starts from the enable time, never
 * from the beginning of the CRM's history.
 */
export function parseCrmCursor(value: string | null | undefined): CrmCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CrmCursor>;
    if (typeof parsed.modifiedAt !== "string" || !Number.isFinite(Date.parse(parsed.modifiedAt))) {
      return null;
    }
    return {
      modifiedAt: new Date(parsed.modifiedAt).toISOString(),
      externalId: typeof parsed.externalId === "string" ? parsed.externalId : "",
    };
  } catch {
    return null;
  }
}

export function serialiseCrmCursor(cursor: CrmCursor): string {
  return JSON.stringify({ modifiedAt: cursor.modifiedAt, externalId: cursor.externalId });
}

/** The cursor a freshly enabled pull starts from: now. History is not backfilled. */
export function initialCrmCursor(now: Date = new Date()): CrmCursor {
  return { modifiedAt: now.toISOString(), externalId: "" };
}

function compareKey(a: { modifiedAt: string; externalId: string }, b: CrmCursor): number {
  const ta = Date.parse(a.modifiedAt);
  const tb = Date.parse(b.modifiedAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.externalId === b.externalId) return 0;
  return a.externalId < b.externalId ? -1 : 1;
}

/**
 * Providers are queried with "modified at or after" the cursor time, because
 * several records can share one timestamp. The tie is broken on the id, so a
 * record already handled at the cursor's exact instant is not handled twice.
 */
export function isAfterCursor(record: CrmPulledRecord, cursor: CrmCursor | null): boolean {
  if (!Number.isFinite(Date.parse(record.modifiedAt))) return false;
  if (!cursor) return true;
  return compareKey(record, cursor) > 0;
}

/** Oldest first, ties on the id: the order the cursor advances in. */
export function sortForCursor(records: CrmPulledRecord[]): CrmPulledRecord[] {
  return [...records]
    .filter((record) => Number.isFinite(Date.parse(record.modifiedAt)))
    .sort((a, b) => {
      const ta = Date.parse(a.modifiedAt);
      const tb = Date.parse(b.modifiedAt);
      if (ta !== tb) return ta - tb;
      return a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0;
    });
}

/**
 * The cursor after a batch. Handled records are walked in cursor order and the
 * cursor moves past each one until the first failure; a failed record, and
 * everything after it, is fetched again next run. That is what makes the job
 * retry-safe: ingest is idempotent on the provider record id, so a record
 * re-fetched after a partial run is recorded once.
 */
export function advanceCrmCursor(
  cursor: CrmCursor | null,
  handled: { record: CrmPulledRecord; ok: boolean }[],
): CrmCursor | null {
  let next = cursor;
  const ordered = [...handled].sort((a, b) =>
    compareKey(a.record, { modifiedAt: b.record.modifiedAt, externalId: b.record.externalId }),
  );
  for (const entry of ordered) {
    if (!entry.ok) break;
    const candidate = {
      modifiedAt: new Date(entry.record.modifiedAt).toISOString(),
      externalId: entry.record.externalId,
    };
    if (!next || compareKey(candidate, next) > 0) next = candidate;
  }
  return next;
}

/* ---------------------------------------------------------- per record */

export type CrmRecordDecision =
  | { action: "INGEST" }
  | { action: "SKIP"; reason: "pushed_by_clientturn" | "no_contact_point" };

/**
 * Loop prevention first: a record whose id is one ClientTurn wrote to the CRM
 * (`crm_push_records.external_contact_id`, `external_entity_links`) is our own
 * lead coming back, not a new enquiry. Then a record with no email and no phone
 * has nothing ingest could accept, and is skipped without an ingest call.
 */
export function decideCrmRecord(
  record: CrmPulledRecord,
  pushedExternalIds: ReadonlySet<string>,
): CrmRecordDecision {
  if (pushedExternalIds.has(record.externalId)) {
    return { action: "SKIP", reason: "pushed_by_clientturn" };
  }
  if (!record.email?.trim() && !record.phone?.trim()) {
    return { action: "SKIP", reason: "no_contact_point" };
  }
  return { action: "INGEST" };
}

/** The workspace member whose email matches the CRM owner, or null. */
export function ownerUserIdFor(
  ownerEmail: string | null | undefined,
  members: { userId: string; email: string | null }[],
): string | null {
  const wanted = ownerEmail?.trim().toLowerCase();
  if (!wanted) return null;
  const match = members.find((member) => member.email?.trim().toLowerCase() === wanted);
  return match?.userId ?? null;
}

/** `lead_touches.provider_record_id`: the object type keeps HubSpot contact 12 and a lead 12 apart. */
export function crmProviderRecordId(record: CrmPulledRecord): string {
  return `${record.objectType}:${record.externalId}`;
}

function clip(value: string | null | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * The ingest contract for one pulled record.
 *
 * `relationship: "IMPORTED"` -- never THEY_CONTACTED_US and never a consent.
 * A row in a CRM says the business holds the person's details, not that the
 * person asked to hear from it; the policy engine decides contactability from
 * that honest starting point (§29).
 */
export function crmIngestInput(input: {
  businessId: string;
  provider: CrmPullProvider;
  integrationId: string;
  record: CrmPulledRecord;
}): IngestInput {
  const { record } = input;
  return {
    businessId: input.businessId,
    source: {
      type: "CRM",
      provider: input.provider,
      providerRecordId: crmProviderRecordId(record),
      submittedAt: record.createdAt ?? undefined,
      caller: { type: "CONNECTOR", id: input.integrationId },
    },
    person: {
      firstName: clip(record.firstName, 120),
      lastName: clip(record.lastName, 120),
      email: clip(record.email, 320),
      phone: clip(record.phone, 60),
      companyName: clip(record.companyName, 200),
      roleTitle: clip(record.roleTitle, 200),
      postcode: clip(record.postcode, 20),
    },
    relationship: "IMPORTED",
  };
}

/* ------------------------------------------------------------ run limits */

/**
 * Per run: at most this many pages. HubSpot's search API allows a handful of
 * requests a second per portal, Salesforce and Zoho meter a daily API quota;
 * a run every fifteen minutes with a bounded page count stays well inside all
 * three, and anything left over is picked up by the next run from the cursor.
 */
export const CRM_PULL_MAX_PAGES = 5;
export const CRM_PULL_PAGE_SIZE = 100;
/** Pause between page requests, so one run never bursts a provider's limit. */
export const CRM_PULL_PAGE_DELAY_MS = 300;
/** How often the sweep queues a pull per enabled integration. */
export const CRM_PULL_INTERVAL_MS = 15 * 60_000;

export type CrmRunStatus = "OK" | "PARTIAL" | "FAILED";

/** OK: everything fetched was handled. PARTIAL: stopped early (failure or rate limit) after progress. */
export function crmRunStatus(input: {
  handled: number;
  failed: boolean;
  rateLimited: boolean;
}): CrmRunStatus {
  if (!input.failed && !input.rateLimited) return "OK";
  return input.handled > 0 || input.rateLimited ? "PARTIAL" : "FAILED";
}

/** SOQL datetime literal: second precision, UTC, no quotes. */
export function soqlDateTime(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Which existing CRM record a push should update, if any.
 *
 * Checked in order of certainty: the id ClientTurn recorded from its own last
 * push; the record this lead was *pulled from* (`external_entity_links`) -- a
 * lead that came out of the CRM must go back into that same record, never a
 * new one; and last, a record found by email in the CRM itself. Null means
 * nothing matched and a create is correct.
 */
export function existingCrmRecordId(input: {
  recorded: string | null | undefined;
  linked: string | null | undefined;
  foundByEmail?: string | null | undefined;
}): string | null {
  return input.recorded || input.linked || input.foundByEmail || null;
}

/**
 * The CRM "Company" value for a lead.
 *
 * Salesforce and Zoho require one on a Lead. It was hard-coded to "Client Turn
 * lead" for every record, so every B2B lead's real company was lost on the way
 * into the CRM. The lead's own company name when there is one; otherwise an
 * explicit "Not provided" rather than a value that reads like data.
 */
export function crmCompanyField(companyName: string | null | undefined): string {
  const trimmed = companyName?.trim();
  return trimmed ? trimmed.slice(0, 255) : "Not provided";
}
