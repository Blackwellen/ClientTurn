-- 0092_crm_push_partial: a push that got half-way is not a push that failed.
--
-- A CRM push is not one call. HubSpot creates or updates a contact, then
-- creates a deal against it. If the deal fails, the contact exists in the
-- customer's CRM and the deal does not.
--
-- That state had no name. The handler recorded `status = 'failed'` and, because
-- the contact id went out with the exception, recorded no
-- `external_contact_id` either -- so the retry read no prior contact and
-- created a second one. The attempt after that created a third. The customer's
-- CRM filled with duplicates of the same person while our own record said the
-- push had failed.
--
-- `partial` is the missing state. It says: something of yours is in their
-- system, we know which record it is, and the retry will update it rather than
-- add another.
alter table public.crm_push_records drop constraint if exists crm_push_records_status_check;
alter table public.crm_push_records add constraint crm_push_records_status_check
  check (status in ('pending', 'pushed', 'failed', 'partial'));

comment on column public.crm_push_records.status is
  'pending | pushed | failed | partial. `partial` means the contact reached the CRM and a later step did not, so external_contact_id is set and a retry must update rather than create.';
