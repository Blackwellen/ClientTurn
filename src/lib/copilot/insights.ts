import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rangeBounds } from "@/lib/analytics/v4-queries";
import {
  deriveInsights,
  getCampaignPerformance,
  getChannelPerformance,
} from "@/lib/analytics/v4-extras";

/**
 * Copilot insights (V4 §28.12).
 *
 * Every insight below is arithmetic over the workspace's own records. There is
 * no model in this path, and nothing here can produce a claim that is not
 * checkable against the numbers on the Analytics page — which is what "no
 * fabricated insights" has to mean if it is to mean anything.
 *
 * An insight that cannot be supported is simply not produced. An empty list is
 * a correct answer.
 */

export type CopilotInsight = {
  key: string;
  title: string;
  body: string;
  tone: "positive" | "neutral" | "attention";
  /** Where to go to act on it. */
  href?: string;
};

export async function buildInsights(businessId: string): Promise<CopilotInsight[]> {
  const admin = createAdminClient();
  const bounds = rangeBounds("30d");
  const insights: CopilotInsight[] = [];

  const [channels, campaigns, attention, staleLeads, intent] = await Promise.all([
    getChannelPerformance(businessId, bounds),
    getCampaignPerformance(businessId, 8),
    admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false)
      .eq("needs_attention", true),
    admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false)
      .in("status", ["NEW", "CONTACTED"])
      .lt("last_contact_at", new Date(Date.now() - 3 * 864e5).toISOString()),
    admin
      .from("prospect_intent_matches")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gt("expires_at", new Date().toISOString())
      .gte("observed_at", new Date(Date.now() - 7 * 864e5).toISOString()),
  ]);

  const intentCount = intent.count ?? 0;
  if (intentCount > 0) {
    insights.push({
      key: "intent_surge",
      title: "High intent surge",
      body: `${intentCount} ${intentCount === 1 ? "prospect shows" : "prospects show"} a live intent signal observed in the last week.`,
      tone: "positive",
      href: "/app/find-leads?view=intent",
    });
  }

  const attentionCount = attention.count ?? 0;
  if (attentionCount > 0) {
    insights.push({
      key: "attention",
      title: "Leads need attention",
      body: `${attentionCount} ${attentionCount === 1 ? "lead is" : "leads are"} flagged and waiting on a person.`,
      tone: "attention",
      href: "/app/leads?quick=attention",
    });
  }

  const staleCount = staleLeads.count ?? 0;
  if (staleCount > 0) {
    insights.push({
      key: "follow_up_reminder",
      title: "Follow-up reminder",
      body: `${staleCount} ${staleCount === 1 ? "lead has" : "leads have"} not been contacted in the last 3 days.`,
      tone: "attention",
      href: "/app/follow-up",
    });
  }

  // Reuse the Analytics insight rules rather than writing a second set that
  // could disagree with the ones on the page.
  for (const derived of deriveInsights({
    channels,
    trends: [],
    campaigns,
    replyRateNow: null,
    replyRatePrevious: null,
  })) {
    insights.push({
      key: derived.key,
      title: derived.title,
      body: derived.body,
      tone: derived.tone,
      href: "/app/analytics",
    });
  }

  return insights.slice(0, 6);
}
