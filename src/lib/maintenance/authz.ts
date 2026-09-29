/**
 * Who may change maintenance and banners, as a pure function.
 *
 * The role model: `profiles.platform_role` is `user` or `platform_admin`
 * (0001_core.sql), read server-side from the database and never from a
 * cookie. There is no separate "ops" or "support" tier today, so the
 * super-admin/ops level the brief asks for is `platform_admin`. The check is
 * written against an allow-list rather than "not user", so a lower platform
 * tier added later (say `platform_support`) is refused the offline levels by
 * default instead of inheriting them.
 *
 * In the order it is applied:
 *
 *   1. a platform role that may manage the site at all;
 *   2. a step-up within the last 30 minutes, for every change (the admin
 *      shell's rule for every mutation, resolved conflict 4);
 *   3. for APP_OFFLINE / SITE_OFFLINE only, a role on the offline allow-list
 *      and the level's name typed back exactly (`SITE_OFFLINE`), because a
 *      mis-click on that switch takes the business off the internet.
 *
 * Pure: relative imports only.
 */

import { isOfflineLevel, type EffectiveLevel } from "./types.ts";

/** Platform roles that may manage banners and read-only maintenance. */
export const SITE_MANAGER_ROLES: ReadonlySet<string> = new Set(["platform_admin"]);
/** Platform roles that may take the app or the whole site offline. */
export const OFFLINE_ROLES: ReadonlySet<string> = new Set(["platform_admin"]);

export type SiteChangeCheck = {
  /** profiles.platform_role, read from the database. */
  platformRole: string | null;
  stepUpRemainingMs: number;
  /** The level being switched on or scheduled; OFF for banners and "end now". */
  level: EffectiveLevel;
  /** What the operator typed in the confirmation box. */
  confirmText?: string | null;
};

export type SiteChangeVerdict =
  | { ok: true }
  | {
      ok: false;
      code: "forbidden" | "step_up_required" | "offline_role_required" | "confirmation_required";
      message: string;
    };

export function authorizeSiteChange(check: SiteChangeCheck): SiteChangeVerdict {
  if (!check.platformRole || !SITE_MANAGER_ROLES.has(check.platformRole)) {
    return { ok: false, code: "forbidden", message: "Not permitted." };
  }
  if (!(check.stepUpRemainingMs > 0)) {
    return { ok: false, code: "step_up_required", message: "Confirm your password and authenticator code to continue." };
  }
  if (isOfflineLevel(check.level)) {
    if (!OFFLINE_ROLES.has(check.platformRole)) {
      return {
        ok: false,
        code: "offline_role_required",
        message: "Only a platform admin can take the app or the site offline.",
      };
    }
    if ((check.confirmText ?? "").trim() !== check.level) {
      return {
        ok: false,
        code: "confirmation_required",
        message: `Type ${check.level} to confirm.`,
      };
    }
  }
  return { ok: true };
}
