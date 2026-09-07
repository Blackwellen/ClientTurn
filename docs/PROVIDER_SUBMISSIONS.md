# Provider submissions — what is needed, and from whom

Meta and LinkedIn both gate the permissions ClientTurn needs behind a review
with a lead time measured in weeks, so they should be started before the code
that depends on them is finished, not after.

**I cannot submit either of these.** Both require signing in to a developer
account, accepting terms as a legal representative of Blackwellen, and
supplying business verification documents. Those are yours to do. What follows
is everything the submission needs that comes from the codebase, so filling the
forms is transcription rather than investigation.

> Verify the current review requirements against each provider's live developer
> documentation before submitting. The programme notes that LinkedIn's 202508
> Marketing API version was sunset on 17 August 2026, which is exactly the kind
> of change that invalidates a checklist written in advance. Treat the
> ClientTurn-side facts below as authoritative and the provider-side process as
> something to confirm.

---

## Values that come from this codebase

**Redirect URI** — built in [oauth.ts:27](../src/lib/integrations/oauth.ts#L27) as:

```
<SITE_URL>/api/integrations/<provider>/callback
```

So with the production site URL, LinkedIn's is
`https://<your-domain>/api/integrations/linkedin_ads/callback`. It must be
registered on the provider exactly, including scheme and trailing path — the
callback route rejects a mismatch rather than guessing.

**Webhook URLs** — the routes that exist today are under
[api/webhooks/](../src/app/api/webhooks/): `linkedin-ads`, `twilio`, `stripe`.

---

## LinkedIn Lead Sync — **ready to submit**

The integration is implemented:
[linkedin-ads.ts](../src/lib/integrations/providers/linkedin-ads.ts), a connect
flow at `/api/integrations/linkedin_ads/connect`, and a signed webhook at
[api/webhooks/linkedin-ads](../src/app/api/webhooks/linkedin-ads/).

| Field | Value |
|---|---|
| Scopes requested | `r_marketing_leadgen_automation`, `r_ads`, `r_organization_admin` |
| Redirect URI | `<SITE_URL>/api/integrations/linkedin_ads/callback` |
| Webhook URL | `<SITE_URL>/api/webhooks/linkedin-ads` |
| Env vars the server expects | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` (see the provider's `requiredEnv` in [catalog.ts](../src/lib/integrations/catalog.ts)) |

**What you need to do:**

1. Create or claim the LinkedIn developer app under the Blackwellen company page.
2. Apply for the developer product that grants Lead Sync access —
   `r_marketing_leadgen_automation` is not self-serve.
3. Register the redirect URI and the webhook URL above.
4. Complete company verification if it has not been done.

**Before you submit**, confirm the implementation targets a currently-supported
API version rather than the sunset 202508 one. The code comments in
`linkedin-ads.ts` reference `api.linkedin.com/rest/...` endpoints; check the
`LinkedIn-Version` header the client sends against what LinkedIn currently
accepts. This is a one-line change if it is wrong and a rejected submission if
it is not caught.

---

## Meta Lead Ads — **not ready; needs implementation first**

Submitting now would be premature. The catalogue lists Meta
([catalog.ts](../src/lib/integrations/catalog.ts)) with `connectPath: null`,
meaning there is no connection flow at all, and there is no `meta` adapter in
[providers/registry.ts](../src/lib/integrations/providers/registry.ts) and no
lead webhook route. Only the environment variables are declared:
`META_APP_ID`, `META_APP_SECRET`.

**Remaining engineering** (tracked under programme §4, not this item):

- A `meta` provider adapter implementing `getConfig` and `identify`
- A lead webhook with signature verification, writing `webhook_events` before
  acknowledging — the pattern is already set by the other webhook routes
- Page and form selection, and mapping form fields onto lead fields
- Long-lived token refresh

**What you can start now, in parallel:** the Meta app itself, business
verification, and the privacy-policy and data-deletion URLs the review asks for.
Those have their own lead time and none of them depend on the code above.

---

## Google Ads — a recommendation, not a submission

The programme's §4 makes a good call worth acting on: for basic lead delivery,
drop the dependency on ClientTurn holding Google Ads OAuth credentials.
ClientTurn generates a webhook URL and key, the customer pastes them into their
Google Lead Form asset, and Google posts leads directly — deduplicated on the
`lead_id` in the payload.

That removes a developer-token dependency and an approval from the critical
path entirely. The existing OAuth route
(`/api/integrations/google_ads/connect`) can stay for the later, richer version
that discovers ad accounts automatically.

---

## Microsoft Ads — leave behind a capability flag

A connect route exists, but the supported production lead-retrieval interface is
unconfirmed. Do not present an "Available" button on the strength of a marketing
page. If the supported route turns out to require an iPaaS or partner flow, say
so plainly in the UI rather than implying a direct integration exists.
