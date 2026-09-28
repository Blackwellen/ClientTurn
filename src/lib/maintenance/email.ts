/**
 * The customer notice email for one maintenance window: "Email workspace
 * owners about this maintenance" (docs/MAINTENANCE.md).
 *
 * One email per workspace owner, queued once per window. Idempotency is held
 * in two places so neither alone has to be perfect:
 *
 *   * the window row's `notice_queued_at` is claimed with a conditional update
 *     (`where notice_queued_at is null`) before anything is queued, so a double
 *     click or a retried action queues nothing the second time;
 *   * each job carries `maintenanceNoticeJobKey(window, workspace)`, so the
 *     queue itself refuses a duplicate while one is pending.
 *
 * Sent through the existing `notification.send` job, which re-reads the
 * window before sending (a cancelled window sends nothing) and counts each
 * copy against the workspace's daily system-email cap.
 *
 * Pure: relative imports only, so tests render exactly what would be sent
 * without sending anything. House style: plain words, no dashes as
 * punctuation, a text part beside the HTML.
 */

import { brandedEmailHtml, escapeHtml } from "../email/branded-email.ts";
import { formatLondon } from "./schedule.ts";
import { LEVEL_LABEL, type MaintenanceLevel } from "./types.ts";

export const MAINTENANCE_NOTICE_KIND = "platform_maintenance_notice";

export function maintenanceNoticeJobKey(windowId: string, businessId: string): string {
  return `notification.send:maintenance-notice:${windowId}:${businessId}`;
}

/** Whether a window may still have its notice queued now. */
export function shouldQueueMaintenanceNotice(window: {
  notifyOwners: boolean;
  noticeQueuedAt: string | null;
  cancelledAt: string | null;
  endedAt: string | null;
  endsAt: string | null;
}, now: Date): boolean {
  if (!window.notifyOwners || window.noticeQueuedAt || window.cancelledAt || window.endedAt) return false;
  if (window.endsAt && Date.parse(window.endsAt) <= now.getTime()) return false;
  return true;
}

const IMPACT: Record<MaintenanceLevel, string> = {
  READ_ONLY:
    "You will be able to sign in and see everything, but changes will be paused: nothing can be saved, edited or sent by hand until we finish.",
  APP_OFFLINE:
    "The ClientTurn app will be unavailable while we work. Our website and your public quote links stay up.",
  SITE_OFFLINE:
    "ClientTurn, including our website, will be unavailable while we work.",
};

export type MaintenanceNoticeEmail = {
  subject: string;
  /** Short line for the in-app notification row. */
  summary: string;
  text: string;
  html: string;
};

export function maintenanceNoticeEmail(input: {
  siteUrl: string;
  firstName: string | null;
  level: MaintenanceLevel;
  startsAt: string;
  endsAt: string | null;
  message: string | null;
  keepAutomationRunning: boolean;
}): MaintenanceNoticeEmail {
  const start = formatLondon(input.startsAt);
  const end = input.endsAt ? formatLondon(input.endsAt) : null;
  const when = end ? `from ${start} until ${end} (UK time)` : `from ${start} (UK time)`;
  const subject = `Planned maintenance: ${start}`;
  const greeting = input.firstName?.trim() ? `Hi ${input.firstName.trim()},` : "Hello,";

  const automation =
    input.level === "READ_ONLY" || input.keepAutomationRunning
      ? "Your automated follow-up keeps running, and new leads, replies, payments and opt-outs are received as normal."
      : "New leads, replies, payments and opt-outs are still received and safely queued. Automated follow-up messages wait until we are back, then send as normal.";

  const paragraphs = [
    greeting,
    `We have planned maintenance on ClientTurn ${when}. Mode: ${LEVEL_LABEL[input.level]}.`,
    IMPACT[input.level],
    automation,
    ...(input.message?.trim() ? [input.message.trim()] : []),
    "You can follow progress on our status page at any time. There is nothing you need to do.",
  ];

  const statusUrl = `${input.siteUrl}/status`;
  const text = `${paragraphs.join("\n\n")}\n\nStatus: ${statusUrl}\n\nThe ClientTurn team`;
  const html = brandedEmailHtml({
    siteUrl: input.siteUrl,
    heading: "Planned maintenance",
    paragraphs: paragraphs.map(escapeHtml),
    ctaLabel: "View live status",
    ctaUrl: statusUrl,
  });

  return {
    subject,
    summary: `Planned maintenance ${when}.`,
    text,
    html,
  };
}
