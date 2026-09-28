"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit, type AuditAction } from "@/lib/audit";
import { getPlatformOperator } from "@/lib/admin/guard";
import { getUser } from "@/lib/auth/session";
import { stepUpRemainingMs } from "@/lib/admin/step-up";
import type { AdminActionResult } from "@/lib/admin/guarded";
import { BANNER_CACHE_TAG, invalidateAppBannerCache } from "@/lib/banners/server";
import { safeBannerLink } from "@/lib/banners/select";
import {
  BANNER_AUDIENCES,
  BANNER_PLACEMENTS,
  BANNER_PLANS,
  BANNER_TONES,
  BODY_MAX,
  LINK_LABEL_MAX,
  PRIORITY_MAX,
  TITLE_MAX,
} from "@/lib/banners/types";
import { authorizeSiteChange } from "./authz";
import { londonLocalToUtc, windowPhase } from "./schedule";
import { invalidateMaintenanceCache, MAINTENANCE_CACHE_TAG } from "./state";
import { queueMaintenanceNotices } from "./notices";
import { toAdminWindow, WINDOW_COLUMNS } from "./admin";
import { MAINTENANCE_LEVELS, MESSAGE_MAX, type EffectiveLevel } from "./types";

/**
 * /admin/site writes: maintenance windows and platform banners.
 *
 * Every action runs the same gate (`siteGate`): a platform operator resolved
 * from the database, their `platform_role` re-read server-side, a step-up in
 * the last 30 minutes, and, to switch on APP_OFFLINE or SITE_OFFLINE, an
 * offline-capable role plus the level's name typed back (authz.ts). Refusals
 * and successes are both written to the audit log, which is the history the
 * page shows.
 *
 * Every write refreshes this instance's maintenance cache and revalidates the
 * tagged caches the status page and the website banner read, so the change is
 * immediate here and reaches every other instance within 20 seconds.
 */

type Operator = { id: string; email: string };

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const NOT_MIGRATED =
  "Maintenance and banners are not available on this database yet (migration 0161 is not applied).";

function friendly(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "That change could not be saved.";
  if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")) return NOT_MIGRATED;
  return "That change could not be saved.";
}

/**
 * The actor, resolved from the verified session and `profiles.platform_role`
 * (never a client value), then handed to `authorizeAndRun`.
 */
async function siteGate(
  action: AuditAction,
  level: EffectiveLevel,
  confirmText: string | null | undefined,
  run: RunSiteChange,
): Promise<AdminActionResult> {
  const user = await getUser();
  const operator = user ? await getPlatformOperator() : null;
  if (!operator) {
    await recordAudit({
      businessId: null,
      actorType: "platform_admin",
      action: "admin.action_denied",
      metadata: { attempted: action },
    });
    return { ok: false, code: "forbidden", error: "Not permitted." };
  }
  return authorizeAndRun(operator, action, level, confirmText, run);
}

type RunSiteChange = (operator: Operator) => Promise<AdminActionResult & { audit?: Record<string, unknown> }>;

async function authorizeAndRun(
  operator: Operator,
  action: AuditAction,
  level: EffectiveLevel,
  confirmText: string | null | undefined,
  run: RunSiteChange,
): Promise<AdminActionResult> {
  // Re-read, not taken from the cached operator: the offline switch is the
  // most consequential thing in the console, so it gets its own fresh read.
  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("platform_role")
    .eq("id", operator.id)
    .maybeSingle();

  const verdict = authorizeSiteChange({
    platformRole: profile?.platform_role ?? null,
    stepUpRemainingMs: await stepUpRemainingMs(operator.id),
    level,
    confirmText,
  });

  if (!verdict.ok) {
    if (verdict.code !== "step_up_required") {
      await recordAudit({
        businessId: null,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action,
        metadata: { outcome: "denied", reason: verdict.code, level },
      });
    }
    return {
      ok: false,
      error: verdict.message,
      code: verdict.code === "step_up_required" ? "step_up_required" : verdict.code === "forbidden" ? "forbidden" : undefined,
    };
  }

  try {
    const result = await run({ id: operator.id, email: operator.email });
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action,
      metadata: result.ok
        ? { outcome: "ok", level, ...(result.audit ?? {}) }
        : { outcome: "failed", level, reason: result.error },
    });
    return result.ok
      ? { ok: true, message: result.message }
      : { ok: false, error: result.error, code: result.code };
  } catch (error) {
    console.error(`[admin/site] ${action} failed`, error);
    return { ok: false, error: "That change could not be saved." };
  }
}

function refreshSite(): void {
  invalidateMaintenanceCache();
  invalidateAppBannerCache();
  updateTag(MAINTENANCE_CACHE_TAG);
  updateTag(BANNER_CACHE_TAG);
  revalidatePath("/admin/site");
}

/* ============================================================ maintenance */

const localTime = z.string().trim().max(20).optional();

const maintenanceSchema = z.object({
  level: z.enum(MAINTENANCE_LEVELS),
  startMode: z.enum(["now", "scheduled"]),
  startsAtLocal: localTime,
  endsAtLocal: localTime,
  expectedBackLocal: localTime,
  message: z.string().trim().max(MESSAGE_MAX).optional(),
  reason: z.string().trim().max(500).optional(),
  keepQuotePagesOnline: z.boolean(),
  keepAutomationRunning: z.boolean(),
  announceBanner: z.boolean(),
  notifyOwners: z.boolean(),
  confirmText: z.string().trim().max(40).optional(),
});

type Times = { startsAt: string; endsAt: string | null; expectedBackAt: string | null };

function resolveTimes(
  input: z.infer<typeof maintenanceSchema>,
  now: Date,
): { ok: true; times: Times } | { ok: false; error: string } {
  const startsAt =
    input.startMode === "now" ? now.toISOString() : input.startsAtLocal ? londonLocalToUtc(input.startsAtLocal) : null;
  if (!startsAt) return { ok: false, error: "Choose when maintenance starts (UK time)." };
  if (input.startMode === "scheduled" && Date.parse(startsAt) <= now.getTime()) {
    return { ok: false, error: "A scheduled start must be in the future. To start now, choose Start now." };
  }
  const endsAt = input.endsAtLocal ? londonLocalToUtc(input.endsAtLocal) : null;
  if (input.endsAtLocal && !endsAt) return { ok: false, error: "The end time is not a valid date." };
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { ok: false, error: "The end must be after the start." };
  }
  const expectedBackAt = input.expectedBackLocal ? londonLocalToUtc(input.expectedBackLocal) : null;
  if (input.expectedBackLocal && !expectedBackAt) return { ok: false, error: "The expected-back time is not a valid date." };
  if (expectedBackAt && Date.parse(expectedBackAt) <= Date.parse(startsAt)) {
    return { ok: false, error: "The expected-back time must be after the start." };
  }
  return { ok: true, times: { startsAt, endsAt, expectedBackAt } };
}

function overlaps(a: { startsAt: string; endsAt: string | null }, b: { startsAt: string; endsAt: string | null }) {
  const aEnd = a.endsAt ? Date.parse(a.endsAt) : Infinity;
  const bEnd = b.endsAt ? Date.parse(b.endsAt) : Infinity;
  return Date.parse(a.startsAt) < bEnd && Date.parse(b.startsAt) < aEnd;
}

async function openWindows(exceptId?: string) {
  const { data, error } = await db()
    .from("platform_maintenance_windows")
    .select(WINDOW_COLUMNS)
    .is("ended_at", null)
    .is("cancelled_at", null)
    .limit(50);
  if (error) return { error };
  const now = new Date();
  const windows = (data ?? [])
    .map((row) => toAdminWindow(row as never, now))
    .filter((w): w is NonNullable<typeof w> => w !== null && w.id !== exceptId && (w.phase === "ACTIVE" || w.phase === "SCHEDULED"));
  return { windows };
}

export async function scheduleMaintenance(input: unknown): Promise<AdminActionResult> {
  const parsed = maintenanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those maintenance details are not valid." };
  const data = parsed.data;

  return siteGate("admin.maintenance_scheduled", data.level, data.confirmText, async (operator) => {
    const now = new Date();
    const resolved = resolveTimes(data, now);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    const open = await openWindows();
    if ("error" in open) return { ok: false, error: friendly(open.error) };
    const clash = open.windows.find((w) => overlaps(w, resolved.times));
    if (clash) {
      return {
        ok: false,
        error: "This overlaps another maintenance window. End or edit that one first, so only one window is ever in force.",
      };
    }

    const { data: row, error } = await db()
      .from("platform_maintenance_windows")
      .insert({
        level: data.level,
        starts_at: resolved.times.startsAt,
        ends_at: resolved.times.endsAt,
        expected_back_at: resolved.times.expectedBackAt,
        message: data.message || null,
        reason: data.reason || null,
        keep_quote_pages_online: data.keepQuotePagesOnline,
        keep_automation_running: data.keepAutomationRunning,
        announce_banner: data.announceBanner,
        notify_owners: data.notifyOwners,
        created_by: operator.id,
        created_by_email: operator.email,
      })
      .select("id")
      .single();
    if (error || !row) return { ok: false, error: friendly(error) };

    let queued = 0;
    if (data.notifyOwners) {
      const notice = await queueMaintenanceNotices(row.id);
      queued = notice.queued;
      if (notice.queued > 0) {
        await recordAudit({
          businessId: null,
          actorUserId: operator.id,
          actorType: "platform_admin",
          action: "admin.maintenance_notice_queued",
          entityType: "platform_maintenance_window",
          entityId: row.id,
          metadata: { outcome: "ok", level: data.level, detail: `${notice.queued} workspaces` },
        });
      }
    }

    refreshSite();
    const started = data.startMode === "now";
    return {
      ok: true,
      message: started
        ? "Maintenance is on. It reaches every server within about 20 seconds."
        : `Maintenance scheduled.${queued > 0 ? ` Owner emails queued for ${queued} workspaces.` : ""}`,
      audit: {
        window_id: row.id,
        detail: started ? "started now" : `starts ${resolved.times.startsAt}`,
        starts_at: resolved.times.startsAt,
        ends_at: resolved.times.endsAt,
        keep_automation_running: data.keepAutomationRunning,
        keep_quote_pages_online: data.keepQuotePagesOnline,
        notify_owners: data.notifyOwners,
      },
    };
  });
}

const updateSchema = maintenanceSchema.extend({ id: z.uuid() });

export async function updateMaintenance(input: unknown): Promise<AdminActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those maintenance details are not valid." };
  const data = parsed.data;

  // Look first, then gate: raising an active window to an offline level needs
  // the typed confirmation even though it is an edit.
  const { data: currentRow, error: readError } = await db()
    .from("platform_maintenance_windows")
    .select(WINDOW_COLUMNS)
    .eq("id", data.id)
    .maybeSingle();
  const now = new Date();
  const current = currentRow ? toAdminWindow(currentRow as never, now) : null;
  const levelChanging = current !== null && current.level !== data.level;

  return siteGate(
    "admin.maintenance_updated",
    levelChanging || current?.phase === "SCHEDULED" ? data.level : "OFF",
    data.confirmText,
    async () => {
      if (readError) return { ok: false, error: friendly(readError) };
      if (!current) return { ok: false, error: "That maintenance window no longer exists." };
      if (current.phase === "ENDED" || current.phase === "CANCELLED") {
        return { ok: false, error: "That maintenance window is over and can no longer be edited." };
      }

      // An active window keeps its start: it has already begun.
      const resolved = resolveTimes(
        current.phase === "ACTIVE" ? { ...data, startMode: "now" } : data,
        current.phase === "ACTIVE" ? new Date(current.startsAt) : now,
      );
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const startsAt = current.phase === "ACTIVE" ? current.startsAt : resolved.times.startsAt;
      if (resolved.times.endsAt && Date.parse(resolved.times.endsAt) <= now.getTime() && current.phase === "ACTIVE") {
        return { ok: false, error: "The end is already in the past. Use End maintenance now instead." };
      }

      const open = await openWindows(current.id);
      if ("error" in open) return { ok: false, error: friendly(open.error) };
      if (open.windows.some((w) => overlaps(w, { startsAt, endsAt: resolved.times.endsAt }))) {
        return { ok: false, error: "This would overlap another maintenance window." };
      }

      const { error } = await db()
        .from("platform_maintenance_windows")
        .update({
          level: data.level,
          starts_at: startsAt,
          ends_at: resolved.times.endsAt,
          expected_back_at: resolved.times.expectedBackAt,
          message: data.message || null,
          reason: data.reason || null,
          keep_quote_pages_online: data.keepQuotePagesOnline,
          keep_automation_running: data.keepAutomationRunning,
          announce_banner: data.announceBanner,
          notify_owners: data.notifyOwners || current.notifyOwners,
        })
        .eq("id", current.id);
      if (error) return { ok: false, error: friendly(error) };

      let queued = 0;
      if (data.notifyOwners && !current.noticeQueuedAt) {
        queued = (await queueMaintenanceNotices(current.id)).queued;
      }

      refreshSite();
      return {
        ok: true,
        message: `Maintenance updated.${queued > 0 ? ` Owner emails queued for ${queued} workspaces.` : ""}`,
        audit: {
          window_id: current.id,
          before: { level: current.level, ends_at: current.endsAt, message: current.message },
          after: { level: data.level, ends_at: resolved.times.endsAt, message: data.message || null },
        },
      };
    },
  );
}

const idSchema = z.object({ id: z.uuid() });

/**
 * "End maintenance now": an active window ends this instant; a scheduled one
 * is cancelled. Turning maintenance off never needs the typed confirmation,
 * because the safe direction should be the easy one.
 */
export async function endMaintenanceNow(input: unknown): Promise<AdminActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That maintenance window is not valid." };

  return siteGate("admin.maintenance_ended", "OFF", null, async (operator) => {
    const { data: row, error: readError } = await db()
      .from("platform_maintenance_windows")
      .select(WINDOW_COLUMNS)
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (readError) return { ok: false, error: friendly(readError) };
    const now = new Date();
    const window = row ? toAdminWindow(row as never, now) : null;
    if (!window) return { ok: false, error: "That maintenance window no longer exists." };

    const phase = windowPhase(window, now);
    if (phase === "ENDED" || phase === "CANCELLED") {
      refreshSite();
      return { ok: true, message: "That maintenance window had already finished." };
    }

    const patch =
      phase === "ACTIVE"
        ? { ended_at: now.toISOString(), ended_by: operator.id }
        : { cancelled_at: now.toISOString(), ended_by: operator.id };
    const { error } = await db()
      .from("platform_maintenance_windows")
      .update(patch)
      .eq("id", window.id)
      .is("ended_at", null)
      .is("cancelled_at", null);
    if (error) return { ok: false, error: friendly(error) };

    refreshSite();
    return {
      ok: true,
      message:
        phase === "ACTIVE"
          ? "Maintenance ended. Everything is back within about 20 seconds."
          : "Scheduled maintenance cancelled.",
      audit: { window_id: window.id, detail: phase === "ACTIVE" ? "ended early" : "cancelled before start" },
    };
  });
}

/** Queues the owner emails for a window that did not ask for them at first. */
export async function emailOwnersAboutMaintenance(input: unknown): Promise<AdminActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That maintenance window is not valid." };

  return siteGate("admin.maintenance_notice_queued", "OFF", null, async () => {
    const { error } = await db()
      .from("platform_maintenance_windows")
      .update({ notify_owners: true })
      .eq("id", parsed.data.id)
      .is("notice_queued_at", null);
    if (error) return { ok: false, error: friendly(error) };
    const result = await queueMaintenanceNotices(parsed.data.id);
    refreshSite();
    if (result.status === "already") return { ok: true, message: "Owner emails for this window were already queued." };
    if (result.status === "not_eligible") return { ok: false, error: "This window is over or cancelled, so no emails were queued." };
    return {
      ok: true,
      message: `Owner emails queued for ${result.queued} workspaces.`,
      audit: { window_id: parsed.data.id, detail: `${result.queued} workspaces` },
    };
  });
}

/* ================================================================ banners */

const bannerSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1, "Give the banner a title.").max(TITLE_MAX),
  body: z.string().trim().max(BODY_MAX).optional(),
  linkUrl: z.string().trim().max(500).optional(),
  linkLabel: z.string().trim().max(LINK_LABEL_MAX).optional(),
  tone: z.enum(BANNER_TONES),
  audience: z.enum(BANNER_AUDIENCES),
  plans: z.array(z.enum(BANNER_PLANS)).max(5),
  businessIds: z.array(z.uuid()).max(200),
  placements: z.array(z.enum(BANNER_PLACEMENTS)).min(1, "Choose at least one placement.").max(3),
  startsAtLocal: localTime,
  endsAtLocal: localTime,
  dismissible: z.boolean(),
  priority: z.number().int().min(0).max(PRIORITY_MAX),
});

/** Anything that looks like markup is refused rather than escaped and shown. */
function looksLikeHtml(value: string | undefined): boolean {
  return !!value && /<\s*\/?\s*[a-z!]/i.test(value);
}

export async function saveBanner(input: unknown): Promise<AdminActionResult> {
  const parsed = bannerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those banner details are not valid." };
  }
  const data = parsed.data;
  const action: AuditAction = data.id ? "admin.banner_updated" : "admin.banner_created";

  return siteGate(action, "OFF", null, async (operator) => {
    if (looksLikeHtml(data.title) || looksLikeHtml(data.body) || looksLikeHtml(data.linkLabel)) {
      return { ok: false, error: "Banners are plain text. Remove the HTML and add a link with the link field." };
    }
    const link = data.linkUrl ? safeBannerLink(data.linkUrl) : null;
    if (data.linkUrl && !link) {
      return { ok: false, error: "The link must be a page on this site (/pricing) or an https:// address." };
    }
    if (link && !data.linkLabel) return { ok: false, error: "Give the link a label, such as Read more." };
    if (data.audience === "PLANS" && data.plans.length === 0) return { ok: false, error: "Choose at least one plan." };
    if (data.audience === "WORKSPACES" && data.businessIds.length === 0) {
      return { ok: false, error: "Add at least one workspace id." };
    }
    if (data.audience === "MARKETING_VISITORS" && !data.placements.includes("MARKETING_TOP")) {
      return { ok: false, error: "Website visitors only see the website top bar. Add that placement." };
    }
    if (data.audience !== "ALL" && data.audience !== "MARKETING_VISITORS" && data.placements.includes("MARKETING_TOP")) {
      return { ok: false, error: "Only Everyone or Website visitors banners can appear on the website." };
    }

    const now = new Date();
    const startsAt = data.startsAtLocal ? londonLocalToUtc(data.startsAtLocal) : now.toISOString();
    if (!startsAt) return { ok: false, error: "The start time is not a valid date." };
    const endsAt = data.endsAtLocal ? londonLocalToUtc(data.endsAtLocal) : null;
    if (data.endsAtLocal && !endsAt) return { ok: false, error: "The end time is not a valid date." };
    if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return { ok: false, error: "The end must be after the start." };

    const row = {
      title: data.title,
      body: data.body || null,
      link_url: link,
      link_label: link ? data.linkLabel || null : null,
      tone: data.tone,
      audience: data.audience,
      plans: data.audience === "PLANS" ? data.plans : [],
      business_ids: data.audience === "WORKSPACES" ? data.businessIds : [],
      placements: data.placements,
      starts_at: startsAt,
      ends_at: endsAt,
      dismissible: data.dismissible,
      priority: data.priority,
      updated_by: operator.id,
    };

    const client = db();
    const result = data.id
      ? await client.from("platform_banners").update({ ...row, ended_at: null }).eq("id", data.id).select("id").maybeSingle()
      : await client.from("platform_banners").insert({ ...row, created_by: operator.id }).select("id").single();
    if (result.error) return { ok: false, error: friendly(result.error) };
    if (!result.data) return { ok: false, error: "That banner no longer exists." };

    refreshSite();
    return {
      ok: true,
      message: data.id ? "Banner updated." : "Banner created.",
      audit: { banner_id: result.data.id, title: data.title, detail: `${data.tone}, ${data.audience}` },
    };
  });
}

export async function endBannerNow(input: unknown): Promise<AdminActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That banner is not valid." };
  return siteGate("admin.banner_ended", "OFF", null, async () => {
    const { data, error } = await db()
      .from("platform_banners")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .is("ended_at", null)
      .select("id, title")
      .maybeSingle();
    if (error) return { ok: false, error: friendly(error) };
    refreshSite();
    return {
      ok: true,
      message: data ? "Banner ended." : "That banner had already ended.",
      audit: { banner_id: parsed.data.id, title: data?.title ?? null },
    };
  });
}

export async function deleteBanner(input: unknown): Promise<AdminActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That banner is not valid." };
  return siteGate("admin.banner_deleted", "OFF", null, async () => {
    const client = db();
    const { data, error } = await client
      .from("platform_banners")
      .delete()
      .eq("id", parsed.data.id)
      .select("id, title")
      .maybeSingle();
    if (error) return { ok: false, error: friendly(error) };
    // Dismissals are keyed by text, not a foreign key, so they go explicitly.
    await client.from("platform_banner_dismissals").delete().eq("banner_key", parsed.data.id);
    refreshSite();
    return {
      ok: true,
      message: data ? "Banner deleted." : "That banner was already deleted.",
      audit: { banner_id: parsed.data.id, title: data?.title ?? null },
    };
  });
}
