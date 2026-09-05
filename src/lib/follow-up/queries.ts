import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  AutomationDetail,
  AutomationListItem,
} from "@/lib/automations/types";
import type { FollowUpPublishState, FollowUpStatus } from "./types";

export * from "./types";

function initialsFrom(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
): string | null {
  const first = firstName?.trim()?.[0];
  const last = lastName?.trim()?.[0];
  if (first || last) return `${first ?? ""}${last ?? ""}`.toUpperCase();
  const fromEmail = email?.trim()?.[0];
  return fromEmail ? fromEmail.toUpperCase() : null;
}

function displayName(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
): string | null {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || email || null;
}

/**
 * The Follow-Up status card. Everything shown is read from the automation
 * versions themselves — "Published" is never rendered from optimistic client
 * state, only from a row that carries a `published_at`.
 *
 * `sequences` are the chase automations already loaded by the view, so this
 * does not re-read them.
 */
export async function getFollowUpStatus(
  businessId: string,
  sequences: AutomationListItem[],
  selected: AutomationDetail | null,
): Promise<FollowUpStatus> {
  const empty: FollowUpStatus = {
    state: "unconfigured",
    updatedAt: null,
    updatedByInitials: null,
    updatedByName: null,
  };

  if (sequences.length === 0) return empty;

  const state: FollowUpPublishState = sequences.some(
    (item) => item.status === "active",
  )
    ? "published"
    : sequences.some((item) => item.status === "paused")
      ? "paused"
      : "draft";

  const supabase = await createClient();

  // The most recent publish across this workspace's sequences is what the
  // card reports; falling back to the newest version row when nothing has
  // ever been published.
  const { data: published } = await supabase
    .from("automation_versions")
    .select("published_at, published_by, updated_at")
    .eq("business_id", businessId)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const updatedAt =
    published?.published_at ??
    selected?.updatedAt ??
    sequences
      .map((item) => item.updatedAt)
      .sort()
      .at(-1) ??
    null;

  if (!published?.published_by) {
    return { state, updatedAt, updatedByInitials: null, updatedByName: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", published.published_by)
    .maybeSingle();

  return {
    state,
    updatedAt,
    updatedByInitials: profile
      ? initialsFrom(profile.first_name, profile.last_name, profile.email)
      : null,
    updatedByName: profile
      ? displayName(profile.first_name, profile.last_name, profile.email)
      : null,
  };
}

/** The workspace values a test send resolves merge fields against. */
export type TestSendContext = {
  businessName: string;
  businessPhone: string | null;
  bookingLink: string | null;
};

export async function getTestSendContext(
  businessId: string,
): Promise<TestSendContext> {
  const supabase = await createClient();

  const [business, settings] = await Promise.all([
    supabase
      .from("businesses")
      .select("name, phone")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_settings")
      .select("booking_url")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  return {
    businessName: business.data?.name ?? "your business",
    businessPhone: business.data?.phone ?? null,
    bookingLink: settings.data?.booking_url ?? null,
  };
}
