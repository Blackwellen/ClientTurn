-- 0084_sourcing_strictness: how cautious this workspace wants to be about who
-- it is allowed to contact.
--
-- `business_data_controls` already records *what* a workspace permits: which
-- countries, which source kinds, which lawful basis. What it has never recorded
-- is *how much doubt it will tolerate* -- and that is a separate question with a
-- different answer per workspace.
--
-- The concrete case this exists for. A prospect at "Northgate Studio" with a
-- work address on the company's own domain, where Companies House has no match
-- for that trading name. Every individual check passes. The record is still
-- ambiguous, because a trading name absent from the register may be an
-- incorporated company trading under another name -- or a sole trader, who under
-- PECR is an individual subscriber and needs consent that a corporate one does
-- not.
--
-- There is no universally right answer to that. A workspace prospecting into
-- regulated sectors wants it refused; one selling to small agencies wants it
-- reviewed by a person; and both are defensible positions. So it is a setting,
-- and the setting has three values rather than a boolean because "refuse it",
-- "show me" and "send it" are genuinely three different instructions.

alter table public.business_data_controls
  /**
   * STRICT   -- contact only records the register confirms are corporate, with
   *             an address on the company's own domain. Anything unresolved is
   *             refused rather than queued: in this mode an unanswered question
   *             is an answer.
   * BALANCED -- the default. Unresolved records are held for a person, which is
   *             the behaviour the product had before this column existed, now
   *             named rather than implicit.
   * OPEN     -- unresolved records may be contacted on the workspace's own
   *             stated lawful basis. Still refuses everything the jurisdiction
   *             pack refuses; this widens the workspace's tolerance for doubt,
   *             never the law.
   */
  add column if not exists sourcing_strictness text not null default 'BALANCED',
  /**
   * Whether a register match is required before a prospect is contactable.
   *
   * Separate from the mode because a workspace may want the register check
   * enforced without adopting STRICT's other refusals -- and because on this
   * one the honest default depends on a fact we know: Companies House covers
   * the UK only. A workspace prospecting into Ireland or Germany would find
   * every record unresolved, so requiring a match is opt-in rather than implied
   * by STRICT.
   */
  add column if not exists require_registry_match boolean not null default false;

alter table public.business_data_controls
  drop constraint if exists business_data_controls_sourcing_strictness_check;
alter table public.business_data_controls
  add constraint business_data_controls_sourcing_strictness_check
  check (sourcing_strictness in ('STRICT', 'BALANCED', 'OPEN'));
