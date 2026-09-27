import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_BOOKING_STATUSES } from "./confirmation";
import {
  meetingTypeFromRow,
  pickAssignee,
  ROUND_ROBIN_WINDOW_DAYS,
  selectCallMeetingType,
  selectMeetingType,
  type AssigneeDecision,
  type MeetingType,
} from "./meeting-types";

/**
 * Meeting types on the server (brief §57): loading them, choosing one for a
 * lead, and routing a booking to a rep. Reads only; writes go through the
 * `meeting_type.*` service operations.
 */

// meeting_types / bookings.meeting_type_id (0127) post-date the generated types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const COLUMNS =
  "id, name, duration_minutes, buffer_minutes, assignee_rule, eligible_user_ids, service_ids, specialisms, calendar_integration_id, is_default, active";

export async function listMeetingTypes(
  businessId: string,
  options: { includeArchived?: boolean } = {},
): Promise<MeetingType[]> {
  let query = db()
    .from("meeting_types")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true })
    .limit(100);
  if (!options.includeArchived) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw new Error(`Meeting types could not be read: ${error.message}`);
  return ((data ?? []) as Parameters<typeof meetingTypeFromRow>[0][]).map(meetingTypeFromRow);
}

/**
 * The meeting type for a lead, or null -- in which case the workspace's
 * single-calendar behaviour and business_settings duration apply. A read that
 * fails is treated as "no meeting types" so booking still works; the failure
 * is logged rather than blocking a lead from being offered a time.
 */
export async function meetingTypeForLead(
  businessId: string,
  serviceId: string | null,
  options: { preferCall?: boolean } = {},
): Promise<MeetingType | null> {
  try {
    const types = await listMeetingTypes(businessId);
    // A lead who asked to be called gets a "Phone call" type when there is one.
    return options.preferCall ? selectCallMeetingType(types, serviceId) : selectMeetingType(types, serviceId);
  } catch (error) {
    console.error("[meeting-types] falling back to workspace defaults", {
      businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Active members of the workspace, so a removed person is never assigned. */
async function activeMembers(businessId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await createAdminClient()
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("status", "active")
    .in("user_id", userIds);
  if (error) throw new Error(`Members could not be read: ${error.message}`);
  const active = new Set((data ?? []).map((row) => row.user_id));
  return userIds.filter((id) => active.has(id));
}

/**
 * Who takes a booking of this meeting type. Counts each eligible rep's active
 * bookings over the next seven days; the pure rule decides.
 */
export async function assignBooking(input: {
  businessId: string;
  meetingType: MeetingType;
  serviceId: string | null;
  ownerUserId: string | null;
  now?: Date;
}): Promise<AssigneeDecision> {
  const eligible = await activeMembers(input.businessId, input.meetingType.eligibleUserIds);
  if (eligible.length === 0) return { userId: null, reason: "NO_ELIGIBLE_REPS" };

  const now = input.now ?? new Date();
  const until = new Date(now.getTime() + ROUND_ROBIN_WINDOW_DAYS * 86_400_000);

  const [upcoming, recent] = await Promise.all([
    createAdminClient()
      .from("bookings")
      .select("assigned_user_id")
      .eq("business_id", input.businessId)
      .in("assigned_user_id", eligible)
      .in("status", [...ACTIVE_BOOKING_STATUSES])
      .gte("starts_at", now.toISOString())
      .lt("starts_at", until.toISOString())
      .limit(5000),
    createAdminClient()
      .from("bookings")
      .select("assigned_user_id, created_at")
      .eq("business_id", input.businessId)
      .in("assigned_user_id", eligible)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (upcoming.error) throw new Error(`Bookings could not be counted: ${upcoming.error.message}`);
  if (recent.error) throw new Error(`Recent bookings could not be read: ${recent.error.message}`);

  const counts = new Map<string, number>();
  for (const row of upcoming.data ?? []) {
    if (row.assigned_user_id) counts.set(row.assigned_user_id, (counts.get(row.assigned_user_id) ?? 0) + 1);
  }
  const lastAssignedAt = new Map<string, string>();
  for (const row of recent.data ?? []) {
    if (row.assigned_user_id && !lastAssignedAt.has(row.assigned_user_id)) {
      lastAssignedAt.set(row.assigned_user_id, row.created_at);
    }
  }

  return pickAssignee({
    rule: input.meetingType.assigneeRule,
    eligibleUserIds: eligible,
    specialisms: input.meetingType.specialisms,
    serviceId: input.serviceId,
    ownerUserId: input.ownerUserId,
    upcomingCounts: counts,
    lastAssignedAt,
  });
}
