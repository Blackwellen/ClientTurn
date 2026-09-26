# Integration Setup Requirements

What you need to create at each provider, and exactly which environment variable
name to put the result in. Nothing in the app code needs to change once these
are set — every integration reads `process.env` at request time and switches
itself from "Not yet available" to a working Connect button automatically.

**How to apply a value:** add it to `.env.local` (local dev) and to the
project's environment variables in Vercel (production), then restart the dev
server / redeploy. Local `.env*` files are ignored by Git. They contain sensitive
credentials, including another product's live Stripe keys; never commit them.
See [DEPLOYMENT.md](DEPLOYMENT.md) for the current deployment status.

**Universal OAuth redirect URI.** Every OAuth-based provider below uses the
same callback path, generated automatically — you only need to register this
exact URL in the provider's app settings:

```
{NEXT_PUBLIC_SITE_URL}/api/integrations/{provider_id}/callback
```

Locally that's e.g. `http://localhost:3000/api/integrations/google_ads/callback`.
In production, substitute your real domain. The `{provider_id}` values are the
exact slugs used below (`google_ads`, `tiktok_ads`,
`linkedin_ads`, `slack`, `zoho_crm`, `meta`, `google_calendar`, `calendly`).

---

## Quick status

Checked against the current `.env` / `.env.local` on **2026-09-06**, and — for
every row marked *verified* — by an authenticated call to the provider's live
API, not just by the presence of a variable.

| Provider | Status | What's missing |
|---|---|---|
| Supabase | ✅ Configured | — |
| Stripe (test) | ✅ Configured — **verified** | `STRIPE_WEBHOOK_SECRET_CLIENTTURN` is now present; the old mismatch is fixed |
| Resend | ✅ Configured | — |
| Azure OpenAI | ✅ Configured | — |
| Meta Lead Ads | ✅ Configured — **verified** | app credentials exchange successfully for a token |
| Google Calendar | ✅ Configured — **verified** | OAuth client accepted by Google's token endpoint |
| Calendly | ⚠️ Monitoring only | `CALENDLY_API_KEY` works and is used for platform health checks, but connecting a *customer's* calendar still needs `CALENDLY_CLIENT_ID`/`SECRET` — see note below |
| Twilio SMS/WhatsApp | ❌ Wrong SID shape | `TWILIO_SID` holds an API Key SID (`SK…`), not an Account SID (`AC…`) — see note below. WhatsApp additionally needs `TWILIO_WHATSAPP_FROM` |
| Google Ads | ✅ Configured (2026-09-13) | `GOOGLE_ADS_CLIENT_ID`/`SECRET` set; no developer token required post-sunset — see note below |
| TikTok | ✅ Configured | `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` are present and now recognised — the code previously looked for `TIKTOK_APP_ID`/`SECRET` |
| LinkedIn | ❌ Not set | credentials, **and a separate approval — see caveat below** |
| Slack | ✅ Configured — **verified** | App created 2026-09-11, all three credentials set locally and OAuth connect + `auth.test` probe confirmed working end to end. Redirect URLs and Interactivity's Request URL point at `clientturn.com`. All three env vars are also on Vercel's production environment |
| HubSpot | ✅ Nothing to set — **verified** | customer pastes their own token, no platform credential needed; the adapter itself was live-tested 2026-09-12 (found and fixed a wrong deal-association type id) |
| Zoho CRM | ✅ Configured — **verified** | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` set locally and on Vercel production 2026-09-13; live-tested end-to-end against a real Zoho API Console client and CRM trial org — see the Zoho CRM section below |
| Salesforce | ⚠️ Configured, not yet live-tested | `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` are on Vercel production; the adapter is built but no one has connected a real Salesforce org through it yet — see the Salesforce section below |
| Cloudflare R2 | ❌ Blocked | your token can't create buckets — see note below |

Platform admin monitors six of these directly at **System → Health**. With the
current environment that surface reports Meta, Google Calendar, Calendly and
Stripe as live-probed, and Twilio SMS / WhatsApp as not monitored, naming the
SID problem rather than showing a false outage.

---

## Fix this first

**Twilio is the only thing blocking messaging.** `.env` has `TWILIO_SID`
beginning `SK`, which is an **API Key SID**. Twilio's REST path is
`/2010-04-01/Accounts/{AccountSid}.json` and only accepts an **Account SID**
beginning `AC`, so every call 404s. An API key can authenticate, but it is not
an account identifier.

Fix: copy the Account SID (`AC…`) from the Twilio console home page into
`TWILIO_ACCOUNT_SID`. Keep the existing key/secret pair — Basic auth with
`SK…`:`secret` against the correct account path works. Then add a sender:
`TWILIO_SMS_FROM` for SMS, and `TWILIO_WHATSAPP_FROM` for WhatsApp.

Until that is set, SMS cannot send and both Twilio rows on System → Health read
"not monitored" with the reason shown.

---

## Also worth knowing

1. **Calendly has two credential shapes, and they do different jobs.**
   `CALENDLY_API_KEY` is a personal token for *your own* Calendly account. It
   is genuinely useful — platform health checks authenticate with it — but it
   cannot connect a customer's calendar. That needs an OAuth app
   (`CALENDLY_CLIENT_ID` / `CALENDLY_CLIENT_SECRET`) from
   [developer.calendly.com](https://developer.calendly.com); once set, the
   Calendly card on Connections becomes connectable and, on a successful
   connect, registers an organization-scoped webhook subscription
   automatically (`src/lib/integrations/providers/calendly.ts`). Without the
   OAuth app the card stays "Not yet available".

2. **`ADMIN_STEP_UP_SECRET` is unset and undocumented.** Platform-admin
   step-up (`src/lib/admin/step-up.ts`) signs its cookie with this, falling
   back to `SUPABASE_SERVICE_ROLE_KEY`. It works today, but rotating the
   service-role key would silently invalidate every operator's step-up window
   mid-session. Set a dedicated random value in production.

3. **Environment variable aliases.** Several providers accept more than one
   name, because the value already provisioned uses the provider's own
   spelling. `serverEnv` and the provider catalogue now agree on these:

   | Provider | Canonical | Also accepted |
   |---|---|---|
   | Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | `TWILIO_SID`, `TWILIO_CLIENT_SECRET` |
   | TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` |
   | Google Ads | `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

   In `catalog.ts` these are written `A|B`, meaning either name satisfies the
   check. Add to that list rather than renaming a variable someone has already
   provisioned.

---

## Lead sources

### Meta Lead Ads
- Create an app at [developers.facebook.com](https://developers.facebook.com/apps) → add the **Marketing API** and **Webhooks** products.
- Env: `META_APP_ID`, `META_APP_SECRET` — **already set and verified**: the app exchanges its credentials for a token successfully.
- No separate approval needed for read access to your own connected Pages; broader distribution to other businesses later would need Meta's App Review.

### Google Ads
- Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (type: Web application).
- Redirect URI: `.../api/integrations/google_ads/callback`.
- Env: `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`.
- **Developer tokens were sunset by Google on 2026-09-09** — `ads.google.com/aw/apicenter` now redirects to an unrelated "App Conversion Tracking and Remarketing API" application form for accounts on the new model. `GOOGLE_ADS_DEVELOPER_TOKEN` is no longer required by this codebase (confirmed against Google's current docs: the header is optional and ignored). Access is now decided by the **Google Cloud project** behind the OAuth credentials above — open the "Google Ads API Overview" page in Cloud Console for that project, enable the Google Ads API, and apply for the access level needed (Test is the default for a new project; Basic access is now automated after brand verification, replacing the old manual-review wait).
- **Working as built** — polls Google's lead-form submission data on a 5-minute cursor.

### Microsoft Advertising — removed (2026-09-13)
Microsoft Advertising has no published API for retrieving Lead Form extension
submissions (confirmed against Customer Management, Campaign Management, Bulk
and Reporting docs, and against Microsoft's own Q&A confirming Bing Ads has no
lead-form product at all). There is nothing to connect it *to* — OAuth would
succeed and then never deliver a lead — so the provider, its adapter and its
catalog entry were removed rather than left as a connect button that cannot
do its one job. Revisit only if Microsoft ships a lead-form-submission API.

### TikTok Lead Generation
- Register an app at [business-api.tiktok.com](https://business-api.tiktok.com) (TikTok for Business Developer Portal).
- Redirect URI: `.../api/integrations/tiktok_ads/callback`.
- Env: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` — TikTok's own names for these, and what `.env` already holds. The older `TIKTOK_APP_ID` / `TIKTOK_APP_SECRET` spelling is still accepted.
- ⚠️ **Caveat:** the polling endpoint's exact path is unverified — TikTok's interactive docs are a client-rendered app our research pass couldn't scrape, so before trusting this in production, connect one real sandbox app and confirm a test lead round-trips.

### LinkedIn Lead Gen Forms
- Register an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps).
- Redirect URI: `.../api/integrations/linkedin_ads/callback`.
- Env: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.
- Lead delivery is **poll-only**: ClientTurn does not register a `leadNotifications` subscription (it needs LinkedIn's Lead Sync approval to cover real-time push as well), so new form responses arrive on the next poll, within minutes.
- Company-page engagement (people who comment on the organisation's own posts) needs LinkedIn's **Community Management API** approval, a separate product. Leave `LINKEDIN_COMMUNITY_MANAGEMENT_APPROVED` unset until that approval exists: setting it adds `r_organization_social` to the connect scopes, and LinkedIn refuses the whole authorisation for an app that asks for a scope it was not granted. Engagement prospects carry the member URN only; no profile URL or email is ever made up.
- A member who administers several organisations chooses which one in Settings → Connections → LinkedIn Lead Gen Forms.
- ⚠️ **Real gate, not just config:** reading actual lead submissions needs LinkedIn's **Lead Sync API**, a separate partner program from basic Marketing API access. Applying requires a verified business, a verified LinkedIn Company Page, and LinkedIn's review of the use case — expect days to weeks, not a same-day approval. The webhook and OAuth are fully built and will 403 on real lead data until this approval lands, regardless of credentials.

---

## Messaging

### Twilio (SMS + WhatsApp)
- ⚠️ **The SID is the wrong kind.** `TWILIO_SID` begins `SK`, which is an API Key SID. The REST path `/2010-04-01/Accounts/{AccountSid}.json` needs an Account SID beginning `AC`, so calls 404. Copy the Account SID from the [Twilio console home](https://console.twilio.com) into `TWILIO_ACCOUNT_SID`; the existing key/secret keep working as the Basic-auth pair.
- Then add a **sending number**: buy one at [twilio.com/console/phone-numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming) and set `TWILIO_SMS_FROM` (or `TWILIO_MESSAGING_SERVICE_SID` if using a Messaging Service).
- WhatsApp additionally needs `TWILIO_WHATSAPP_FROM` from Twilio's WhatsApp sender setup (requires Meta Business verification via Twilio's onboarding flow).
- Until `TWILIO_SMS_FROM` is set, messages send through the stub provider (marked `SENT`, never leaves the app) — this lets the whole pipeline be exercised without real credentials.

### Slack (notifications + interactive alerts)

**This already exists — do not create a second one.** The real, permanent
platform app was created 2026-09-11: named **ClientTurn**, App ID
`A0C10AZ3MDL`, owned by a dedicated workspace (`clientturnapps.slack.com`)
created purely to hold it, no other members. `SLACK_CLIENT_ID`/`SECRET`/
`SIGNING_SECRET` are already in `.env` locally — **still need adding to
Vercel's project environment variables** for production to have them (Vercel
env vars are separate from a local `.env` file; setting one does not set the
other). A real OAuth connect and the `auth.test` health probe were both
driven end to end against this exact app and confirmed working, against a
local dev server.

**Redirect URLs** (OAuth & Permissions, supports several at once — all three
are registered): `http://localhost:3000/...`, `http://localhost:3001/...`
(local dev runs on whichever port is free) and
`https://clientturn.com/api/integrations/slack/callback` (production).

**Interactivity's Request URL is a single value, not a list** — unlike the
redirect URLs above, Slack only lets an app have one. It is currently set to
`https://clientturn.com/api/webhooks/slack/interactive` (production). This
means the Acknowledge/Resolve buttons work against production right now, but
**testing them from a local dev server means temporarily pointing this one
field at your local tunnel/URL and switching it back** — there is no way to
have both live at once. [api.slack.com/apps/A0C10AZ3MDL/interactive-messages](https://api.slack.com/apps/A0C10AZ3MDL/interactive-messages).

The rest of this section is the from-scratch process, kept for reference (a
lost credential, a second environment, or rebuilding after a deletion) rather
than something that needs doing again now.

**One app for the whole platform, not one per customer.** Every workspace that
connects Slack is installing the *same* ClientTurn app into their own Slack
workspace via OAuth — the same relationship every "Add to Slack" button on any
SaaS product has with the workspaces that install it. You create this app
**once**, under whichever Slack account/workspace ClientTurn itself should own
it from (a company Slack, or a dedicated Slack workspace created purely to
hold developer apps — either is fine; it does not need to be a workspace
anyone uses day to day, since apps are owned by whoever created them, not by
the workspace they happen to live in).

You do **not** need a Slack App Directory review. Customers install via a
direct OAuth link ClientTurn generates for them (`Connect` on Settings →
Connections → Slack) the moment the credentials below are set — there is no
approval queue, because the app is never submitted for public listing.

#### 1. Create the app from a manifest

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create an App** →
**From a manifest** → pick the Slack workspace that should own it → paste this
(swap the two `localhost:3000` occurrences for your real deployed domain once
you have one; keep both entries while you still need local dev to work too —
Slack allows multiple redirect URLs on one app, so you can list both at once):

```json
{
  "display_information": {
    "name": "ClientTurn"
  },
  "features": {
    "bot_user": {
      "display_name": "ClientTurn",
      "always_online": false
    }
  },
  "oauth_config": {
    "redirect_urls": [
      "http://localhost:3000/api/integrations/slack/callback",
      "https://YOUR-PRODUCTION-DOMAIN/api/integrations/slack/callback"
    ],
    "scopes": {
      "bot": ["chat:write"]
    }
  },
  "settings": {
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "is_hosted": false,
    "token_rotation_enabled": false
  }
}
```

Click **Next** → **Create**. Slack will immediately try to install it to the
workspace you picked — that first install is only for your own testing
convenience (it gives *that* workspace a working bot token) and has no effect
on customer installs, which each go through their own separate OAuth flow.

Only `chat:write` is requested. No `channels:read`, no `users:read`, nothing
that would let the bot see message history or membership lists it doesn't
need — the integration only ever posts.

#### 2. Turn on Interactivity

**OAuth & Permissions → Interactivity & Shortcuts** (left sidebar) → toggle
**On** → **Request URL**:

```
{NEXT_PUBLIC_SITE_URL}/api/webhooks/slack/interactive
```

This is what makes the **Acknowledge** / **Resolve** buttons on a handover
alert actually do something. Without it, the buttons still render in Slack
(they're just part of the message) but clicking one gets Slack's own generic
"this app isn't responding" error, because Slack has nowhere configured to
send the click. Same one-app-many-workspaces relationship as the OAuth
redirect above: one Request URL here serves every connected customer
workspace, because the click always carries which Slack team it came from,
and the handler resolves that back to the right ClientTurn business.

Save. Slack does not require verifying this URL with a challenge/response the
way some webhook setups do — it starts sending real interaction payloads to it
immediately.

#### 3. Copy the credentials into env

**Basic Information → App Credentials**:

| Field on the Slack page | Env var |
|---|---|
| Client ID | `SLACK_CLIENT_ID` |
| Client Secret (click **Show**) | `SLACK_CLIENT_SECRET` |
| Signing Secret (click **Show**) | `SLACK_SIGNING_SECRET` |

All three are required. The signing secret used to be declared but genuinely
unused (`postSlackMessage` never needed it — outbound-only, nothing to verify)
until the interactive buttons above needed something to check an inbound
click's authenticity against; if it's missing or wrong, every button click is
rejected with a 403 and nothing else about the integration is affected —
outbound alerts keep working normally.

Add all three to `.env.local` for local dev and to the project's environment
variables in Vercel (production) — see the file header above for the general
pattern. Restart the dev server / redeploy after setting them.

#### 4. What "done" looks like

- Settings → Connections → Slack shows a **Connect** button (not "Not yet
  available") the moment `SLACK_CLIENT_ID`/`SECRET` are present.
- Connecting asks Slack to authorize `chat:write` for the customer's chosen
  workspace, same OAuth round-trip as every other provider on this page.
- Settings → Messaging → **Slack alerts** lets the customer paste the channel
  ID for the channel they want alerts in (their own bot must be invited to
  that channel — `/invite @ClientTurn` in Slack — the same way any Slack bot
  needs inviting before it can post to a channel it wasn't added to).
- A handover alert in that channel carries **Acknowledge**/**Resolve**
  buttons once step 2 above is done; before that, the same alert still posts,
  just without the buttons doing anything when clicked.

#### Troubleshooting

- **"Slack is not configured on this platform"** dead-lettering a
  `notification.slack` job even though the env vars are visibly set: in local
  dev with Turbopack, this can mean a stale build cache is serving an old
  in-memory snapshot of `.env` from before the vars existed. Stop the dev
  server, delete `.next/`, restart. (This is a dev-only artifact of Turbopack's
  persistent cache — a real Vercel deploy always starts from a clean build, so
  it can't happen in production.)
- **`redirect_uri did not match`** from Slack during connect: the exact
  `NEXT_PUBLIC_SITE_URL` the running server is using has to be one of the
  URLs listed under OAuth & Permissions → Redirect URLs, byte-for-byte
  (scheme, host, port). Add the missing one rather than changing
  `NEXT_PUBLIC_SITE_URL` to match an old entry.
- **A Slack alert never arrives, no error anywhere:** almost always the bot
  was never invited to the channel the customer configured. `chat:write`
  lets the bot post to any channel it's a *member* of, not any channel that
  exists — Slack's own `not_in_channel` error surfaces as the job's
  `last_error` in Admin → Jobs.
- **A button click does nothing:** confirm step 2 (Interactivity's Request
  URL) is actually saved, and that `SLACK_SIGNING_SECRET` matches what's
  shown on the Basic Information page *right now* — regenerating it there
  (the **Regenerate** button) silently invalidates whatever's in `.env`
  until you copy the new value over.

---

## Booking

### Google Calendar
- Same Google Cloud OAuth client as Google Ads is reused (add a second Authorized redirect URI to it rather than creating a separate client).
- Redirect URI: `.../api/integrations/google_calendar/callback`.
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — **configured 2026-09-13**, read directly by `src/lib/integrations/providers/google-calendar.ts` and `src/lib/agent/availability/index.ts` (one shared definition, see that file's header comment). Google Ads uses its own `GOOGLE_ADS_CLIENT_ID`/`SECRET` names but falls back to these same values if unset.
- **Working as built** — reads free/busy via `freeBusy` and writes confirmed bookings via `events.insert` on the primary calendar. Not yet exercised against a live connected account in this environment; see the adapter file's header comment for the specific API-shape assumptions flagged as unverified.

### Calendly
- Create an OAuth app at [developer.calendly.com](https://developer.calendly.com).
- Redirect URI: `.../api/integrations/calendly/callback`.
- Env: `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`. The existing `CALENDLY_API_KEY` is a personal token: it authenticates platform health checks (and is verified working) but cannot connect a customer's calendar, so this OAuth app is still required.

---

## CRM push

### HubSpot
- **Nothing for you to create.** Each customer generates their own token inside their HubSpot account — HubSpot's UI has moved this from "Private Apps" (legacy, no longer receiving updates) to **Service Keys**; either issues the same `pat-xx-...` Bearer token format, just under a different menu path (Settings → Integrations → Service Keys, scopes `crm.objects.contacts.read` + `crm.objects.contacts.write` + `crm.objects.deals.read` + `crm.objects.deals.write`; add `crm.objects.owners.read` if the optional CRM pull should assign owners. The `.read` scopes are required: the push searches contacts by email before creating one, and the pull reads them). Pasted into Client Turn and validated against a live API call before it's saved.

### Zoho CRM
- Register a **Server-based Application** at [api-console.zoho.com](https://api-console.zoho.com).
- Redirect URI: `.../api/integrations/zoho_crm/callback`.
- Env: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` (the `.com`/US data center — always required).
- **To support customers outside the US** (this product's actual customers are UK/EU B2B companies, so this matters): enable **Multi DC** on that same API Console client — real DC list, confirmed live in the console: US (default), EU, **UK** (its own DC, distinct from EU), AU, IN, JP, CN, CA, SA, UAE and Singapore. The API Console client offers two ways to handle secrets across those DCs: a **"use the same OAuth credentials for all data centers"** toggle (one `ZOHO_CLIENT_SECRET` covers every enabled DC — the simplest option, and what this codebase falls back to by default), or per-DC secrets, copied into `ZOHO_CLIENT_SECRET_EU` / `_IN` / `_AU` / `_JP` / `_CN` / `_CA` (see `.env.example`) for a client that issues a distinct one per DC. Any DC without its own env var — including uk/ae/sg/sa, which have none — uses the base secret, which is correct for the shared-credential toggle and only wrong if that specific client also happens to issue distinct per-DC secrets without one configured here. See the header comment on `zoho-crm.ts` for the full mechanism (the authorize request always starts at `accounts.zoho.com`; Zoho appends `location`/`accounts-server` to the callback once it knows the user's real DC, and the token exchange is redirected there with the resolved secret).
- **Update scope required.** `SCOPE` must include `ZohoCRM.modules.leads.UPDATE` alongside `CREATE`/`READ`. Confirmed live (2026-09-12): without it, Zoho's `PUT` on an existing Lead returns 401 `OAUTH_SCOPE_MISMATCH`, which `push()` treats as "the Lead may have been deleted" and silently creates a duplicate — every re-sync of an already-pushed lead double-pushed. A connection made before this fix needs to be disconnected and reconnected to pick up the new scope.
- 2026-09-12: previously this adapter only worked for `.com`-DC orgs at all — fixed to genuinely support every DC Zoho offers, and to update leads in place instead of silently duplicating them.

---

## Storage & billing

### Cloudflare R2
- The current `R2_ACCESS_KEY_ID` token cannot create buckets. Either create the `clientturn` bucket manually in the Cloudflare dashboard, or issue a new token with R2 Admin permissions.
- Env (already named correctly, just needs a working token/bucket): `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

### Stripe
- Test-mode products/prices already exist. Remaining step: a **test-mode webhook endpoint** at `{NEXT_PUBLIC_SITE_URL}/api/webhooks/stripe` — needs a public HTTPS domain, so this can't be finished until the app is deployed somewhere reachable (or tunnelled via `stripe listen`/ngrok for local testing).
- ⚠️ `.env` currently holds Propvora's **live** Stripe keys alongside Client Turn's test keys. Never let a live-mode key reach Client Turn code — the app is wired to `STRIPE_SECRET_KEY_TEST` only, but be careful if editing `.env` by hand.

---

## Not needed right now

- **Azure OpenAI** — already configured; only used for the optional AI-assist layer, gated off by default per workspace.
- **Reddit, Pinterest** — neither platform has a native lead-generation form product; nothing to integrate against.
- **ZoomInfo** — no free tier; requires a paid plan/API add-on before any integration work is possible. Not built.

## Salesforce — configured, not yet live-tested

- **Salesforce** — the adapter is built (`src/lib/integrations/providers/salesforce.ts`): OAuth2 web server flow, Lead push/upsert by email, reactive token refresh on session expiry. Registered on the generic connect/callback routes exactly like Zoho CRM.
- `SALESFORCE_CLIENT_ID`/`SALESFORCE_CLIENT_SECRET` are set on Vercel's production environment (added 2026-09-12, alongside the `salesforce.ts` adapter). The Settings → Connections Connect button will render for any workspace once that deploy is live — `platformConfigured()` in `src/lib/integrations/queries.ts` checks `requiredEnv` against `process.env` before offering a connection at all, so the card genuinely reflects whether the credentials are present.
- **What's still missing is verification, not credentials.** Nobody has clicked Connect against a real Salesforce org yet — no live test has confirmed the OAuth exchange, `identify()`, or a Lead actually landing in a Salesforce org, the way Zoho CRM and HubSpot were both verified live on 2026-09-12/13. Do that before relying on it for a real customer.
- **Known limitation, by design, not yet solved:** the authorize/token endpoints are hardcoded to `login.salesforce.com`, which resolves Production and Developer Edition orgs but not Sandbox orgs (those live under `test.salesforce.com`). Same class of constraint Zoho CRM used to have for its regional data centers before that adapter was fixed (2026-09-12) to support all of them — see the Zoho CRM section above for the pattern this could follow if Sandbox support is ever needed.
- Per the project's own precedent with Meta (see the comment on the `meta` catalogue entry): the code being complete, and credentials existing, is not the same as the flow being live-tested. Connect one real Salesforce org and confirm a lead actually lands as a Salesforce Lead before calling this "native" in marketing copy — `lead-conversion-integrations.tsx` currently tags it `"assisted"` for exactly that reason.
