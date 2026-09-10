# The Meta app: what it can do today, and what it needs

Tested live against Meta's Graph API on 2026-09-08 with the credentials in
`.env`. Every line below is a probe result, not a reading of the documentation.

**App:** Client Turn · `1079035381375736` · contact `jamahlthomas1996@gmail.com`

---

## 0a. The connection works end to end — 2026-09-10

The OAuth round trip has now been completed through the product itself, on
production, not with a Graph API Explorer token:

```
Settings → Connections → Meta Lead Ads
  Connected · Business account: Propvora · last successful sync: just now
```

Two defects had to be fixed to get there, and both were invisible from the
dashboard:

* **`connectPath` was null.** The card read "Not yet available — Client Turn
  does not yet hold the provider credentials this connection needs", while
  `META_APP_ID` and `META_APP_SECRET` had been set in production for days. The
  null was a deliberate hold from when the adapter landed; it outlived its
  reason.
* **Every Connect button on the generic OAuth flow was a 404.** Provider
  adapters register themselves on import, and only `lib/jobs/register.ts`
  imported them. The connect and callback routes import
  `providers/registry` directly, so on an HTTP request the map was empty and
  the route answered `{"error":"Unknown provider."}`. This was never
  Meta-specific — `google_ads`, `tiktok_ads` and the rest were dead the same
  way. `providers/all.ts` now owns the list and both routes import it.

Worth recording because of how it presented: the button rendered, the
catalogue looked healthy, and the failure only appeared to somebody who
clicked it.

One thing to know about the domain. The app answers on both `clientturn.com`
and `www.clientturn.com`, and they are **separate origins** — a session
established on one does not travel to the other. `NEXT_PUBLIC_SITE_URL` is the
apex, so the OAuth `redirect_uri` is the apex, and connecting while signed in
on `www` returns to a login page with the token stranded. Sign in on the apex
to connect. Making one of the two canonical would remove the trap.

---

## 0. Configured and live — 2026-09-08

The two hard blockers in §2 are **cleared**. Verified against the Graph API, not
the dashboard:

```
GET /{app-id}/subscriptions
  page                       active   messages, messaging_postbacks, feed, leadgen
  instagram                  active   messages, comments
  whatsapp_business_account  active   messages
      all → https://clientturn.com/api/webhooks/meta
```

Meta called the endpoint, received the challenge back and registered it, so the
handshake is proven end to end rather than merely configured.

Also set: app domain `clientturn.com`, privacy and terms URLs, OAuth redirect
`https://clientturn.com/api/integrations/meta/callback`, deauthorize callback,
and data deletion callback. `META_WEBHOOK_VERIFY_TOKEN` is set in Vercel
production and the deployment carrying both callbacks is live.

**One defect found and fixed on the dashboard:** the data deletion callback read
`https://clienturn.com/...` — missing a `t`. Meta would have called a domain
that does not exist, and the failure would have surfaced only at App Review.

`pages_read_user_content` is **not** required, despite `/{page}/feed` refusing
without it. Reading comments back needs that permission; a comment *delivered*
to a subscribed webhook needs no read permission at all, because Meta hands it
over rather than us fetching it. The `feed` subscription above is the Facebook
discovery path, and it is also faster — the seven-day private-reply window runs
from the comment's own timestamp, so polling latency came straight off the only
clock in the product that expires silently.

WhatsApp has a second, direct transport alongside Twilio, and it is **switched
off**. `usesWhatsAppCloudApi()` returns false for every workspace and the
provider stays hidden without `META_WHATSAPP_CONFIG_ID`, so every WhatsApp send
routes to Twilio. The Cloud API path is built and covered by tests against
Meta's free test number (`+1 555-675-3230`, `NOT_VERIFIED`, five verified
recipients); it is kept because the choice is per workspace and reversible.

**All twelve permissions now pass a live test call.** The last one to clear —
`instagram_manage_messages` — was a defect in our own code rather than a
configuration gap: `sendSocial` addressed Instagram sends to the Instagram user
id, and this app uses the Messenger Platform route ("Instagram API with Facebook
login") where the **Page** is the sender. Verified live:
`/{page-id}/conversations?platform=instagram` returns data;
`/{ig-user-id}/conversations` returns `(#3) Application does not have the
capability`. Both `sendSocial` and `sendPrivateReply` now use the Page id.

**Business verification is done** — Jay Thomas, ID `511188236326853`, Verified.
*Access verification* (Tech Provider) is not, and is only needed for the direct
WhatsApp route, which has been dropped.

**WhatsApp goes through Twilio** (decided 2026-09-08), so the two WhatsApp
permissions are not being submitted and Tech Provider onboarding is not needed.
The Cloud API transport stays in the codebase, dormant and tested, in case that
changes.

What remains is App Review itself: the ten Meta permissions, their screencasts,
and Twilio needing credit and a sender before any message can actually go out.

---

## 1. The verdict

**The credentials are real and valid.** The app node, its roles and its webhook
subscriptions all return `200` with an app access token.

**The code is finished and correct.** The webhook verifier was exercised with a
genuine HMAC computed from the real `META_APP_SECRET`: it accepted a valid
signature, rejected a forged one, and rejected a tampered body. Inbound parsing
produced the right channel and address.

**The app is not configured to do anything yet.** It is in Development mode,
has never been through App Review, and has no webhook subscribed. Every flow
degrades correctly and does nothing.

You do **not** need a new app. You need to configure and submit this one.

---

## 2. What the probes found

| Probe | Result | What it means |
|---|---|---|
| App access token | `200 OK` | Credentials valid |
| `privacy_policy_url` | **absent** | Meta will not let an app go Live without one |
| `app_domains` | **absent** | OAuth and JS SDK origins unrestricted |
| `/{app}/subscriptions` | **empty** | **No webhook subscribed. Nothing inbound can ever arrive.** |
| `/{app}/roles` | 1 administrator | No developers, no testers |
| `/{app}/accounts/test-users` | **empty** | Nothing to test against without a real Page |
| Read a public Page | refused — needs `pages_read_engagement` or *Page Public Content Access* | No approved permissions or features |
| OAuth dialog, all 8 scopes | accepted, redirects to login | Every scope name we request is valid |
| Redirect URI exchange | reached the code check | `http://localhost:3000/...` is accepted |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | **Meta cannot deliver webhooks to localhost** |

The two in bold are the hard blockers. Everything else is paperwork.

---

## 3. What we can do — once configured

All of this is built, tested, and needs only the app configured.

### Facebook and Instagram

| Capability | Permission | Status |
|---|---|---|
| Read who messaged your Page / IG account | `pages_messaging`, `instagram_manage_messages` | Built |
| Read comments and mentions on your own content | `pages_read_engagement`, `instagram_basic` | Built |
| **Send one private reply to a commenter, within 7 days** | `pages_messaging`, `instagram_manage_messages` | Built |
| Reply freely for 24h after they message you | same | Built |
| Human reply for 7 days (human-agent tag) | same | Built |
| Receive lead-form submissions in seconds | `leads_retrieval`, `pages_manage_metadata` | Built |
| Subscribe the Page to our webhook | `pages_manage_metadata` | Built |

The private reply is the entry point the whole strategy depends on: it is the
only way to open a conversation with somebody who has not messaged you first.

---

## 4. What we cannot do — ever

These are not gaps in the build. There is no API, and the alternatives are
prohibited.

**Follow a person from a Page.** No endpoint exists on Facebook or Instagram.
The only way is to drive a logged-in session, which breaches the Platform Terms.

**Message a stranger.** Someone who has neither messaged you nor commented on
your content is unreachable. No permission, no App Review outcome and no
partnership changes this.

**Read a member's LinkedIn inbox.** No API exists. LinkedIn stays assisted.

**Read TikTok direct messages.** No public API. TikTok stays assisted.

**Send a WhatsApp message to somebody who never contacted you**, without an
approved template and evidenced opt-in. Same shape as Messenger's window —
see §5b.

**Get an email or phone from Meta for an engager.** Meta returns a page-scoped
id and a display name. Nothing else, on any surface, at any access level.

---

## 5. Strictly forbidden — the things that get an app or account banned

| Forbidden | Why it matters here |
|---|---|
| Automating a personal account by driving a logged-in session | Breaches Platform Terms. Gets the *customer's* account restricted, not just ours |
| More than one private reply per comment | Meta refuses the second. Repeated refused sends put the Page's messaging permission under review |
| Sending outside the 24-hour window without a valid tag | Same |
| Using the `HUMAN_AGENT` tag for an automated message | Misrepresents the message to Meta. We use it only for a person typing in the inbox |
| Declaring `messaging_type: RESPONSE` with no prior inbound | Asserts a message that does not exist. Our private replies omit it and use the comment recipient instead |
| Failing to disclose the bot | Meta requires disclosure. Enforced in `agent/validate.ts` |
| Taking longer than 30 seconds to respond | Meta's stated expectation. Why inbound is a webhook and the turn runs off the request path |
| Storing LinkedIn profile images | LinkedIn's User Agreement forbids it. `avatarPolicyFor` refuses the source |
| Message tags `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE` | Return error 100 since April 2026. We use none of them |

---

## 5a. The use cases on the app — and why you should not remake it

The dashboard lists eight use cases, all showing *Testing not started*. An
earlier draft of this document said to remove the unused ones and implied they
were a blocker. **That was overstated.** The distinction that actually matters:

* **Use cases on the dashboard** are a menu of what is configured. An untested
  one sits there saying *Testing not started* and does nothing.
* **App Review is submitted per permission.** You choose which permissions to
  submit, and each needs its own written description and its own screencast.

Meta's stated rejection reason is *"requesting unnecessary permissions"* — which
is about **what you submit**, not what is configured. A permission you never
submit is never reviewed and never counted against you. So an unused use case
sitting on the dashboard costs nothing but visual noise.

### Do not remake the app

There is no benefit and there is a real cost:

* A new app means a **new App ID and secret**, and `.env` plus every deployment
  environment has to be updated.
* **PSIDs and IGSIDs are app-scoped.** Every platform id in `prospects` and
  `conversations` is meaningless to a different app. Nothing is stored yet, so
  the cost is zero *today* — which is exactly why remaking later gets expensive
  and remaking now buys nothing.
* Any test calls already recorded are lost, and each is valid for 30 days.

The app is clean: one administrator, no subscriptions, nothing connected. There
is nothing to escape from.

### If you do want to tidy them up

Meta does not document use-case removal and has moved the control more than
once. As of now it is worth looking in:

* **Use cases** in the left nav → open the use case → a *Remove* or *Customise*
  control on the use case's own page rather than the list.
* **App settings → Advanced**, which is where several older toggles ended up.

If you cannot find it, leave them. It genuinely does not matter — submit only
the permissions below and ignore the rest of the panel.

### What to submit

| Permission | Why | Screencast to record |
|---|---|---|
| `pages_show_list` | Choosing which Page to connect | The connect flow picking a Page |
| `pages_read_engagement` | Reading comments we may privately reply to | A comment appearing as a prospect |
| `pages_manage_metadata` | Subscribing the Page to our webhook | Connecting a Page |
| `pages_messaging` | Messenger DMs and private replies | A DM arriving and being answered |
| `instagram_basic` | Resolving the linked Instagram account | The same connect flow |
| `instagram_manage_messages` | Instagram DMs and private replies | An IG DM arriving and being answered |
| `leads_retrieval` | Lead form submissions | A lead form submission arriving |
| `business_management` | Resolving the Business the Page belongs to | The connect flow |

Do **not** submit `ads_management`, `ads_read`, `pages_manage_ads`,
`catalog_management` or `ads_mcp_management`. Nothing in the code calls them,
there is no screencast that could demonstrate them, and a permission with no
screencast is refused.

### Two things worth checking on the dashboard

**`instagram_manage_messages` may not be attached to anything.** The *Manage
messaging & content on Instagram* use case shows `instagram_basic`,
`catalog_management`, `ads_read` and `ads_management` — no messaging permission.
`instagram_basic` resolves the account; it does not permit reading or sending
DMs. Without it the Instagram half cannot work, whatever else is approved. If no
use case carries it, add one that does.

**The Marketing API Access Tier wants 500 calls at 85% success**, and it appears
on *Capture & manage ad leads* — the one lead-form use case we do need. That is
a rate-limit tier rather than a permission, and Development tier still functions
at lower limits, so it does not block getting started. It will accrue naturally
once the lead poller is running against a real Page.

---

## 5b. WhatsApp: Twilio today, Meta direct as an option

WhatsApp runs through **Twilio**, which is an official Meta Business Solution
Provider. The messages are genuine WhatsApp Business messages; Twilio holds the
platform relationship and we hold an account with them. **No Meta App Review is
required for WhatsApp on this route** — which is why the WhatsApp use case shows
nothing tested and is not blocking anything.

Going direct to Meta's WhatsApp Cloud API is a real option and worth weighing:

| | Twilio (today) | Meta Cloud API (direct) |
|---|---|---|
| Meta App Review | None | `whatsapp_business_messaging`, `whatsapp_business_management` |
| Business Verification | Not needed | Required |
| Cost | Meta's per-conversation price **plus Twilio's markup** | Meta's price only, and 1,000 free service conversations a month |
| Build | Done | A second transport in `lib/messaging`, roughly the shape of `meta.ts` |
| Number | Twilio provisions it | You register your own, and it cannot be on WhatsApp already |

Whichever route, the **rules on messaging individuals are Meta's either way**,
and they are the same shape as Messenger's:

* A person messages you → you may reply freely for **24 hours** (the service
  window).
* Outside that window a business-initiated message must use a **pre-approved
  template**. Free text is refused.
* Templates are submitted to Meta and approved per template. Marketing templates
  are rated and can be paused if people mark them as spam.
* There is **no way to message a number that never contacted you** without an
  approved template and an opt-in you can evidence.

So WhatsApp is not a cold channel any more than Messenger is. It is excellent
for continuing a conversation somebody started — which is exactly what the
agent does with it today.

Run `node scripts/meta-usecase-tests.mjs --token "<token>" --whatsapp` only once
the direct route is chosen; until then those two permissions are correctly
untested.

---

## 6. What to do, in order

### Ticking the "0 of 1 API call(s) required" counters

Meta will not accept a review submission until it has seen a real successful
call against each permission. `scripts/meta-usecase-tests.mjs` makes exactly
those calls and nothing else:

```
node scripts/meta-usecase-tests.mjs --dry-run                  # show the plan
node scripts/meta-usecase-tests.mjs --token "<user token>"     # make the calls
node scripts/meta-usecase-tests.mjs --token "<token>" --subscribe
```

Generate the token in Graph API Explorer against the Client Turn app with the
permissions the script prints. Every call is a **read** except `--subscribe`,
which is the one write and is opt-in — it subscribes your Page to this app's
webhook, which is the step currently missing. Nothing sends a message to a real
person; ticking a review checkbox by messaging somebody would be a worse problem
than an unsubmitted app.

Results take up to 24 hours to appear and each test is valid for 30 days.

### Before anything works at all

1. **Give the app a public HTTPS URL.** Set `NEXT_PUBLIC_SITE_URL` to the
   deployed domain. Meta cannot deliver a webhook to `localhost`.
2. **Set `META_WEBHOOK_VERIFY_TOKEN`** to any long random string, in the
   environment *and* in Meta's webhook configuration. Without it
   `/api/webhooks/meta` refuses to verify and nothing arrives.
3. **Subscribe the webhook.** In the App Dashboard, add a Webhooks product
   pointing at `https://<domain>/api/webhooks/meta`, and subscribe:
   - Page: `messages`, `messaging_postbacks`, `feed`, `leadgen`
   - Instagram: `messages`, `comments`
   The subscription list is currently **empty**, which is why nothing inbound
   can arrive today.
4. **Add a privacy policy URL** in Basic Settings. The app cannot be switched to
   Live without one.
5. **Add the app domain** and the OAuth redirect
   `https://<domain>/api/integrations/meta/callback` to Valid OAuth Redirect
   URIs.

### To serve customers other than yourself

6. **Business Verification.** Required before Advanced Access on the messaging
   permissions.
7. **App Review** for: `pages_show_list`, `pages_read_engagement`,
   `leads_retrieval`, `pages_manage_metadata`, `pages_messaging`,
   `instagram_basic`, `instagram_manage_messages`, `business_management`.
   Each needs a screencast of the real flow and a written use case.
8. **Switch the app to Live.**

Until step 8, the app works **only** for people with a role on it — currently
one administrator. That is enough to test the whole product end to end against
your own Page and Instagram account, and it is the right way to record the App
Review screencasts.

---

## 7. How the product behaves today

Probed against the real code with the real credentials, on a workspace with no
Page connected:

```
1. Is a Meta Page connected?        no — nothing is connected
2. Can we read engagement?          {"ok":false,"error":"Find Leads is not on this workspace's plan."}
3. Anyone due a private reply?      0 candidates
4. Send one anyway?                 SKIPPED — "That prospect no longer exists in this workspace"
5. Direct transport call?           not_connected — "No Facebook Page is connected to this workspace."
```

Every path refuses with a sentence a customer can act on, and nothing throws.
The plan gate fires before the integration gate, which is the right order —
there is no reason to check a connection a workspace is not entitled to use.

One defect was found by this probe and fixed: a prospect that did not exist was
reported as *"their one reply had already been sent"*, which would have sent
somebody hunting for a message that was never composed. Zero rows updated has
two causes and now gets two different sentences.
