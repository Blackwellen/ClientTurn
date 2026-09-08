-- 0077_company_registry_identity: what the register says a company actually is.
--
-- Originally this migration also added a company telephone number, sourced free
-- from Google Places. It was removed before it shipped, and the reason is worth
-- recording: ClientTurn contacts people by **email**, and by SMS only to a
-- mobile the person submitted on a lead form themselves. It never cold-calls.
--
-- So a switchboard number would have been personal data collected for a purpose
-- the product does not have -- which is the data-minimisation failure the whole
-- compliance layer exists to prevent, and it would have been ours rather than a
-- customer's. `contact-legality.assessPhone` stays, because it still screens
-- the mobile numbers that arrive through lead forms.

-- ==========================================================================
-- The register's verdict on what kind of subscriber this is
-- ==========================================================================
-- `policy/types.ts` has distinguished CORPORATE, SOLE_TRADER, PARTNERSHIP and
-- INDIVIDUAL since the jurisdiction packs were written, and the packs treat
-- them differently for a real reason: under PECR the corporate-subscriber
-- exemption from consent covers incorporated bodies and LLPs, and does **not**
-- cover sole traders or unincorporated partnerships, who are treated as
-- individuals.
--
-- Nothing could ever produce the middle two values. `contact-legality` derives
-- a subscriber type from the *email domain*, which can only ever say "a
-- company domain" or "a consumer mailbox" -- so a sole trader trading as
-- "Northgate Roofing" from a matching domain was classified CORPORATE, and the
-- pack's distinction was unreachable from sourced data. The rule existed and
-- could not be enforced.
--
-- A Companies House match is what makes it answerable, and the column lives on
-- the *company* because that is what incorporation is a property of. The
-- prospect inherits it: a named person at an incorporated body is reached under
-- the corporate exemption, and the same person at a sole trader is not.
--
-- A miss deliberately yields UNKNOWN rather than SOLE_TRADER. A company can be
-- absent from a name search because it trades under a different name from the
-- registered one, which is common -- so a miss is an unanswered question, and
-- the packs already route UNKNOWN to review rather than to a send.

alter table public.prospect_companies
  add column if not exists subscriber_type text not null default 'UNKNOWN',
  -- Why, in a sentence a customer can read on the prospect record. A verdict
  -- with no explanation is one nobody can act on or challenge.
  add column if not exists registry_reason text,
  add column if not exists registry_checked_at timestamptz;

alter table public.prospect_companies
  drop constraint if exists prospect_companies_subscriber_type_check;
alter table public.prospect_companies
  add constraint prospect_companies_subscriber_type_check
  check (subscriber_type in ('CORPORATE','SOLE_TRADER','PARTNERSHIP','INDIVIDUAL','UNKNOWN'));

-- The sweep that finds companies never checked against the register.
create index if not exists prospect_companies_registry_pending_idx
  on public.prospect_companies (business_id)
  where registry_checked_at is null;
