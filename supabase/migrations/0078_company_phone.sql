-- 0078_company_phone: the business's own published telephone number.
--
-- `prospect_companies` recorded a name, a domain, a website and a location, and
-- no way to ring the place. That was not a considered omission -- it followed
-- from the sourcing waterfall having been designed around email, where the
-- phone number arrived (if at all) as a stray field on a contact record from a
-- provider that was not looking for one.
--
-- ## Why this is worth a column rather than a purchase
--
-- The obvious response to "we have no phone numbers" is to buy them. For this
-- product that would mostly be wasted money, because of what
-- `lib/find-leads/contact-legality.ts` already refuses:
--
--   * A **UK mobile** is almost always a personal device. Cold-calling one is a
--     different legal act from ringing a switchboard and needs TPS screening
--     this product does not perform, so `assessPhone` returns REVIEW and the
--     number never becomes callable on its own.
--   * **070, 076, 09 and 118** ranges are refused outright.
--
-- What survives that filter is a **business landline** -- and Google Places
-- publishes exactly that, for exactly the local home-service businesses this
-- product targets, as part of a request the run already makes. The number was
-- being discarded in the field mask rather than being unavailable.
--
-- So the number belongs to the **company**, not to the contact. A landline
-- reaches the business, not a named person, and storing it on `prospects`
-- would imply we know whose desk it rings -- which we do not, and which is the
-- distinction `subscriber_type` turns on.

alter table public.prospect_companies
  -- E.164 where it could be normalised, otherwise as published. Not normalised
  -- destructively: a number we could not parse is more useful shown as the
  -- source gave it than silently dropped.
  add column if not exists phone text,
  -- Which of the sources the run consulted published it. Kept for the same
  -- reason `prospect_data_sources` exists: "where did this come from" must be
  -- answerable per field, not per record.
  add column if not exists phone_source text;

alter table public.prospect_companies
  drop constraint if exists prospect_companies_phone_source_check;
alter table public.prospect_companies
  add constraint prospect_companies_phone_source_check
  check (phone_source is null or phone_source in (
    'GOOGLE_PLACES','COMPANY_WEBSITE','REGISTRY','LICENSED_PROVIDER','IMPORT','MANUAL'
  ));
