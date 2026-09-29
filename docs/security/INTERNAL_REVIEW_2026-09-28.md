# Internal security review, 28 September 2026 (OWASP Top 10 pass)

Scope: auth, admin step-up, RLS coverage, webhook signature verification, uploads (R2 signed
URLs, SVG), rate limits, secrets exposure, SSRF in website enrichment, open redirects, plus
the new enterprise features (audit export, per-person permissions). Method: code and
migration reading, grep, a static RLS scan of every migration, targeted unit tests. No
production data, no paid provider calls. Builds on gap audit 15 §3 and its batch-3 fixes
(`docs/revenue-engine/15-system-gap-audit.md`).

Severity: High / Medium / Low / Info. Status: **Fixed** (in this change), **Accepted**
(known, reasoned), **Open** (needs owner decision or a larger change).

## Findings

| ID | Sev | Area (OWASP) | Finding | Status |
|---|---|---|---|---|
| IR-01 | Medium | Open redirect (A01) | `?redirect=` / `?next=` checks were `startsWith("/") && !startsWith("//")`. `/\evil.example` (and `/<TAB>/evil.example`) passes and the browser resolves it to `https://evil.example`. After password sign-in the path is passed to `router.replace`, so `/login?redirect=/\evil.example` redirected off-site after a real login (phishing hop). Callback routes prefix the origin and were not exploitable, but shared the weak check. | **Fixed.** New `src/lib/security/safe-redirect.ts` (rejects backslashes, control/whitespace chars, `//`, and anything whose resolved origin differs) used by `lib/auth/destination.ts`, `(auth)/login/page.tsx`, `auth/callback/route.ts`, `api/auth/google/connect/route.ts`. Tests in `tests/audit-export-and-redirects.test.ts`. |
| IR-02 | Low | Uploads (A04) | Logo and support-attachment presigned PUT URLs did not bind the size: `assertUploadAllowed` checked the size the client *declared*, then the client could PUT a far larger body (storage cost / abuse). | **Fixed.** `createUploadUrl(..., contentLength)` signs `Content-Length`; logo and support actions pass the validated size. Verify one logo upload on the next preview deploy (R2 honours signed content-length under SigV4). |
| IR-03 | Low | Security misconfiguration / honesty | Privacy Policy §11 said backups are "taken continuously, and restore-tested". PITR is off and no restore drill has run (`docs/RESTORE.md`). | **Fixed.** Text now says daily encrypted backups held in the UK. Restore drill remains a todo. |
| IR-04 | Low | Vendor transparency | Google Places (Find Leads discovery) was in use but missing from the sub-processor register; R2's entry omitted quote/invoice PDFs, support files and call recordings. | **Fixed.** Register updated with a dated change-log entry (`src/lib/marketing/subprocessors.ts`). |
| IR-05 | Low | Billing portal link | `/api/billing/portal` sent signed-out users to `/login?next=…`, but the login page reads `redirect`, so the user lost their destination (functional, not exploitable). | **Fixed** (`?redirect=`). |
| IR-06 | Medium | Identification and authentication (A07) | No MFA for workspace users, no SSO; admin step-up is password re-entry only, and the step-up HMAC key falls back to the service-role key when `ADMIN_STEP_UP_SECRET` is unset. | **Fixed in code 2026-09-29 (SSO planned).** Key part closed earlier (`ADMIN_STEP_UP_SECRET`, `AFFILIATE_COOKIE_SECRET` set in production; no service-role fallback). TOTP two-factor via Supabase Auth MFA: **mandatory for platform admins** (`/admin` requires AAL2, enrolment gate at `/admin/mfa`, admin step-up now needs password plus a fresh code, last admin factor cannot be removed); **optional for workspace users** (Settings -> Security) with an owner setting to require it for all members, enforced server-side in `requireWorkspace()`. Every enrol, removal and failed code is audit-logged. Owner steps: deploy, apply 0180 (policy, session list), confirm TOTP is enabled in Supabase Auth, enrol two authenticators per admin before deploy. Recovery: `docs/security/MFA_AND_SESSIONS.md`. SSO: `docs/security/SSO_PLAN.md` (planned, paid add-on). |
| IR-07 | Low | Session management (A07) | Supabase SSR auth cookies are readable by JavaScript (library default), so any XSS would expose the session. No XSS sink with user input was found (`dangerouslySetInnerHTML` is used only for static JSON-LD), and React escapes output. | **Accepted**, contingent on moving the CSP to enforced with nonces (`docs/SECURITY_HEADERS.md` next step). |
| IR-08 | Low | SSRF (A10) | DNS-rebinding window in `safe-fetch` (check-then-connect). Private/reserved ranges, resolved IPs, ports and every redirect hop are validated; website analysis, Find Leads website reads, onboarding and outgoing webhooks all use it. Provider API fetches use fixed hosts; Twilio pagination is pinned to `content.twilio.com`. | **Accepted** for launch (documented in the module). Pin the resolved IP in a custom agent later. |
| IR-09 | Low | Logging (A09) / privacy | Privacy Policy states audit and security logs are kept 12 months, but no job purges `audit_log`; data-rights erasure deliberately retains it. | **Fixed in code 2026-09-29.** Daily `audit.retention` job deletes `audit_log` rows past 12 months (per-workspace choice of 6 months, or longer within the plan cap: Pro 24, Enterprise 84), in batches of 1,000 with a 50,000-row daily budget through `audit_log_purge_batch` (0180, refuses anything under 28 days). Platform rows keep 12 months. Stated period in the Privacy Policy unchanged. Active once 0180 is applied (skips until then). |
| IR-10 | Low | Cryptographic storage (A02) | OAuth access/refresh tokens in `integration_secrets` are not application-encrypted (table has RLS with no policies, so only the service role reads it). Mailbox passwords and outgoing-webhook secrets are AES-256-GCM sealed; API keys are SHA-256 hashed. | **Accepted**; consider sealing OAuth tokens with `secret-box` in a later migration. DPA wording is accurate. |
| IR-11 | Low | Security misconfiguration (A05) | Full CSP is report-only (`script-src 'unsafe-inline'`). | **Accepted** (documented plan in `SECURITY_HEADERS.md`). |
| IR-12 | Low | Admin search (A03) | `lib/admin/search.ts` interpolates the query into a PostgREST `or=` filter; it strips everything except letters, digits and `@.-_ `, so no filter syntax survives. Platform-admin only. | **Accepted.** |
| IR-13 | Info | Vulnerable components (A06) | No CI pipeline or automated dependency scanning in the repository; last `npm audit --omit=dev` found 0 vulnerabilities. | **Fixed 2026-09-29.** `.github/workflows/ci.yml` runs typecheck, lint, the three unit-test groups and `npm audit --omit=dev --audit-level=high` on pull requests and pushes to main (no secrets; tests use fakes). `.github/dependabot.yml`: weekly npm and GitHub Actions updates. Owner: push, then switch on Dependabot alerts and security updates in the GitHub repository settings and make CI a required check on main. |
| IR-14 | Info | Broken access control (A01) — new | Per-person permissions introduced (0172). Checked server-side in the service runtime (`message.send`, `campaign.launch`, `quote.send`, `invoice.issue`, `voice.request_call`, connector/CRM/WhatsApp/pipeline ops, `billing.end_trial_now`) and in the Server Actions and routes that send, connect integrations or touch billing. Default mapping reproduces the previous role checks exactly (asserted in `tests/enterprise-permissions.test.ts`). | **Fixed / new control.** Apply 0172 before relying on overrides; until then everyone has role defaults. |

## Areas checked with no new issue

| Area | Result |
|---|---|
| RLS coverage | Static scan of all migrations: **290 tables created, every one has RLS enabled** (direct `alter table … enable row level security` or the dynamic loops in 0010/0036/0048/0071/0121–0123/0134/0150). TRUNCATE revoked schema-wide (0086); authenticated write grants tidied (0168). Live proofs: `supabase/tests/0150-0154-rls-proof.sql`, `0143-0167-rls-proof.sql`. 0172 adds no table. |
| Webhook signatures | Every route under `src/app/api/webhooks/**`, plus `/api/apps/[id]/events` and `/api/voice/tools/[tool]`, verifies an HMAC/signature/shared key (Stripe `constructEvent`; Twilio, Meta, Slack, Retell, Calendly, LinkedIn, order-paid/customer-Stripe HMACs; Google Ads key compared in constant time; Meta deletion/deauthorise `signed_request`) before trusting the body, and dedupes via `webhook_events`. All rate limited except Stripe (signature-only, by design). |
| Admin step-up | Every admin Server Action file routes through the step-up guard (grep of all `"use server"` files under `src/lib/admin` and `src/app/admin`). Cookie is HMAC-signed, bound to the user id, 30-minute window, path `/admin`, httpOnly, secure in production. |
| Secrets exposure | Only `NEXT_PUBLIC_SUPABASE_URL`, `…_PUBLISHABLE_KEY`, `…_SITE_URL`, `…_SENTRY_*`, `…_APP_VERSION` (and the Stripe **publishable** test key in `.env.e2e`) are public. No `"use client"` file imports `supabase/admin`, `@/lib/env` or `serverEnv`. `.env*` are gitignored except `.env.example`. |
| Cron auth | Bearer header only in production, constant-time compare (`cron-auth.ts`). |
| Uploads | Type and size allow-lists per kind; SVG refused, legacy SVG keys served as attachment; keys namespaced by workspace with a random UUID; bucket private; 5-minute signed URLs; list operations restricted to one workspace prefix. |
| Rate limits | Credential buckets fail closed; exports, search, public quote, privacy, API, webhooks bounded. New `app:audit_export` (5/hour/user). |
| CSRF | Server Actions (framework origin check); state-changing cookie routes use `isSameOriginRequest` (new audit export included). |
| Injection | Supabase query builder throughout; user-typed search values go through `orIlike`/`ilikeContains` or are stripped of filter syntax. |

## New features reviewed

* **Audit log export** (`src/app/api/exports/audit/route.ts`): same-origin POST; owner/admin
  check on the live membership; Zod-validated range (≤ 366 days); per-user rate limit;
  written to the audit log before streaming; service-role read hard-scoped to the caller's
  `business_id`; keyset-paged 1,000 rows at a time, 250,000-row ceiling; CSV cells
  formula-escaped via `csvCell`; stream errors abort the download rather than truncating
  silently.
* **Permissions** (`member.set_permissions`): UI caller only, admin minimum, same guardrails as
  role changes, billing delegable only by the owner and only to admins, compare-and-set on the
  role, overrides cleared by trigger on any role change, audited with before/after.

## Follow-ups (owner)

1. Commission the external test (`PENTEST_SCOPE.md`).
2. ~~Admin MFA + dedicated `ADMIN_STEP_UP_SECRET` (IR-06).~~ Built 2026-09-29: apply 0180, enrol two authenticators per admin, deploy (`docs/security/MFA_AND_SESSIONS.md`).
3. ~~Audit-log retention decision (IR-09).~~ Built 2026-09-29 to the stated 12 months; active once 0180 is applied.
4. Enable PITR and run the first restore drill (`docs/RESTORE.md`).
5. ~~CI with dependency scanning (IR-13).~~ Added 2026-09-29; enable Dependabot alerts and require the CI check on main.
