-- 0098_drop_orphaned_company_phone: remove two columns nothing fills.
--
-- `0078_company_phone` added `prospect_companies.phone` and `phone_source`,
-- sourced free from Google Places. The requirement changed before it shipped:
-- ClientTurn contacts people by **email**, and by SMS only to a mobile the
-- person submitted on a lead form themselves. It never cold-calls, so a
-- switchboard number has no purpose in the product.
--
-- The writes were removed at that point and the columns were not, which left
-- two personal-data columns that nothing reads and nothing populates. That is
-- precisely the data-minimisation failure the compliance layer exists to
-- prevent, and it would be ours rather than a customer's — a column holding
-- contact details for a purpose the product does not have is exactly what a
-- subject access request is about.
--
-- Safe to drop rather than deprecate: verified empty on the live database
-- (`select count(*) where phone is not null` → 0), and no code path references
-- either column. `contact-legality.assessPhone` is untouched — it still screens
-- the mobile numbers that arrive through lead forms, which is the one place a
-- phone number legitimately enters the system.

alter table public.prospect_companies
  drop column if exists phone,
  drop column if exists phone_source;
