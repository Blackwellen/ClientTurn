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
exact slugs used below (`google_ads`, `microsoft_ads`, `tiktok_ads`,
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
| Google Ads | ❌ Not set | `GOOGLE_ADS_DEVELOPER_TOKEN` (the client id/secret fall back to the Google OAuth client, which is set) |
| Microsoft Advertising | ❌ Not set | credentials, **and note the caveat below — leads won't flow regardless** |
| TikTok | ✅ Configured | `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` are present and now recognised — the code previously looked for `TIKTOK_APP_ID`/`SECRET` |
| LinkedIn | ❌ Not set | credentials, **and a separate approval — see caveat below** |
| Slack | ❌ Not set | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` |
| HubSpot | ✅ Nothing to set | customer pastes their own token, no platform credential needed |
| Zoho CRM | ❌ Not set | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` |
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
   [developer.calendly.com](https://developer.calendly.com). Until then the
   Calendly card on Connections stays "Not yet available".

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
- Apply for a **Developer Token** separately at [ads.google.com/aw/apicenter](https://ads.google.com/aw/apicenter) — this is a distinct approval from the OAuth client and can take a few days on first request.
- Env: `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`.
- **Working as built** — polls Google's lead-form submission data on a 5-minute cursor.

### Microsoft Advertising
- Register an app in [Microsoft Entra admin center](https://entra.microsoft.com) and apply for a Microsoft Advertising developer token at [developers.ads.microsoft.com](https://developers.ads.microsoft.com).
- Redirect URI: `.../api/integrations/microsoft_ads/callback`.
- Env: `MICROSOFT_ADS_CLIENT_ID`, `MICROSOFT_ADS_CLIENT_SECRET`, `MICROSOFT_ADS_DEVELOPER_TOKEN`.
- ⚠️ **Caveat, not a setup step:** Microsoft does not publish any API for retrieving Lead Form extension submissions (confirmed against Customer Management, Campaign Management, Bulk and Reporting docs). The OAuth connection will work, but no leads will ever arrive through it — the integration surfaces this honestly as "action required" rather than pretending to work. Revisit if Microsoft ships this API in the future.

### TikTok Lead Generation
- Register an app at [business-api.tiktok.com](https://business-api.tiktok.com) (TikTok for Business Developer Portal).
- Redirect URI: `.../api/integrations/tiktok_ads/callback`.
- Env: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` — TikTok's own names for these, and what `.env` already holds. The older `TIKTOK_APP_ID` / `TIKTOK_APP_SECRET` spelling is still accepted.
- ⚠️ **Caveat:** the polling endpoint's exact path is unverified — TikTok's interactive docs are a client-rendered app our research pass couldn't scrape, so before trusting this in production, connect one real sandbox app and confirm a test lead round-trips.

### LinkedIn Lead Gen Forms
- Register an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps).
- Redirect URI: `.../api/integrations/linkedin_ads/callback`.
- Env: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.
- ⚠️ **Real gate, not just config:** reading actual lead submissions needs LinkedIn's **Lead Sync API**, a separate partner program from basic Marketing API access. Applying requires a verified business, a verified LinkedIn Company Page, and LinkedIn's review of the use case — expect days to weeks, not a same-day approval. The webhook and OAuth are fully built and will 403 on real lead data until this approval lands, regardless of credentials.

---

## Messaging

### Twilio (SMS + WhatsApp)
- ⚠️ **The SID is the wrong kind.** `TWILIO_SID` begins `SK`, which is an API Key SID. The REST path `/2010-04-01/Accounts/{AccountSid}.json` needs an Account SID beginning `AC`, so calls 404. Copy the Account SID from the [Twilio console home](https://console.twilio.com) into `TWILIO_ACCOUNT_SID`; the existing key/secret keep working as the Basic-auth pair.
- Then add a **sending number**: buy one at [twilio.com/console/phone-numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming) and set `TWILIO_SMS_FROM` (or `TWILIO_MESSAGING_SERVICE_SID` if using a Messaging Service).
- WhatsApp additionally needs `TWILIO_WHATSAPP_FROM` from Twilio's WhatsApp sender setup (requires Meta Business verification via Twilio's onboarding flow).
- Until `TWILIO_SMS_FROM` is set, messages send through the stub provider (marked `SENT`, never leaves the app) — this lets the whole pipeline be exercised without real credentials.

### Slack (notifications)
- Create an app at [api.slack.com/apps](https://api.slack.com/apps) → OAuth & Permissions → add the `chat:write` bot scope.
- Redirect URI: `.../api/integrations/slack/callback`.
- Env: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`.
- No Slack App Directory review needed — confirmed customers can install via direct OAuth the moment credentials are set.

---

## Booking

### Google Calendar
- Same Google Cloud OAuth client as Google Ads can be reused, or a separate one — either works, just add the Calendar API scope.
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — **already set and verified**: Google's token endpoint accepts this client pair. Google Ads reuses it as a fallback and needs only `GOOGLE_ADS_DEVELOPER_TOKEN` on top.

### Calendly
- Create an OAuth app at [developer.calendly.com](https://developer.calendly.com).
- Redirect URI: `.../api/integrations/calendly/callback`.
- Env: `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`. The existing `CALENDLY_API_KEY` is a personal token: it authenticates platform health checks (and is verified working) but cannot connect a customer's calendar, so this OAuth app is still required.

---

## CRM push

### HubSpot
- **Nothing for you to create.** Each customer generates their own Private App token inside their HubSpot account (Settings → Integrations → Private Apps → scopes `crm.objects.contacts.write` + `crm.objects.deals.write`) and pastes it into Client Turn. Validated against a live API call before it's saved.

### Zoho CRM
- Register a **Server-based Application** at [api-console.zoho.com](https://api-console.zoho.com).
- Redirect URI: `.../api/integrations/zoho_crm/callback`.
- Env: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`.
- Note: Zoho ties an OAuth client to one regional data center (.com/.eu/.in/.com.au/.jp) — register in the region your customers are actually in, since a client created in the wrong region cannot be redirected to another.

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
- **Salesforce, ZoomInfo** — no free tier; both require a paid plan/API add-on before any integration work is possible. Not built.
