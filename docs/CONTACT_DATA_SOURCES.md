# Where contact details come from, and why we may use them

The question this document answers is the one a buyer's lawyer asks and the one
the ICO would ask: **where did this email address come from, and what makes it
lawful to send to it?**

It is answerable for every record in the system, and the mechanism that makes it
answerable is described here. Nothing in this document is aspirational; each
rule names the code that enforces it.

---

## 1. The short answer

ClientTurn does not scrape. Every contact detail arrives by one of seven routes,
each recorded on the record itself in `prospect_data_sources`:

| Source kind | What it means | Typical provider |
|---|---|---|
| `LICENSED_PROVIDER` | A commercial provider we hold a licence with. Their terms decide what the data may be used for. | Apollo, Hunter, Clearbit |
| `PUBLIC_CORPORATE_REGISTER` | Companies House and equivalents | — |
| `BUSINESS_WEBSITE` | Contact details a business publishes about itself | — |
| `OPEN_GOVERNMENT_RECORD` | Procurement notices, licensing registers, planning data | — |
| `CUSTOMER_UPLOAD` | Records the customer imports, asserting their own basis | — |
| `CONNECTED_CRM` | Records synced from a system the customer already runs | HubSpot, Zoho |
| `INBOUND_ENQUIRY` | Someone who contacted the business. The strongest basis there is. | Meta lead forms, Messenger, Instagram |

The vocabulary lives in [`src/lib/compliance/types.ts`](../src/lib/compliance/types.ts).
A workspace chooses which of these it permits, in Settings → Data controls.

**Sources that are never permitted, with no toggle:** breached or leaked
databases; purchased lists with no record of origin; harvested personal email
addresses; harvested consumer phone numbers; scraping private or sign-in-only
profiles; datasets whose licence forbids marketing reuse; and any record whose
origin cannot be established.

That last one matters most. A record with **no** recorded provenance returns
`UNKNOWN`, not "permitted" — see `verdictForSources`. A prospect that arrived
from nowhere identifiable is exactly the one worth stopping on.

---

## 2. The two legal regimes, and why both apply

They answer different questions, and satisfying one does not satisfy the other.

**UK GDPR** governs whether there is a lawful basis to *process* the data. For
B2B prospecting that basis is legitimate interests, which requires a balancing
test — and the balance turns almost entirely on whether the person would
reasonably expect the contact. Someone whose work address is published on their
employer's website, contacted about their job, would. Someone whose personal
Gmail was scraped from a forum would not, and no amount of unsubscribe machinery
repairs that.

**PECR** governs the act of *sending*, and draws a line UK GDPR does not:
between a **corporate subscriber** and an **individual subscriber**. Marketing
email and calls to a corporate subscriber are permitted without prior consent,
subject to an opt-out. To an individual subscriber — which includes sole traders
and most partnerships — they are not.

This is why `prospects.subscriber_type` exists and is now populated rather than
left `UNKNOWN` for everybody.

---

## 3. What the gate actually refuses

[`src/lib/find-leads/contact-legality.ts`](../src/lib/find-leads/contact-legality.ts)
runs on every detail a provider returns, **before** it is written and before the
run is charged for it.

### Email

| Input | Verdict | Why |
|---|---|---|
| `priya@thamesplumbing.co.uk` | **PERMITTED**, corporate | A business address on the company's own domain |
| `info@thamesplumbing.co.uk` | **PERMITTED**, corporate | A role address: published by the business for this purpose, belongs to the organisation, not to a named person |
| `priya.shah@gmail.com` | **REFUSED** | A personal mailbox. Cold marketing to an individual subscriber needs consent nobody here has |
| `sam@btinternet.com` | **REFUSED** | Same — UK ISP mailboxes are residential |
| `x@mailinator.com` | **REFUSED** | Disposable. Not a contact point; the bounce damages the sending domain |
| anything, no provenance | **REFUSED** | Accountability requires being able to *demonstrate* the basis |

Role addresses are **kept**, and the instinct to strip them is wrong. An `info@`
address is the safest thing in the whole module. It is a weaker sales lead than
a named decision maker — a commercial judgement, not a legal one.

### Phone

| Input | Verdict | Why |
|---|---|---|
| `020 7946 0018` | **PERMITTED**, corporate | A business landline. Screen against the CTPS before calling |
| `07700 900123` | **REVIEW** | A mobile. May be a company line or a sole trader's personal phone; only the second needs TPS screening, and nothing in the number says which |
| `09…`, `070…`, `076…` | **REFUSED** | Premium-rate or personal-numbering ranges |
| non-UK | **REVIEW** | Another jurisdiction's rules apply and this module does not know them |

**A refused detail is not stored.** Not suppressed, not flagged, not queued —
not kept. Carrying it with a boolean would leave a personal address in the
database with one flag between it and a send, and there is no lawful basis to
hold it at all.

A **REVIEW** verdict sets `outreach_eligibility = 'REVIEW'` with the reason on
the record, so a person decides. It never silently becomes contactable.

### What the gate deliberately does not do

It does not screen against the **TPS or CTPS**. Those are live registers, the
screening is a paid lookup, and claiming to have done it here would be worse
than not claiming to. `REVIEW` on a mobile is the honest output; the register
check belongs at the point of dialling.

---

## 4. Social platforms return no contact details at all

Worth stating plainly, because it is the most common misunderstanding about what
social prospecting can do.

* **Meta** returns a page-scoped id and a display name for someone who engaged
  with your Page or Instagram account. No email. No phone. Ever. It does let you
  send that person one direct message if they commented on your content — see
  `docs/AGENT_RUNTIME.md` — but it never tells you how to reach them anywhere
  else.
* **LinkedIn** returns no email address through any API. An address comes from a
  licensed provider matched on the profile URL, or from the person's own contact
  info once they are a first-degree connection.
* **TikTok** returns a handle.

So a social prospect is qualified **through conversation**, not through
enrichment. That is not a limitation of this implementation; it is what the
platforms provide.

### Can a third-party provider fill the gap, if it is business-only?

Yes — and this is a route the product supports deliberately. It is worth being
precise about what makes it lawful, because "it's B2B" is not on its own an
answer.

A licensed provider may supply a **work email address for a named person at a
named company**, matched on a company domain or a public profile URL. That is
`LICENSED_PROVIDER` provenance, the person is a corporate subscriber, and PECR
permits marketing email to them subject to an opt-out. So a prospect discovered
on Instagram can perfectly well be worked by email instead, if a lawful business
address is found for them — which is often the better route anyway, since Meta
caps you at one private reply and email does not.

Three conditions, all enforced rather than assumed:

1. **The licence has to permit the use.** A provider's terms decide what its
   data may be used for, and a source whose licence forbids marketing reuse is
   in `PROHIBITED_SOURCES`. This is a contract question, settled when the
   provider is added, not per-record.
2. **The address still has to pass the gate.** `assessEmail` runs on provider
   output exactly as it runs on anything else. A provider returning a personal
   Gmail it happens to hold against a company domain is refused — being sold to
   us by a licensed vendor does not convert somebody's personal mailbox into a
   corporate subscriber's address, and the vendor's licence cannot grant a basis
   it never had.
3. **The provenance is recorded on the record.** `prospect_data_sources` names
   the provider, the field, the confidence and when it was obtained. Without
   that row the address is refused as `NO_PROVENANCE`, because the accountability
   principle requires *demonstrating* the basis, not merely having one.

**Phone is different, and stricter.** A licensed provider will return mobile
numbers alongside landlines. A landline published by a company is a corporate
subscriber's line; a mobile may be a sole trader's personal phone, where the
corporate exemption does not apply and TPS screening is required. Nothing in the
number distinguishes them, so a mobile is `REVIEW` regardless of how reputable
the provider was.

**What a third party cannot do** is supply contact details for a *consumer*.
There is no B2B licence that makes cold-emailing a homeowner lawful, and no
provider whose terms can grant one. The gate refuses consumer mailboxes on every
route, from every source, with no workspace toggle.

---

## 5. Profile photographs

Reference, never copy. Expire, never assume. Fall back to initials without
apology.

* `avatar_url` holds the platform's own URL with the expiry the platform gave
  it. The bytes are never written to disk, because a cached copy of a
  photograph of an identifiable person is exactly what a subject access or
  erasure request is about.
* **LinkedIn is refused outright.** Its User Agreement forbids storing or
  redisplaying member profile images, and `avatarPolicyFor` refuses the source
  even if a row somehow carries one.
* Images are served through [`/api/avatar/[scope]/[id]`](../src/app/api/avatar/), never
  hotlinked. A direct `<img>` at the platform CDN would tell that platform, on
  every page render, which of its users this business is looking at — a
  disclosure nobody agreed to. The proxy is workspace-scoped through RLS, host-
  allowlisted against SSRF, and sends no referer.
* A lapsed URL renders **initials**, not a broken image. An initials avatar is a
  finished design, not a placeholder for a photo we failed to get.

The rules live in [`src/lib/prospects/avatar.ts`](../src/lib/prospects/avatar.ts).

---

## 6. How quality is established, and how it is shown

Being *findable* is not the same as being *contactable*, and neither is the same
as being *worth contacting*. Three separate things, shown separately:

1. **Verification** — `verification_status`. An address is `UNKNOWN` when
   discovered and only becomes `VALID` after a verification provider confirms
   it. A discovered address is never presented as verified; that is how a
   campaign hard-bounces against its own sending domain.
2. **Score** — a deterministic 0–100 across six weighted factors, each with its
   evidence attached. Arithmetic, not a model's opinion, and the breakdown is on
   the prospect.
3. **Eligibility** — `outreach_eligibility` plus `eligibility_reason`, written
   in a sentence a customer can act on rather than a code.

Every AI-written claim in a research summary is dropped unless it cites evidence
that was actually supplied (`keepCitedClaims`). A claim citing an unknown
reference is **discarded, never repaired** — silently re-pointing a bad citation
at some other evidence would launder a fabrication into something that looks
sourced.

---

## 7. Where to look in the code

| Concern | File |
|---|---|
| Permitted and prohibited source kinds | `src/lib/compliance/types.ts` |
| The lawfulness gate on every detail | `src/lib/find-leads/contact-legality.ts` |
| Where the gate runs | `src/lib/find-leads/server/research.ts` |
| Suppression, one list for every channel | `src/lib/policy/suppression.ts` |
| Per-jurisdiction sending rules | `src/lib/policy/packs.ts` |
| Avatar policy | `src/lib/prospects/avatar.ts` |
| The six routes, and each one's honest limitation | `src/lib/find-leads/lead-routes.ts` |
| Tests | `tests/meta-flows.test.ts`, `tests/policy.test.ts`, `tests/compliance.test.ts` |
