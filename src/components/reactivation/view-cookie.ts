/**
 * The Reactivation view-preference key, shared by the client hook that writes
 * it and the server page that reads it.
 *
 * It lives in a plain module on purpose. Exported from the `"use client"`
 * hook, a server component importing it receives a client reference rather
 * than the string, so `cookies().get(...)` looked up the wrong key and a
 * list-view user got cards on every load (surface QA 2026-09-30; the same bug
 * class broke /admin/system views).
 */
export const REACTIVATION_VIEW_COOKIE = "clientturn.reactivation.view";
