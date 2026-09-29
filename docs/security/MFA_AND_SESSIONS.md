# Two-factor authentication, sessions and audit retention

Built 2026-09-29 (internal review IR-06 and IR-09). Code: `src/lib/auth/security-policy.ts`
(rules), `src/lib/auth/account-security.ts` (enforcement), `src/lib/auth/mfa-actions.ts`
(Server Actions), `src/lib/admin/guard.ts` (admin gate), migration `0180_security_controls.sql`.

## What is enforced

| Who | Rule | Where |
|---|---|---|
| Platform admins | Two-factor (TOTP) is **mandatory**. `/admin` opens only at AAL2. An operator with no authenticator is sent to `/admin/mfa` to enrol one; with one, to enter the code. | `requirePlatformAdmin()`, `getPlatformOperator()` |
| Platform admins | Step-up before any admin change = password **and** a fresh authenticator code, valid 30 minutes. The password is checked on a throwaway client so the AAL2 session is not replaced. Signing in with a password alone no longer opens step-up; the code at `/admin/mfa` does. | `confirmStepUp`, `lib/auth/password-check.ts` |
| Platform admins | The last authenticator cannot be removed; removing any needs a current step-up. | `canRemoveFactor`, `removeTotpFactor` |
| Any member with an authenticator | Every sign-in needs the code (AAL2) before the app opens, whether or not the workspace requires it. | `requireWorkspace()` -> `/mfa` |
| Members of a workspace that requires it | Owner setting "Require two-factor for all members": a member without an authenticator is sent to `/mfa` to set one up; their last authenticator cannot be removed. The owner must have one before switching it on. | Settings -> Security |
| Members of a workspace with an idle timeout | Owner setting (15 min to 12 h): the proxy records a signed last-activity time (`ct_activity` cookie, HMAC, bound to the user); `requireWorkspace()` compares it and signs the device out through `/auth/session-expired`. | `lib/auth/activity-proxy.ts` |
| Everyone | Settings -> Security lists active sessions (browser, IP, signed in, last active, two-factor) and offers "Sign out other sessions" and "Sign out everywhere". The admin equivalent is Admin -> Settings -> Your sign-in security. | `my_auth_sessions()` (0180) |

Server Actions and service operations resolve the workspace through `requireWorkspace()`, so
they are covered. The API routes that read the workspace directly (exports, search, analytics
export, billing portal, find-leads run status, banner dismissal) use `getSecureWorkspace()`,
which returns 401 when the policy is not met. Public API keys and MCP are separate credentials
(`docs/DEVELOPER_PLATFORM.md`) and are not affected.

Every enrolment start, enrolment, failed enrolment code, removal, refused removal, successful
and failed challenge, session revocation, idle sign-out and policy change is written to
`audit_log` (`security.*` actions; operators with actor type `platform_admin`).

## Owner steps

1. **Supabase Auth -> Multi-Factor**: confirm **TOTP (App Authenticator)** is enabled. It is on
   by default on every Supabase plan and costs nothing. Phone MFA is not used (it would send
   SMS). No email is involved in TOTP.
2. **Before deploying**: each platform admin should know that their next visit to `/admin` will
   ask them to enrol an authenticator. After enrolling, add a **second** authenticator
   (Admin -> Settings -> Your sign-in security), for example a password manager.
3. **Apply migration 0180** (`supabase/migrations/0180_security_controls.sql`). Two-factor
   itself works without it. Without it: the workspace policy card shows as "being switched on",
   the session list shows as unavailable, and the audit retention job skips.
4. **Optional**: set `SESSION_ACTIVITY_SECRET` (32 random bytes, hex) in Vercel. Without it the
   idle timeout signs with `ADMIN_STEP_UP_SECRET` (already set in production). With neither,
   the idle timeout is not enforced.
5. Make sure the Supabase account that owns the project has its own MFA switched on: it is the
   recovery path below.

## Recovery: a lost authenticator

Supabase TOTP has no recovery codes, so recovery is an operator action in Supabase, never a
self-service bypass in ClientTurn.

**Workspace member.** The workspace owner contacts support. Support confirms the request comes
from the owner (reply from the owner's sign-in address, plus a detail only the workspace would
know), then a platform admin, or the project owner, removes the member's factors (below). The
member signs in with their password and sets up a new authenticator; if the workspace requires
two-factor they are asked to straight away. Record the request in the support thread.

**Platform admin, including the sole admin.** The recovery path is the Supabase project owner
(the person who can open the Supabase dashboard for `losieaikadkadtmezini`):

1. Supabase Dashboard -> Authentication -> Users -> the admin's user -> remove the MFA factor(s).
   Or, in the SQL editor:

   ```sql
   -- Confirm the user first.
   select id, email from auth.users where email = '<admin email>';
   -- Removes every authenticator; their sessions drop to AAL1.
   delete from auth.mfa_factors where user_id = '<user id>';
   ```

   Or with the service role: `supabase.auth.admin.mfa.deleteFactor({ userId, id })`.
2. The admin signs in at `/admin/login` and is sent to `/admin/mfa` to enrol a new
   authenticator. `/admin` stays closed until they do, so the account is never left
   password-only.
3. Add an entry to the security log (who asked, who verified, when). The removal itself is not
   in `audit_log` because it happens outside the app; the new enrolment is.

This path depends only on Supabase dashboard access, so ClientTurn can never lock out its only
admin: the worst case is a dashboard action by the project owner. Keeping two authenticators per
admin means it should rarely be needed.

## Audit-log retention (IR-09)

The daily `audit.retention` job (`docs/CRON.md`) deletes `audit_log` rows older than the
workspace's retention: 12 months by default (the period the Privacy Policy states). Owners can
choose 6 months, or longer where the plan allows (Pro up to 24 months, Enterprise up to 7 years;
a downgrade caps it automatically). Platform rows keep 12 months. Deletes run 1,000 rows at a
time with a 50,000-row daily budget through `audit_log_purge_batch`, which refuses any cutoff
under 28 days. Only `audit_log` rows are deleted: exports already downloaded are the customer's
own copy and are unaffected. Each purge writes one `security.audit_log_purged` summary row.
