-- 0139: human hand-over is the last resort (owner decision 2026-09-27).
--
-- "We want AI to carry the weight; human handover is the last resort of last
-- resorts." The conversation agent now keeps the conversation going whenever
-- it lawfully and safely can (docs/AGENT_RUNTIME.md "Hand-over policy",
-- src/lib/agent/handover-policy.ts). Two stored workspace settings changed
-- default, for new AND existing workspaces:
--
--   1. business_ai_settings.agent_handover_on_review: true -> false.
--      A REVIEW qualification result is still recorded by the deterministic
--      rules (the AI never decides it); it is now flagged for a person in the
--      background while the AI carries on, instead of handing the whole
--      conversation over. A workspace can still opt back in from
--      Settings -> AI assistant.
--
--   2. Settings -> AI & selling risk tolerance: CAUTIOUS -> BALANCED
--      (workspace_sales_overrides ARCHETYPE_SETTINGS '*', payload.riskTolerance).
--      The code default was already BALANCED; this moves the workspaces that
--      had stored CAUTIOUS. Risk tolerance now moves the clarify floor, never a
--      hand-over.
--
-- Nothing else changes: no table, column, constraint or policy is added, and
-- consent, opt-out, suppression and quiet hours are untouched. agent_handoffs
-- keeps its reason CHECK: an assist request is an agent_handoffs row with
-- summary_json.kind = 'ASSIST_REQUEST' and ownership left with the AI.
--
-- Idempotent: re-running it changes nothing further.

alter table public.business_ai_settings
  alter column agent_handover_on_review set default false;

update public.business_ai_settings
  set agent_handover_on_review = false
  where agent_handover_on_review;

update public.workspace_sales_overrides
  set payload = jsonb_set(payload, '{riskTolerance}', '"BALANCED"'::jsonb, false),
      updated_at = now()
  where kind = 'ARCHETYPE_SETTINGS'
    and key = '*'
    and payload ->> 'riskTolerance' = 'CAUTIOUS';
