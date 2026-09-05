import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type SessionSeed = {
  anonymousId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
};

type Client = ReturnType<typeof createAdminClient>;

async function resolveSessionId(
  supabase: Client,
  seed: SessionSeed,
): Promise<string | null> {
  const anonymousId = seed.anonymousId?.trim();
  if (!anonymousId) return null;

  const { data: existing } = await supabase
    .from("marketing_sessions")
    .select("id")
    .eq("anonymous_id", anonymousId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created } = await supabase
    .from("marketing_sessions")
    .insert({
      anonymous_id: anonymousId,
      utm_source: seed.utmSource ?? null,
      utm_medium: seed.utmMedium ?? null,
      utm_campaign: seed.utmCampaign ?? null,
      utm_content: seed.utmContent ?? null,
      utm_term: seed.utmTerm ?? null,
      referrer: seed.referrer ?? null,
      landing_path: seed.landingPath ?? null,
    })
    .select("id")
    .single();

  return created?.id ?? null;
}

export async function recordMarketingEvent(input: {
  eventName: string;
  ctaPlacement?: string | null;
  metadata?: Record<string, unknown>;
  session?: SessionSeed;
}): Promise<void> {
  const supabase = createAdminClient();
  const sessionId = input.session
    ? await resolveSessionId(supabase, input.session)
    : null;

  await supabase.from("marketing_events").insert({
    session_id: sessionId,
    event_name: input.eventName,
    cta_placement: input.ctaPlacement ?? null,
    metadata: (input.metadata ?? {}) as never,
  });
}
