-- 0019_ai_settings_cleanup: business_ai_settings.enabled duplicated the
-- pre-existing business_settings.ai_assist_enabled master toggle (loaded into
-- BusinessContext.aiAssistEnabled in src/lib/jobs/handlers/shared.ts but never
-- wired to a UI writer until now). Per "one place" — CLAUDE.md conventions —
-- business_settings.ai_assist_enabled stays the single on/off switch;
-- business_ai_settings now only holds the behaviour sub-settings (tone,
-- reply length, instructions, per-capability allow flags).
alter table public.business_ai_settings drop column enabled;
