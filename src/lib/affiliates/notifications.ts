import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveNotificationPrefs,
  type NotificationPrefKey,
} from "./programme";

/**
 * Affiliate notifications (V4 §36).
 *
 * A separate table from the customer notification feed, because that one is
 * workspace-scoped and an affiliate has no workspace. Trying to reuse it would
 * mean either a nullable tenant column on a table whose whole safety story is
 * that the column is not nullable, or an affiliate row inside a customer's
 * feed. Neither is worth the saved table.
 *
 * Every write checks the affiliate's preference for that category first, so
 * turning a toggle off actually stops the notification being created rather
 * than just hiding it.
 */

export type AffiliateNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Records a notification, if the affiliate wants that category.
 *
 * Best-effort by design: it is called from inside billing webhooks and payout
 * runs, and a failure to write a notification must never roll back money that
 * has already moved.
 */
export async function notifyAffiliate(
  affiliateId: string,
  category: NotificationPrefKey,
  notification: { kind: string; title: string; body?: string; href?: string },
): Promise<void> {
  try {
    const db = createAdminClient();

    const { data: affiliate } = await db
      .from("affiliates")
      .select("notification_prefs")
      .eq("id", affiliateId)
      .maybeSingle();

    if (!affiliate) return;

    const prefs = resolveNotificationPrefs(affiliate.notification_prefs);
    if (!prefs[category]) return;

    await db.from("affiliate_notifications").insert({
      affiliate_id: affiliateId,
      kind: notification.kind,
      title: notification.title,
      body: notification.body ?? null,
      href: notification.href ?? null,
    });
  } catch {
    // Deliberately swallowed. See the note above: this runs inside financial
    // paths and must not be able to fail them.
  }
}

export async function listNotifications(
  affiliateId: string,
  limit = 20,
): Promise<AffiliateNotification[]> {
  const { data } = await createAdminClient()
    .from("affiliate_notifications")
    .select("id, kind, title, body, href, read_at, created_at")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

/** Scoped by affiliate as well as id: the id came from a browser. */
export async function markNotificationsRead(affiliateId: string): Promise<void> {
  await createAdminClient()
    .from("affiliate_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("affiliate_id", affiliateId)
    .is("read_at", null);
}
