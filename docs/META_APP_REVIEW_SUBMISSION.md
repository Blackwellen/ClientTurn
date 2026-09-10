# Meta App Review: the submission

Everything to paste into the App Review form, plus what to record. Each
permission needs **its own** description and **its own** screencast — Meta
rejects copy-paste, and a permission with no screencast is refused outright.

App: **Client Turn** · `1079035381375736`

---

## 1. Settings that must be filled in first

The form will not accept a submission without these, and two of them did not
exist until now.

| Field | Value |
|---|---|
| Privacy Policy URL | `https://<domain>/privacy` |
| Terms of Service URL | `https://<domain>/terms` |
| **Data Deletion Callback URL** | `https://<domain>/api/webhooks/meta/data-deletion` |
| **Deauthorize Callback URL** | `https://<domain>/api/webhooks/meta/deauthorize` |
| Webhook callback URL | `https://<domain>/api/webhooks/meta` |
| Valid OAuth Redirect URI | `https://<domain>/api/integrations/meta/callback` |
| App domain | `<domain>` |
| Category | Business |

Replace `<domain>` with the deployed host. **Not localhost** — Meta cannot
reach it, and it will fail the callback verification during review.

Both callbacks verify Meta's `signed_request` against the app secret and were
tested end to end against a real database: a forged signature is refused with
`400`, a genuine one for a different user changes nothing, and a genuine one
disconnects or deletes exactly what it should.

---

## 2. What the reviewer needs to be able to do

Meta tests the app themselves. Give them everything, or the submission bounces
back asking for it.

**Test credentials.** Create a workspace, set a password that does not expire,
and put the email and password in the "App Review Instructions" box. The account
must be able to reach Settings → Connections without any onboarding step that
requires a real payment.

**A connected Page.** The reviewer will not connect their own. Either connect a
Page to the test workspace beforehand and say so, or add the reviewer as a
tester on the app.

**Written steps.** Number them. "Log in → Settings → Connections → Connect
Facebook → choose Page → Find Leads → Social" is enough; a reviewer who has to
guess marks it untestable.

---

## 3. Per-permission descriptions

Paste each verbatim. They are deliberately different from each other — that is
the point.

### `pages_show_list`

> ClientTurn asks the person connecting their Facebook account which of their
> Pages they want to use. We call `/me/accounts` once, during setup, to show
> that list. Without it the person would have to find and type a numeric Page ID
> by hand, and we would have no way to confirm they actually administer the Page
> they named. We store only the ID and name of the Page they choose.

### `pages_read_engagement`

> ClientTurn shows a business the people who have commented on its own Page
> posts and ads, so it can answer them. We read `/{page-id}/feed` with the
> comments edge to collect the commenter's name, what they wrote, and the
> comment ID. The comment ID is what a later private reply is addressed to, so
> without this permission there is no way to reach somebody who commented. We
> read only the connected Page's own content.

### `pages_manage_ads`

> ClientTurn reads the lead forms attached to the connected Page, so the
> business can see which of its forms are feeding the product and so our poller
> can collect any submission that the webhook did not deliver. Reading
> `/{page-id}/leadgen_forms` returns "Requires pages_manage_ads permission" with
> `leads_retrieval` alone, which is why this is requested. We do not create,
> edit, pause or spend on any ad; the access is read-only and limited to the
> connected Page's own lead forms.

### `pages_manage_metadata`

> ClientTurn subscribes the connected Page to our webhook so that messages,
> comments and lead form submissions arrive in seconds rather than on a polling
> interval. We call `POST /{page-id}/subscribed_apps` once when the Page is
> connected, and `GET` the same edge to show the customer whether the connection
> is live. We do not change any other Page setting.

### `pages_messaging`

> ClientTurn is a shared inbox and assistant for small businesses. This
> permission does two things. It lets us receive and reply to Messenger
> conversations that a person started with the business, inside Meta's 24-hour
> window. It also lets us send a single private reply to somebody who commented
> on the business's own post, within seven days of that comment, which is the
> only way to begin a conversation with a commenter. We never message a person
> who has neither written to the business nor commented on its content. Replies
> disclose that they are automated when asked, and a human can take the
> conversation over at any point.

### `instagram_basic`

> ClientTurn resolves which Instagram professional account is linked to the
> connected Facebook Page, and reads that account's own media and the comments
> on it. The account ID is needed to send or receive any Instagram message, and
> the comments are how a business sees who has engaged with its posts. We read
> only the connected account's own content.

### `instagram_manage_messages`

> ClientTurn receives and replies to Instagram direct messages that a person
> started with the business, inside Meta's 24-hour window, and sends a single
> private reply to somebody who commented on the business's own post or
> mentioned it in a story, within seven days. This is the Instagram half of the
> shared inbox. We never message an account that has not engaged with the
> business first.

### `instagram_manage_comments`

> ClientTurn receives comments left on the connected Instagram professional
> account's own posts, so a business can see who engaged and reply once by
> private message. The comment arrives on the subscribed webhook rather than
> being fetched, and we read only comments on the connected account's own
> media. We do not delete or hide anybody's comment.

### `public_profile`

> Granted automatically. ClientTurn uses the connecting person's name only to
> label the connection in Settings → Connections, so a customer with several
> Meta connections can tell which account authorised which.

### `leads_retrieval`

> ClientTurn's core purpose is answering lead form submissions quickly, because
> a reply within minutes converts far better than one an hour later. When a
> person submits a lead form on the business's Facebook or Instagram ad, we read
> that submission from `/{leadgen-id}` and create a lead, then follow up on the
> channel the person supplied. We read only forms belonging to the connected
> Page, and only submissions made after the Page was connected.

### `business_management`

> ClientTurn reads `/me/businesses` during setup to identify which Business the
> connected Page belongs to, so that a customer managing several businesses sees
> the right one and so an agency's Pages are not mixed together. It is a
> read-only lookup at connection time. We do not create, modify or manage any
> Business asset.

### `whatsapp_business_management` — **not being submitted**

> ClientTurn reads which WhatsApp Business Account and which registered phone
> number belong to the connected Business, so the customer can choose the number
> their replies go out from and see it confirmed in the app. We read
> `/{business-id}/owned_whatsapp_business_accounts` and `/{waba-id}/phone_numbers`
> at connection time, and we read the status of the message templates the
> customer has had approved. We do not register numbers or create accounts on
> the customer's behalf.

### `whatsapp_business_messaging` — **not being submitted**

> ClientTurn is a shared inbox and assistant. This permission lets us receive
> WhatsApp messages that a person sent to the business, and reply to them inside
> WhatsApp's 24-hour customer service window. Outside that window we send only
> message templates the customer has had approved by Meta, to people who gave
> the business their number and agreed to be contacted on it — most often on a
> Facebook or Instagram lead form, where the consent wording is captured and
> stored with the record. We never message a number that has not contacted the
> business or opted in, and every message carries a way to stop.

**WhatsApp is staying on Twilio (decided 2026-09-08), so neither WhatsApp
permission is being submitted.** Twilio is an official Meta Business Solution
Provider: the messages are genuine WhatsApp Business messages and the platform
relationship is Twilio's, which is exactly why no Meta App Review is required
for them. The two descriptions are kept below because the Cloud API transport is
built and tested — if the direct route is ever taken, they are ready. See §7.

Submitting them now would cost a rejection on an otherwise clean submission:
Meta requires a screencast per permission, and there is nothing to film while
WhatsApp runs through Twilio.

`pages_read_user_content` is deliberately **not** requested. Comments arrive on
the subscribed `feed` webhook, which needs no read permission; the permission is
only required to fetch them back, which the product no longer does.

---

## 4. Screencast shot lists

One recording per permission. Show the ClientTurn UI *and* the Meta surface, so
the reviewer can see the data moving between them. Keep each under two minutes.

| Permission | Record this |
|---|---|
| `pages_show_list` | Settings → Connections → Connect Facebook → the Page picker appearing with the real list → choosing one |
| `pages_read_engagement` | Settings → Connections showing the connected Page's name and follower count read back from Facebook |
| *(comments)* | Post a comment on your own Page from a second account → Find Leads → the commenter appearing as a prospect within seconds. No permission is submitted for this; it demonstrates the `feed` webhook |
| `pages_manage_ads` | Find Leads → the connected Page's lead forms listed by name |
| `pages_manage_metadata` | The connect flow completing → Settings → Connections showing the Meta connection as live/subscribed |
| `pages_messaging` | Send a DM to your Page from a second account → it appearing in the Inbox within seconds → typing a reply → the reply arriving in Messenger |
| `instagram_basic` | The connect flow showing the linked Instagram account by username → Find Leads showing an Instagram commenter |
| `instagram_manage_messages` | Send an Instagram DM from a second account → it appearing in the Inbox → replying → the reply arriving in Instagram |
| `leads_retrieval` | Submit your own lead form (Meta's Lead Ads Testing Tool works) → the lead appearing in Leads within seconds with its consent text |
| `business_management` | The connect flow showing the Business name resolved against the Page |

Nothing to record for WhatsApp: it runs through Twilio and neither WhatsApp
permission is being submitted. See §7.

**Also record, once:** the data-deletion path. Remove the app from Facebook →
show the connection going disconnected in ClientTurn → visit
`/data-deletion?code=…` showing the completed request. Reviewers ask for this on
apps handling user data, and having it ready avoids a round trip.

---

## 5. Order of operations

1. Deploy to a public HTTPS domain and set `NEXT_PUBLIC_SITE_URL`.
2. Set `META_WEBHOOK_VERIFY_TOKEN` in the environment and in Meta's webhook
   configuration.
3. Fill in every field in §1.
4. Connect your own Page and Instagram account to a test workspace.
5. Run the test calls:
   ```
   node scripts/meta-usecase-tests.mjs --token "<user token>" --subscribe
   ```
   Wait up to 24 hours for the dashboard counters to move. Each test is valid
   for 30 days.
6. Record the screencasts in §4 against that same connected Page.
7. Complete Business Verification.
8. Submit the nine Meta permissions in §3, plus the two WhatsApp ones once a
   real number is registered. Nothing else.

Do **not** submit `ads_management`, `ads_read`, `pages_manage_ads`,
`catalog_management` or `ads_mcp_management`. Nothing in the code calls them, so
no screencast could demonstrate them, and a permission without a screencast is
refused.

---

## 6. The things most likely to bounce it back

* **Requesting a permission with no screencast.** The commonest rejection.
  Eight permissions, eight recordings.
* **A reviewer who cannot log in.** Test credentials that expire, or a workspace
  that demands payment before reaching Settings.
* **No connected Page on the test account.** The reviewer will not connect
  their own, and every permission except `pages_show_list` needs one.
* **Copy-pasted descriptions.** Meta says so explicitly. The eight above are
  deliberately different.
* **`instagram_manage_messages` not attached to any use case.** Check this
  before submitting — the Instagram half cannot work without it, whatever else
  is approved.

---

## 7. WhatsApp: Twilio, and what the Cloud API code is for

**The decision (2026-09-08): WhatsApp goes through Twilio.** No Meta App Review,
no Tech Provider onboarding, no access verification, no number registration with
Meta. Twilio holds the platform relationship; we hold an account with them.

### What Twilio still needs

The account is real but empty — verified against the API on 2026-09-08:

```
account   AC…  "My First Twilio Account"  active
numbers   0
services  0
balance   £0.00
```

So WhatsApp does not work yet, and neither does SMS. In order:

1. **Credit on the account.**
2. **A sender.** The free **Twilio WhatsApp Sandbox** (`whatsapp:+14155238886`,
   recipients join with a code) is enough for testing and demos. A production
   sender needs a number plus WhatsApp Business approval, which Twilio walks you
   through — still a Meta approval underneath, but Twilio carries it.
3. **`TWILIO_WHATSAPP_FROM`** and **`TWILIO_SMS_FROM`** set, locally and on
   Vercel. Until then the deployment **refuses to send** rather than pretending
   — see the remediation log for why that behaviour changed.

### Why the Cloud API code stays

`lib/messaging/whatsapp.ts` and `providers/whatsapp-cloud.ts` are built, tested
and dormant. `config()` returns null without `META_WHATSAPP_CONFIG_ID`, so the
provider is hidden rather than offered broken, and `usesWhatsAppCloudApi()`
returns false for every workspace — so every send routes to Twilio.

It is kept rather than deleted because the choice is per workspace and reversible
in a day: the transport, the Embedded Signup flow, the webhook parsing and the
24-hour service-window rule are all done and covered by tests. Taking the direct
route later means Tech Provider onboarding and a registered number, not another
build.

### The rules are Meta's either way

Going through Twilio does not soften them:

* A person messages the business → free-form replies for **24 hours**.
* Outside that window, only a **pre-approved template**. Free text is refused.
* **No way to reach a number that never contacted the business** without an
  approved template and an opt-in you can evidence.

WhatsApp is not a cold channel on either route. It is very good at continuing a
conversation somebody started, which is what the agent does with it.
