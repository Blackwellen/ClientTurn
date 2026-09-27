/**
 * Meeting types and rep routing (brief §57, design 05 §3.1). Pure.
 *
 * A meeting type says how long a kind of meeting is, how much buffer it holds
 * after it, which calendar availability is read from, and who takes it:
 *
 *   ROUND_ROBIN  the eligible rep with the fewest bookings in the next 7 days.
 *   SPECIALISM   as round robin, among the eligible reps whose specialisms
 *                cover the lead's service (all eligible reps when none do).
 *   OWNER        the lead's assigned owner when they are eligible; round
 *                robin otherwise.
 *
 * A workspace with no meeting types keeps its single calendar and its
 * business_settings duration and buffer -- nothing here changes that default.
 */

import { z } from "zod";

export const ASSIGNEE_RULES = ["ROUND_ROBIN", "SPECIALISM", "OWNER"] as const;
export type AssigneeRule = (typeof ASSIGNEE_RULES)[number];

export const ASSIGNEE_RULE_LABELS: Record<AssigneeRule, string> = {
  ROUND_ROBIN: "Round robin",
  SPECIALISM: "By specialism",
  OWNER: "Lead owner",
};

export const ASSIGNEE_RULE_DESCRIPTIONS: Record<AssigneeRule, string> = {
  ROUND_ROBIN: "The eligible person with the fewest bookings in the next 7 days.",
  SPECIALISM: "Round robin among the people who specialise in the lead's service.",
  OWNER: "The person who owns the lead, if eligible. Otherwise round robin.",
};

/** Round robin balances load over this window. */
export const ROUND_ROBIN_WINDOW_DAYS = 7;

export type MeetingType = {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  assigneeRule: AssigneeRule;
  eligibleUserIds: string[];
  serviceIds: string[];
  /** user id -> service ids that person specialises in. */
  specialisms: Record<string, string[]>;
  calendarIntegrationId: string | null;
  isDefault: boolean;
  active: boolean;
};

const uuid = z.uuid();

export const meetingTypeInputSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().trim().min(1, "Give the meeting type a name.").max(120),
    durationMinutes: z.number().int().min(5).max(480),
    bufferMinutes: z.number().int().min(0).max(240),
    assigneeRule: z.enum(ASSIGNEE_RULES),
    eligibleUserIds: z.array(uuid).max(50),
    serviceIds: z.array(uuid).max(50),
    specialisms: z.record(uuid, z.array(uuid).max(50)).optional(),
    calendarIntegrationId: uuid.nullable().optional(),
    isDefault: z.boolean(),
  })
  .refine(
    (value) => value.assigneeRule !== "SPECIALISM" || value.eligibleUserIds.length > 0,
    { message: "Choose at least one person for a specialism meeting type.", path: ["eligibleUserIds"] },
  );

export type MeetingTypeInput = z.infer<typeof meetingTypeInputSchema>;

/** Specialisms only for people who are eligible; everything else is dropped. */
export function cleanSpecialisms(
  eligibleUserIds: string[],
  specialisms: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const userId of eligibleUserIds) {
    const services = specialisms?.[userId];
    if (services?.length) out[userId] = [...new Set(services)];
  }
  return out;
}

/**
 * Which meeting type a lead gets. A type naming the lead's service wins (the
 * default among several); otherwise the default type, provided it is not
 * restricted to other services; otherwise the first unrestricted type. Null
 * when nothing fits -- and always when the workspace has none.
 */
export function selectMeetingType(
  types: MeetingType[],
  serviceId: string | null | undefined,
): MeetingType | null {
  const active = types.filter((type) => type.active);
  if (active.length === 0) return null;

  if (serviceId) {
    const matching = active.filter((type) => type.serviceIds.includes(serviceId));
    if (matching.length) return matching.find((type) => type.isDefault) ?? matching[0];
  }

  const unrestricted = active.filter((type) => type.serviceIds.length === 0);
  return unrestricted.find((type) => type.isDefault) ?? unrestricted[0] ?? null;
}

/** A meeting type named for a phone call ("Phone call", "Discovery call by phone"). */
const CALL_TYPE_NAME = /\b(phone|call|ring)\b/i;

/**
 * The meeting type for a lead who asked to be called (elite-closer brief):
 * among the types that would fit the lead, one named for a phone call wins;
 * otherwise the ordinary choice (`selectMeetingType`). The booking is still
 * made through the ordinary flow, so it stays automated.
 */
export function selectCallMeetingType(types: MeetingType[], serviceId: string | null | undefined): MeetingType | null {
  const active = types.filter((type) => type.active);
  const fits = (type: MeetingType) => type.serviceIds.length === 0 || (serviceId ? type.serviceIds.includes(serviceId) : false);
  const call = active.filter((type) => CALL_TYPE_NAME.test(type.name) && fits(type));
  return call.find((type) => type.isDefault) ?? call[0] ?? selectMeetingType(types, serviceId);
}

export type AssigneeDecision = {
  userId: string | null;
  reason:
    | "NO_ELIGIBLE_REPS"
    | "OWNER"
    | "OWNER_NOT_ELIGIBLE"
    | "ROUND_ROBIN"
    | "SPECIALIST"
    | "NO_SPECIALIST";
};

function fewestBookings(
  candidates: string[],
  upcomingCounts: ReadonlyMap<string, number>,
  lastAssignedAt: ReadonlyMap<string, string>,
): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const countDiff = (upcomingCounts.get(a) ?? 0) - (upcomingCounts.get(b) ?? 0);
    if (countDiff !== 0) return countDiff;
    // Tie: whoever was assigned longest ago (never assigned first), then id,
    // so the choice is deterministic and rotates rather than always landing
    // on the same person.
    const la = lastAssignedAt.get(a);
    const lb = lastAssignedAt.get(b);
    if (!la && lb) return -1;
    if (la && !lb) return 1;
    if (la && lb && la !== lb) return Date.parse(la) - Date.parse(lb);
    return a < b ? -1 : a > b ? 1 : 0;
  })[0];
}

/**
 * The rep a booking is assigned to. `eligibleUserIds` must already be limited
 * to active workspace members -- a removed person is never picked.
 */
export function pickAssignee(input: {
  rule: AssigneeRule;
  eligibleUserIds: string[];
  specialisms: Record<string, string[]>;
  serviceId: string | null | undefined;
  ownerUserId: string | null | undefined;
  /** Bookings per rep over the next ROUND_ROBIN_WINDOW_DAYS. */
  upcomingCounts: ReadonlyMap<string, number>;
  /** Most recent booking created per rep, ISO. */
  lastAssignedAt?: ReadonlyMap<string, string>;
}): AssigneeDecision {
  const eligible = [...new Set(input.eligibleUserIds)];
  if (eligible.length === 0) return { userId: null, reason: "NO_ELIGIBLE_REPS" };
  const last = input.lastAssignedAt ?? new Map<string, string>();

  if (input.rule === "OWNER") {
    if (input.ownerUserId && eligible.includes(input.ownerUserId)) {
      return { userId: input.ownerUserId, reason: "OWNER" };
    }
    return { userId: fewestBookings(eligible, input.upcomingCounts, last), reason: "OWNER_NOT_ELIGIBLE" };
  }

  if (input.rule === "SPECIALISM") {
    const specialists = input.serviceId
      ? eligible.filter((userId) => input.specialisms[userId]?.includes(input.serviceId!))
      : [];
    if (specialists.length) {
      return { userId: fewestBookings(specialists, input.upcomingCounts, last), reason: "SPECIALIST" };
    }
    return { userId: fewestBookings(eligible, input.upcomingCounts, last), reason: "NO_SPECIALIST" };
  }

  return { userId: fewestBookings(eligible, input.upcomingCounts, last), reason: "ROUND_ROBIN" };
}

/** Duration and buffer for availability: the meeting type's, else the workspace's. */
export function bookingShape(
  defaults: { durationMinutes: number; bufferMinutes: number },
  meetingType: MeetingType | null,
): {
  durationMinutes: number;
  bufferMinutes: number;
  meetingTypeId: string | null;
  calendarIntegrationId: string | null;
} {
  if (!meetingType) {
    return { ...defaults, meetingTypeId: null, calendarIntegrationId: null };
  }
  return {
    durationMinutes: meetingType.durationMinutes,
    bufferMinutes: meetingType.bufferMinutes,
    meetingTypeId: meetingType.id,
    calendarIntegrationId: meetingType.calendarIntegrationId,
  };
}

/** Maps a `meeting_types` row. Tolerates a partially-written row. */
export function meetingTypeFromRow(row: {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  assignee_rule: string;
  eligible_user_ids: string[] | null;
  service_ids: string[] | null;
  specialisms: unknown;
  calendar_integration_id: string | null;
  is_default: boolean;
  active: boolean;
}): MeetingType {
  const rule = (ASSIGNEE_RULES as readonly string[]).includes(row.assignee_rule)
    ? (row.assignee_rule as AssigneeRule)
    : "ROUND_ROBIN";
  const specialisms: Record<string, string[]> = {};
  if (row.specialisms && typeof row.specialisms === "object") {
    for (const [userId, services] of Object.entries(row.specialisms as Record<string, unknown>)) {
      if (Array.isArray(services)) specialisms[userId] = services.filter((s): s is string => typeof s === "string");
    }
  }
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    bufferMinutes: row.buffer_minutes,
    assigneeRule: rule,
    eligibleUserIds: row.eligible_user_ids ?? [],
    serviceIds: row.service_ids ?? [],
    specialisms,
    calendarIntegrationId: row.calendar_integration_id,
    isDefault: row.is_default,
    active: row.active,
  };
}
