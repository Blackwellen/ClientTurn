import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { getEntitlements } from "@/lib/billing/entitlements";
import { consumeSystemEmail } from "@/lib/email/system-email-budget";
import { maintenanceNoticeEmail } from "./email";
import { windowPhase } from "./schedule";
import { MAINTENANCE_LEVELS, type MaintenanceLevel } from "./types";

type SendEmail = (to: string, subject: string, text: string, from?: string, html?: string) => Promise<void>;

/**
 * The `platform_maintenance_notice` kind of `notification.send`: email this
 * workspace's owner(s) about one maintenance window.
 *
 * Re-reads the window first (a job is retry-safe and re-reads current state
 * before any external action): a window cancelled or ended since the emails
 * were queued sends nothing. Each copy counts against the workspace's daily
 * system-email cap, like every other system email. The send itself is passed
 * in, so this uses the handler's one Resend path rather than a second one.
 */
export async function sendMaintenanceNotice(
  payload: { businessId: string; entityId?: string | null },
  sendEmail: SendEmail,
): Promise<void> {
  if (!payload.entityId) return;
  const admin = createAdminClient();
  const untyped = admin as unknown as SupabaseClient;

  const { data: row } = await untyped
    .from("platform_maintenance_windows")
    .select("id, level, starts_at, ends_at, expected_back_at, message, keep_automation_running, keep_quote_pages_online, announce_banner, ended_at, cancelled_at")
    .eq("id", payload.entityId)
    .maybeSingle();
  if (!row || !(MAINTENANCE_LEVELS as readonly string[]).includes(row.level)) return;

  const window = {
    id: row.id as string,
    level: row.level as MaintenanceLevel,
    startsAt: row.starts_at as string,
    endsAt: (row.ends_at as string | null) ?? null,
    expectedBackAt: (row.expected_back_at as string | null) ?? null,
    message: (row.message as string | null) ?? null,
    keepQuotePagesOnline: row.keep_quote_pages_online !== false,
    keepAutomationRunning: row.keep_automation_running === true,
    announceBanner: row.announce_banner !== false,
    endedAt: (row.ended_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
  };
  const phase = windowPhase(window, new Date());
  if (phase === "ENDED" || phase === "CANCELLED") return;

  const { data: owners } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", payload.businessId)
    .eq("status", "active")
    .eq("role", "owner");
  const ownerIds = (owners ?? []).map((o) => o.user_id);
  if (ownerIds.length === 0) return;

  const { data: people } = await admin.from("profiles").select("id, email, first_name").in("id", ownerIds);
  const plan = await getEntitlements(payload.businessId)
    .then((entitlements) => entitlements.plan)
    .catch(() => "trial");

  for (const person of people ?? []) {
    if (!person.email) continue;
    const budget = await consumeSystemEmail({ businessId: payload.businessId, plan });
    if (!budget.allowed) {
      console.warn("[maintenance] daily system-email cap reached; maintenance notice skipped", {
        businessId: payload.businessId,
        cap: budget.cap,
      });
      break;
    }
    const email = maintenanceNoticeEmail({
      siteUrl: serverEnv.siteUrl,
      firstName: person.first_name ?? null,
      level: window.level,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      message: window.message,
      keepAutomationRunning: window.keepAutomationRunning,
    });
    await sendEmail(person.email, email.subject, email.text, undefined, email.html);
  }
}
