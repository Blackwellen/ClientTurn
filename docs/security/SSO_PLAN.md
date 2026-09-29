# SSO (SAML) plan

Status: **planned, not built** (2026-09-29, internal review IR-06). Public pages and help say
"planned", not "available on request": nothing can be switched on for a customer today without
the paid add-on and the code below.

## Why it is not built yet

ClientTurn authenticates with Supabase Auth. Supabase supports SAML 2.0 single sign-on, but only
on a paid plan (Pro or above) with SSO enabled for the project, billed per monthly active SSO
user. Building the login flow before that is enabled would ship a button that cannot work. MFA
(TOTP) was built instead, because it needs no add-on (`docs/security/MFA_AND_SESSIONS.md`).

## Owner steps (in order)

1. **Decide the trigger.** Build when a signed Enterprise customer needs it, and price it into
   the Enterprise contract (the add-on is a per-user cost).
2. **Check the Supabase plan** of project `losieaikadkadtmezini` (Dashboard -> Organization ->
   Billing). SAML needs Pro or above.
3. **Enable SAML 2.0**: Dashboard -> Authentication -> Sign In / Providers -> SAML 2.0 -> enable.
   Note the SP metadata URL and ACS URL Supabase shows; the customer's IT team needs them.
4. **Register the customer's identity provider** with the Supabase CLI (one per customer):

   ```sh
   supabase sso add --project-ref losieaikadkadtmezini --type saml \
     --metadata-url 'https://<customer idp>/metadata' \
     --domains customer.co.uk
   ```

   `supabase sso list` / `supabase sso update` / `supabase sso remove` manage it afterwards.
5. **Ask engineering to build the app side** (below), then test with the customer's IdP on the
   e2e project first.
6. Update `src/lib/marketing/security.ts` (`sso` control), the Enterprise page FAQ,
   `docs/security/SECURITY_QUESTIONNAIRE.md` C3 and the help article, and only then tell the
   customer it is available.

## Engineering work when triggered

- Login: an "Sign in with SSO" option on `/login` that takes a work email, derives the domain and
  calls `supabase.auth.signInWithSSO({ domain })`; the existing `/auth/callback` exchanges the code.
- Workspace link: a `workspace_sso_domains` table (business_id, domain, provider id, enforced
  flag; RLS, owner-managed, service-role writes) so an SSO user lands in the right workspace
  and invites for that domain can be auto-accepted.
- Enforcement: an owner setting "Require SSO" that refuses password sign-in for members whose
  email domain is enforced (checked in `signIn` and `requireWorkspace()`), with a break-glass
  owner account that keeps password + TOTP.
- MFA interplay: SSO sessions carry the IdP's assurance, not Supabase TOTP; `requireWorkspace()`
  must treat an SSO session as satisfying "require two-factor" only when the IdP enforces MFA
  (a contract term, recorded per domain).
- SCIM provisioning is a separate, later step; Supabase does not provide it.
- Audit: `security.sso_login`, `security.sso_domain_added/removed`.

Estimated effort once the add-on is on: 3 to 5 days including tests and help.
