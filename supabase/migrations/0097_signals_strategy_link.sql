-- 0097_signals_strategy_link: give a signal something it can actually run.
--
-- 0094 created `sourcing_signals` with a name, a kind and health figures, which
-- is everything needed to *show* a signal and nothing needed to *run* one.
-- Launching one has to produce a sourcing run, and a run needs an approved
-- plan -- so a signal has to point at the strategy it belongs to.
--
-- Modelled the same way `recurring_searches` already does it, deliberately: a
-- schedule and a manual launch are the same act at different times, and giving
-- them different paths to a run is how the two drift until one of them applies
-- a budget check the other does not.
--
-- Nullable, because a signal can legitimately exist before its strategy is
-- approved -- it is shown with "Not run yet" and its Launch button refuses with
-- a reason rather than being hidden.

alter table public.sourcing_signals
  add column if not exists search_strategy_id uuid
    references public.search_strategies(id) on delete set null,
  add column if not exists session_id uuid
    references public.search_sessions(id) on delete set null,
  -- The run this signal most recently produced. Lets the Sources list link
  -- straight to what happened rather than making somebody hunt for it.
  add column if not exists last_run_id uuid
    references public.sourcing_runs(id) on delete set null;

create index if not exists sourcing_signals_strategy_idx
  on public.sourcing_signals (business_id, search_strategy_id)
  where search_strategy_id is not null;
