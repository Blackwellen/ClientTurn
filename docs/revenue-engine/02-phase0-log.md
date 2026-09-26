# Phase 0 — Release-blocker log

Working record for Phase 0 (defects B1–B26 in [00 §1](00-discovery-and-implementation-map.md)).
Each entry states the root cause, the fix, the test that reproduced it and the evidence.

## Status

| ID | Status | Migration | Test |
|---|---|---|---|
| B1, B2, B25, Q4, §6.1 | fixed (coordinator) | 0110 | tests/individual-subscriber-policy.test.ts (14) |
| B3, B4, B5, B26 | fixed; B4 email complaints need `inbound.ts` to expose the ARF part (dispatched) | 0111 | tests/suppression-signals.test.ts (13) |
| B6, B7, B8, B9 | fixed | 0112 (**must ship before the code**) | tests/send-safety.test.ts (19) |
| B10 | fixed | 0113 (**must ship before the code**) | tests/booking-confirmation.test.ts (26) |
| B11, B12, B13, B16, B24 | in progress | 0114 | tests/ingest-integrity.test.ts |
| B14, B15 | fixed | 0115 | tests/write-integrity.test.ts (8) |
| B17–B21 | fixed | 0116 | tests/ai-billing.test.ts |
| B22, B23 | fixed | — | tests/agent-permissions.test.ts (29) |

## Behaviour changes a workspace will notice

These are deliberate and follow from the decisions in 00 §6.

- **Cold email to a prospect whose company Companies House could not confirm now goes to review.** Before, any
  non-generic email domain was asserted CORPORATE, and a sole trader's own domain passed. The subscriber type now comes
  from the stored permission record, or else the company's register verdict. UNKNOWN never sends unattended.
- **Cold email to sole traders and English/Welsh/NI limited partnerships is blocked outright**, not "review".
  Scottish partnerships, Scottish LPs (`SL` numbers) and LLPs are corporate.
- **Marketing to an individual-type subscriber needs a basis beyond "a relationship".** Imported, referral and "other"
  records of unknown type now show *consent required* for reactivation and follow-up. Records that contacted the
  business, customers and evidenced consent are unaffected.
- **Accepted LinkedIn/social connections with individual-type subscribers get one non-promotional opener.** Nothing
  more is sent until they reply with interest or a question, which upgrades the relationship to THEY_CONTACTED_US.
  Contentless connection requests are still permitted for any subscriber type.
- **Private replies to comments are conversational.** The template no longer pitches, and a promotional AI draft is
  refused unless the record permits marketing.
- **WhatsApp: a business-initiated message needs a recorded WhatsApp opt-in** (`consent_scope` containing WHATSAPP).
  Inside the 24-hour window nothing changes.
- **START on SMS/WhatsApp re-permits that channel only.** ~~STOP writes an all-channel opt-out, so after START the
  lead-wide `opted_out` flag stays set, and START is in effect a no-op.~~ **Resolved in Phase 1 (migration 0123,
  2026-09-25):**
  - a bare carrier keyword (`STOP`, `UNSUBSCRIBE`, `CANCEL`, …) texted on SMS or WhatsApp writes an `OPT_OUT` for
    **that channel only** (`optOutScope` in `lib/messaging/types.ts`); `STOPALL`, a plain-English "stop contacting
    me", and STOP typed in an email or a DM stay **all-channel**;
  - `leads.opted_out` is **derived**: a trigger keeps it true iff an ALL-channel `OPT_OUT`/`COMPLAINT`/`LEGAL`
    suppression stands for one of the lead's addresses, and re-derives it whenever a suppression row is inserted or
    deleted. Nothing writes the flag any more; a lead with no address at all (a DM thread) keeps what was written;
  - the send guard (`send-store.ts`, `guardOptedOut` in `send-core.ts`) reads the channel's own suppression lookup,
    not the flag, wherever that lookup can see the opt-out (email/SMS/WhatsApp to the lead's own address);
  - so START on SMS lifts the SMS opt-out (0111) and the lead can be texted again, while email and WhatsApp stay as
    they were. Any STOP still ends the unattended follow-up sequence (`automation_active = false`).
  - The migration backfilled an ALL-channel opt-out for every lead flagged `opted_out` with no recipient opt-out on
    the list, so deriving the flag un-opted-out nobody. Test: `tests/per-channel-opt-out.test.ts`.
- **Alphanumeric SMS sender IDs are refused**, because recipients cannot reply STOP to them.
- **Bookings:** Google mode books only after Google accepts the event, and invites the lead. Calendly mode sends the
  booking link. Manual mode records a *pending* request that staff confirm.

## Follow-ups from B14/B15

1. `outreach/campaigns/replies.ts:52-75`: `messageClassificationFor` duplicates the mapping and misfiles NOT_INTERESTED → NOT_NOW. It should use `toMessageReplyClassification`, and its update at `:121` must read `error`.
2. `outreach/campaign-draft.ts` ~223/~237: the POSITIVE rule should include `BOOKING_INTENT`, and the NOT_INTERESTED rule should include `NOT_INTERESTED`.
3. `analytics/v4-queries.ts:213` and `analytics/engagement.ts:250`: replace the hard-coded positive lists with `POSITIVE_MESSAGE_REPLY_CLASSIFICATIONS`.
4. `components/find-leads/campaigns/detail/overview.tsx:554`: add badges for `BOOKING_INTENT` and `NOT_INTERESTED`.

## Unread `{ error }` sweep (to fix once owning agents finish)

**HIGH**

- **Consent and suppression**
  - `app/unsubscribe/[token]/page.tsx:46,68,114,124`
  - `jobs/handlers/message-inbound.ts:158,171`
  - `jobs/handlers/lead-process.ts:293`
  - `agent/tools.ts:985,1016`
  - `policy/service.ts` (contact_permissions upsert)
  - `policy/suppression.ts:220`
- **Sending**
  - `outreach/dispatch.ts:467,489,503,523,550,773,791,806,817,833`
  - `jobs/handlers/send-store.ts:381,428,477,515,535`
  - `jobs/handlers/campaign-send.ts:119-217`
- **Billing**
  - `app/api/webhooks/stripe/route.ts:181,233`
  - `billing/token-service.ts:161,351`
  - `billing/token-actions.ts:122,129,145`
- **Booking**
  - `jobs/handlers/booking-sync.ts:130,153,169,183`
  - `agent/tools.ts:733`
- **Qualification**
  - `jobs/handlers/qualify.ts:138,152`
  - `message-inbound.ts:666,255,685,727`
- **Ingest**
  - `lead-process.ts:252`
  - `meta-lead-ads.ts:511`
- **Audit**
  - `lib/audit.ts:280` (`recordAudit`)

**MEDIUM**

- `jobs/queue.ts:108,132,147`
- `webhooks/stripe/route.ts:112,121`
- `webhooks/twilio/route.ts:110,159`
- `message-inbound.ts:211,360,396,506,512,533,769,804,821`
- `outreach/campaigns/replies.ts:121,147,308`
- `policy/service.ts:339,384`
- `automation-advance.ts:~345`
- `agent/tools.ts:577,864,898`
- `jobs/handlers/shared.ts:610`
- `meta-lead-ads.ts:231`

**Not reviewed line by line** (bare-await counts):

- `sourcing-run.ts` (45)
- `find-leads/server/research.ts` (18)
- `outreach/social-scheduler.ts` (15)
- `social/replies.ts` (12)
- `imports/actions.ts` (10)
