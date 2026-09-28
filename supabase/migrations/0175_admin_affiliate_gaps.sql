-- 0175_admin_affiliate_gaps: the support-side gaps found by the admin and
-- affiliate audit of 2026-09-28 (the features shipped in 0171-0174).
--
--   1. checkout_payments: how a person resolved a payment flagged for review
--      (0173 review_reason: OVERPAID, CURRENCY_MISMATCH, REFUNDED, DISPUTED,
--      INVOICE_ALREADY_PAID, INVOICE_NOT_PAYABLE, ZERO_AMOUNT; and payments
--      with no token or an email-only match). Before this there was no way to
--      clear a flag: an OVERPAID or REFUNDED payment stayed flagged forever and
--      was never listed anywhere. The queue is Settings -> Quotes & invoices
--      (src/lib/invoicing/payment-review.ts); the operations are
--      invoice.review_apply_payment and invoice.review_dismiss_payment.
--      Resolution never moves money: the workspace's own Stripe is the
--      merchant of record (CLAUDE.md, Resolved conflict 8).
--
--   2. linkedin_assist_workspace_holds: a platform admin's pause of one
--      workspace's LinkedIn Assist (abuse, a complaint, an account at risk).
--      A row is the hold; removing it lifts the hold. While it exists every
--      person's list is paused (replies only), nothing new can be added and no
--      AI draft is written (src/lib/linkedin-assist/store.ts loadSettings).
--      Members can read it so the product can say why; only the service role
--      writes, from Admin -> Customers (audited, step-up).
--
-- business_id on every row; RLS enabled and forced; the browser role keeps
-- SELECT only, for members, as 0168_rls_grant_hardening. New columns on
-- checkout_payments inherit its table-level SELECT (0173 re-asserted it).
--
-- 0171-0174 are taken; this is the next free number. Not applied by the
-- author. Additive and idempotent.

-- ---------------------------------------------- 1. payment review resolution
alter table public.checkout_payments
  add column if not exists review_resolved_at timestamptz,
  add column if not exists review_resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists review_resolution text,
  add column if not exists review_note text;

alter table public.checkout_payments drop constraint if exists checkout_payments_review_resolution_check;
alter table public.checkout_payments
  add constraint checkout_payments_review_resolution_check
  check (review_resolution is null or review_resolution in (
    'APPLIED',          -- recorded on an invoice by a person
    'REFUNDED',         -- the person refunded it in their own provider
    'KEPT_AS_CREDIT',   -- the excess is held as customer credit
    'CREDIT_NOTE',      -- a credit note was issued for a refund or lost dispute
    'RECORDED_BY_HAND', -- e.g. a currency mismatch recorded manually on the invoice
    'DISPUTE_WON',      -- the dispute closed in the workspace's favour
    'NOT_OURS'));       -- not a payment for this workspace's invoices

alter table public.checkout_payments drop constraint if exists checkout_payments_review_note_check;
alter table public.checkout_payments
  add constraint checkout_payments_review_note_check
  check (review_note is null or char_length(review_note) <= 500);

-- A resolution names its time, and a time names its resolution.
alter table public.checkout_payments drop constraint if exists checkout_payments_review_resolved_shape;
alter table public.checkout_payments
  add constraint checkout_payments_review_resolved_shape
  check ((review_resolved_at is null) = (review_resolution is null));

-- The open queue: flagged or unmatched, not yet resolved.
create index if not exists checkout_payments_open_review_idx
  on public.checkout_payments (business_id, paid_at desc)
  where review_resolved_at is null
    and (review_reason is not null or status in ('REVIEW', 'UNMATCHED'));

-- ------------------------------------------ 2. LinkedIn Assist admin holds
create table if not exists public.linkedin_assist_workspace_holds (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  held_by uuid references auth.users(id) on delete set null,
  held_at timestamptz not null default now()
);

alter table public.linkedin_assist_workspace_holds enable row level security;
alter table public.linkedin_assist_workspace_holds force row level security;
revoke all on public.linkedin_assist_workspace_holds from anon, authenticated;
grant select on public.linkedin_assist_workspace_holds to authenticated;
drop policy if exists linkedin_assist_workspace_holds_select_member on public.linkedin_assist_workspace_holds;
create policy linkedin_assist_workspace_holds_select_member on public.linkedin_assist_workspace_holds
  for select to authenticated
  using (public.is_business_member(business_id));
