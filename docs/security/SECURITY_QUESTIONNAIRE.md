# Security questionnaire (SIG-lite / CAIQ-lite style)

Standard answers for customer security reviews. **Every "Yes" is verifiable in the code or
config at the path given; "Not yet" means exactly that.** Update this file when the answer
changes, and never answer a buyer's questionnaire with anything stronger than what is here.

Last reviewed: 28 September 2026. Companion documents: `docs/security/DATA_FLOW.md`,
`docs/security/UPTIME.md`, `docs/security/INTERNAL_REVIEW_2026-09-28.md`,
`docs/security/PENTEST_SCOPE.md`, `/dpa`, `/sub-processors`.

## A. Company and governance

| # | Question | Answer |
|---|---|---|
| A1 | Legal entity | Blackwellen Limited (trading as ClientTurn), England and Wales, company no. 16482166, 61 Bridge Street, Kington, Herefordshire, HR5 3DJ (`src/lib/marketing/company.ts`). |
| A2 | ICO registration | ZC160806 (Blackwellen Ltd, registered 29 May 2026, renew by 28 May 2027) |
| A3 | Named security / data protection contact | legal@clientturn.com (formal), support@clientturn.com (operational). No appointed DPO (not required at current scale). |
| A4 | Certifications (SOC 2, ISO 27001, Cyber Essentials) | **None.** Not yet. Stated publicly (`src/lib/marketing/security.ts`). |
| A5 | Written information security policy | Partially: engineering rules in `CLAUDE.md` and `docs/` (security headers, restore, observability, billing, developer platform). No single ISMS policy document yet. |
| A6 | Independent penetration test | **Not yet.** Scope prepared (`PENTEST_SCOPE.md`); to be commissioned by the owner. Internal OWASP review done 2026-09-28. |
| A7 | Cyber insurance | [Owner to confirm] |

## B. People

| # | Question | Answer |
|---|---|---|
| B1 | Number of people with production access | [Owner to confirm — currently the founder] |
| B2 | Background checks / security training | Not yet formalised. |
| B3 | Confidentiality obligations | Yes, for anyone authorised to process customer data (DPA §5). |

## C. Access control

| # | Question | Answer |
|---|---|---|
| C1 | Tenant isolation | Yes. Every tenant table has `business_id` and Postgres row-level security; static check of all 290 tables created by migrations finds RLS enabled on every one; live RLS proofs in `supabase/tests/`. |
| C2 | Role-based access in the product | Yes. Owner, admin, member, viewer (read-only), plus per-person allow/deny for outbound sending, integrations and billing (`src/lib/auth/capabilities.ts`, migration 0172). Enforced server-side in the service runtime and Server Actions. |
| C3 | Customer SSO (SAML/OIDC) | **Not yet.** Google sign-in is available. |
| C4 | Customer MFA | **Not yet** for workspace sign-in. |
| C5 | Platform admin access | Separate `/admin/login`, `platform_role` read from the database on every request, password step-up required within 30 minutes before any admin change (`src/lib/admin/step-up.ts`); every admin action file routes through the guard. **Admin MFA: not yet** (step-up is password-based). |
| C6 | API access | Workspace API keys, scoped, revocable, hashed at rest, per-key rate limit (`docs/DEVELOPER_PLATFORM.md`). |
| C7 | Brute-force protection | Yes. Postgres-backed rate limits; sign-in, sign-up, reset and admin buckets fail closed (`src/lib/security/rate-limit.ts`). |
| C8 | Access reviews | Not yet formalised. |

## D. Data protection and encryption

| # | Question | Answer |
|---|---|---|
| D1 | Encryption in transit | Yes. TLS everywhere; HSTS with preload (`next.config.ts`, `docs/SECURITY_HEADERS.md`). |
| D2 | Encryption at rest | Yes, provided by Supabase (Postgres) and Cloudflare R2. Customer mailbox passwords additionally AES-256-GCM encrypted in the application (`src/lib/security/secret-box.ts`). OAuth tokens are stored in a service-role-only table, not application-encrypted. |
| D3 | Data residency | Primary database London (eu-west-2); R2 EU jurisdiction; Azure OpenAI EU. Vercel compute is US; some providers are US (see `/sub-processors`). |
| D4 | Secrets management | Server-only env vars on Vercel; no secret in `NEXT_PUBLIC_*` (only Supabase URL/publishable key, site URL, Sentry DSN/config); no client component imports the service-role client (checked 2026-09-28). |
| D5 | Customer data used to train AI | No. AI is optional, off by default, Azure OpenAI EU, assist-only (`docs/AGENT_RUNTIME.md`). |
| D6 | Data retention and deletion | Yes. Retention table in Privacy Policy §10; retention jobs; data-rights tools; 90-day post-cancellation deletion (`0170`). |
| D7 | Data export for customers | Yes: leads, prospects, attribution, analytics exports; **audit log export (CSV/JSON)** for owners/admins in Settings → Data Controls. |
| D8 | Data brokers / paid enrichment | None. Apollo, Hunter and Clearbit are disabled; enrichment is first-party (company websites, Companies House). |

## E. Application security

| # | Question | Answer |
|---|---|---|
| E1 | Input validation | Yes. Zod on forms, route params, webhook payloads and CSV rows. |
| E2 | Webhook authenticity | Yes. Signature/secret verification on every inbound webhook, de-duplicated via `webhook_events` unique key. |
| E3 | CSRF | Server Actions (Next.js origin check); cookie-authenticated route handlers that change state use `isSameOriginRequest`. |
| E4 | SSRF | Customer-supplied URLs fetched only through `safe-fetch` (private/reserved ranges blocked, DNS checked, redirects re-validated). DNS-rebinding race documented as open. |
| E5 | File uploads | Type and size allow-lists; SVG refused; private bucket; 5-minute signed URLs; declared size now signed into the upload URL. |
| E6 | Security headers | HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, CSP `frame-ancestors/object-src/base-uri` enforced; full CSP in report-only. |
| E7 | Dependency vulnerabilities | `npm audit --omit=dev`: 0 known vulnerabilities (2026-09-28). **No automated dependency scanning or CI pipeline in the repository yet.** |
| E8 | Code review / change control | Changes are tested locally (`npm test`, `tsc`, lint, build) before deploy. No enforced second-person review. |
| E9 | Environments | Stripe test keys for all ClientTurn work; separate Supabase e2e database for integration tests. |

## F. Logging and monitoring

| # | Question | Answer |
|---|---|---|
| F1 | Audit logging | Yes. Append-only `audit_log` (browser role cannot write or delete), actor, action, entity and before/after for service operations; refused actions are logged too. Stated retention is 12 months (Privacy Policy §10); **an automated purge is not yet implemented** (review finding IR-09). |
| F2 | Application logs | Structured JSON logs with PII redaction (`docs/OBSERVABILITY.md`); Vercel log retention per plan. |
| F3 | Error tracking | Sentry, off unless `SENTRY_DSN` is set; events scrubbed. |
| F4 | Alerting | Yes. Ops alerts for dead jobs, webhook failures, cron misses, provider probes (`src/lib/ops/alerts.ts`). |

## G. Resilience

| # | Question | Answer |
|---|---|---|
| G1 | Backups | Daily physical backups (Supabase), verified completing 2026-09-28. **PITR not enabled** (RPO up to 24 h). |
| G2 | Restore tested | **Not yet.** Runbook and quarterly drill defined in `docs/RESTORE.md`; first drill not yet run. |
| G3 | Availability target | 99.5% monthly target, not a contractual SLA (`UPTIME.md`). |
| G4 | Status page | Yes, `status.clientturn.com`. |
| G5 | Incident response plan | Yes, documented in `UPTIME.md`; breach notification to customers within 24 hours (DPA §10). |

## H. Vendors

| # | Question | Answer |
|---|---|---|
| H1 | Sub-processor list | Yes, public at `/sub-processors`, with change log and 30 days' notice. |
| H2 | DPA | Yes, public at `/dpa`, UK GDPR Art. 28, annexes for processing details, TOMs and sub-processors. |
| H3 | International transfers | UK adequacy or IDTA / UK Addendum to the SCCs; Retell AI: United States (AWS US regions), UK IDTA or SCCs with the UK Addendum under Retell's DPA. |
