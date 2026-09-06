import "server-only";
import { domainFromWebsite, jobLabel, providerLabel } from "./format";
import { adminRead, truncate, unique, namesFor } from "./shared";
import { referenceFor, fingerprintFor, areaForJobType } from "./errors-shared";
import type { AdminSearchResult } from "./types";

/**
 * Global admin search. Runs entirely on the server behind
 * `requirePlatformAdmin()`; a non-admin session never reaches it, so no
 * cross-tenant row can leak through a stray query string.
 */
export async function searchAdmin(rawQuery: string): Promise<AdminSearchResult[]> {
  const supabase = await adminRead();
  const query = rawQuery
    .replace(/[^\p{L}\p{N}@.\-_ ]/gu, "")
    .trim()
    .slice(0, 80);
  if (query.length < 2) return [];

  const [businesses, profiles, webhooks, jobs] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, website")
      .or(`name.ilike.%${query}%,website.ilike.%${query}%`)
      .limit(6),
    supabase
      .from("profiles")
      .select("id, email, first_name, last_name")
      .or(
        `email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`,
      )
      .limit(6),
    supabase
      .from("webhook_events")
      .select("id, provider, event_type, external_event_id, business_id, status")
      .ilike("external_event_id", `%${query}%`)
      .limit(5),
    supabase
      .from("jobs")
      .select("id, type, business_id, state, last_error")
      .in("state", ["failed", "dead"])
      .ilike("last_error", `%${query}%`)
      .limit(5),
  ]);

  const results: AdminSearchResult[] = [];

  for (const row of businesses.data ?? []) {
    results.push({
      kind: "customer",
      id: row.id,
      title: row.name,
      subtitle: domainFromWebsite(row.website) ?? "Customer workspace",
      href: `/admin/customers?customer=${row.id}`,
    });
  }

  // An owner match resolves to their workspace, which is the thing an
  // operator can actually act on.
  const ownerIds = (profiles.data ?? []).map((row) => row.id);
  if (ownerIds.length > 0) {
    const { data: members } = await supabase
      .from("business_members")
      .select("business_id, user_id")
      .in("user_id", ownerIds)
      .eq("status", "active")
      .limit(10);
    const profileById = new Map((profiles.data ?? []).map((row) => [row.id, row]));
    const names = await namesFor(
      supabase,
      unique((members ?? []).map((row) => row.business_id)),
    );
    for (const member of members ?? []) {
      if (results.some((r) => r.kind === "customer" && r.id === member.business_id)) {
        continue;
      }
      const profile = profileById.get(member.user_id);
      results.push({
        kind: "customer",
        id: member.business_id,
        title: names.get(member.business_id) ?? "Unknown workspace",
        subtitle: profile?.email ?? "Team member match",
        href: `/admin/customers?customer=${member.business_id}`,
      });
    }
  }

  for (const row of webhooks.data ?? []) {
    results.push({
      kind: "event",
      id: row.id,
      title: `${providerLabel(row.provider)} · ${row.event_type ?? "webhook"}`,
      subtitle: `Event ${row.external_event_id}`,
      href: `/admin/system?view=events&event=webhook%3A${row.id}`,
    });
  }

  for (const row of jobs.data ?? []) {
    const area = areaForJobType(row.type);
    const message = truncate(row.last_error ?? "Job failed", 80);
    const fingerprint = fingerprintFor(area, message, row.business_id);
    results.push({
      kind: "error",
      id: row.id,
      title: `${jobLabel(row.type)} failed`,
      subtitle: `${referenceFor(area, fingerprint)} · ${message}`,
      href: `/admin/system?view=errors&error=${fingerprint}`,
    });
  }

  return results.slice(0, 12);
}
