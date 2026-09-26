/**
 * Shared by every story file: the evidence ledger, `check()`, business
 * configuration and small integration helpers. Imported after safety.ts has
 * installed its guards (the runner guarantees the order).
 */
import * as H from "./harness.ts";
import { RUN } from "./safety.ts";

const { admin } = H;

/* --------------------------------------------------------------- evidence */

export type Result = "PASS" | "FAIL" | "BLOCKED" | "NOT APPLICABLE";
export type Row = { id: string; flow: string; scenario: string; expected: string; actual: string; result: Result; evidence: string; fix?: string };
export const evidence: Row[] = [];
export function record(row: Row) {
  evidence.push(row);
}

/** Runs a check, records PASS/FAIL with the actual value, and rethrows on failure. */
export async function check(
  meta: Omit<Row, "actual" | "result" | "evidence"> & { evidence?: string },
  fn: () => Promise<string> | string,
) {
  try {
    const actual = await fn();
    record({ ...meta, actual, result: "PASS", evidence: meta.evidence ?? meta.scenario });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record({ ...meta, actual: message.slice(0, 500), result: "FAIL", evidence: meta.evidence ?? meta.scenario });
    throw error;
  }
}

/* ------------------------------------------------------ business profiles */

export type QuestionSpec = { text: string; type: "text" | "single_choice" | "yes_no" | "timing"; required: boolean; options?: string[] };
export type ProfileSpec = {
  name: string;
  archetype: string;
  motions: string[];
  industryCode: string;
  salesModel?: "SERVICE" | "SAAS" | "ECOMMERCE" | "AGENCY" | "OTHER";
  services: { name: string; averageValue: number; publicPrice?: string }[];
  questions: QuestionSpec[];
  tone?: string;
  avoid?: string;
  bookingMode?: "google_calendar" | "calendly" | "handover";
};

export const questionIds = new Map<string, string>();

export async function configureBusiness(spec: ProfileSpec) {
  const w = H.mustWorld();
  await H.must(admin.from("businesses").update({ industry: spec.name }).eq("id", w.businessId), "business name");
  await H.must(
    admin.from("business_settings").update({ booking_mode: spec.bookingMode ?? "google_calendar", message_signature: spec.name }).eq("business_id", w.businessId),
    "booking mode",
  );
  await H.must(
    admin.from("business_profiles").upsert(
      {
        business_id: w.businessId,
        sales_model: spec.salesModel ?? "AGENCY",
        summary: `${spec.name} (story fixture)`,
        primary_industry_system: "UK_SIC_2007",
        primary_industry_code: spec.industryCode,
        archetype_key: spec.archetype,
        sales_motions: spec.motions,
        classification_source: "USER",
        classification_confidence: 1,
        outreach_tone: spec.tone ?? "Plain, warm, British English. No hype.",
        outreach_avoid: spec.avoid ?? "guaranteed results",
      },
      { onConflict: "business_id" },
    ),
    "profile",
  );
  // The previous story's configuration is retired, not deleted (answers reference it).
  await admin.from("services").update({ active: false }).eq("business_id", w.businessId);
  await admin.from("qualification_questions").update({ active: false }).eq("business_id", w.businessId);
  let position = 0;
  for (const service of spec.services) {
    await H.must(
      admin.from("services").insert({
        business_id: w.businessId,
        name: service.name,
        average_value: service.averageValue,
        active: true,
        position: position++,
        pricing_visibility: service.publicPrice ? "PUBLIC_FROM" : "QUOTE_REQUIRED",
        public_price_text: service.publicPrice ?? null,
      }),
      "service",
    );
  }
  position = 0;
  for (const q of spec.questions) {
    const { data, error } = await admin
      .from("qualification_questions")
      .insert({ business_id: w.businessId, question_text: q.text, response_type: q.type, required: q.required, position: position++, active: true })
      .select("id")
      .single();
    if (error || !data) throw new Error(`question: ${error?.message}`);
    questionIds.set(q.text, data.id as string);
    let optionPosition = 0;
    for (const option of q.options ?? []) {
      await H.must(
        admin.from("qualification_options").insert({
          business_id: w.businessId,
          question_id: data.id,
          label: option,
          value: option.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          position: optionPosition++,
        }),
        "option",
      );
    }
  }
}

/* ----------------------------------------------------------- integrations */

/**
 * A connection with a FAKE credential. Only this process can use it (every job
 * for the workspace is parked), and the credential is rejected anywhere real.
 */
export async function connect(provider: string, extra: { config?: Record<string, unknown>; externalAccountId?: string; webhookSecret?: string } = {}) {
  const w = H.mustWorld();
  const { data: existing } = await admin.from("integrations").select("id").eq("business_id", w.businessId).eq("provider_type", provider).maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await admin
    .from("integrations")
    .insert({
      business_id: w.businessId,
      provider_type: provider,
      status: "HEALTHY",
      config: extra.config ?? {},
      external_account_id: extra.externalAccountId ?? null,
      display_name: `Story ${provider} (fake)`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`integration ${provider}: ${error?.message}`);
  await H.must(
    admin.from("integration_secrets").insert({
      integration_id: data.id,
      business_id: w.businessId,
      access_token: `story-fake-${provider}-token`,
      refresh_token: null,
      webhook_secret: extra.webhookSecret ?? null,
      token_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }),
    `${provider} secret`,
  );
  return data.id as string;
}

/** Deletes a story connection as soon as its step is done. */
export async function disconnect(provider: string) {
  const w = H.mustWorld();
  await admin.from("integrations").delete().eq("business_id", w.businessId).eq("provider_type", provider);
}

export async function enqueuePoll(integrationId: string, provider: string) {
  const { enqueue } = await import("../../src/lib/jobs/queue.ts");
  return enqueue("lead_source.poll", { integrationId, provider }, { businessId: H.mustWorld().businessId, priority: 10, idempotencyKey: `story-poll:${integrationId}:${Date.now()}` });
}

export async function runOp(operation: string, args: Record<string, unknown>, caller: "UI" | "MCP" | "API" | "AGENT" = "UI") {
  const { runOperation } = await import("../../src/lib/services/index.ts");
  const w = H.mustWorld();
  return runOperation(operation, args, { businessId: w.businessId, userId: w.ownerId, role: "owner", caller, confirmed: true, correlationId: `story-${RUN}-${operation}-${Date.now()}` });
}

export async function leadByEmail(email: string) {
  const { data } = await admin.from("leads").select("*").eq("business_id", H.mustWorld().businessId).eq("email_normalized", email.toLowerCase());
  return (data ?? []) as Record<string, unknown>[];
}

export async function touchesFor(leadId: string) {
  const { data } = await admin.from("lead_touches").select("*").eq("lead_id", leadId).order("received_at");
  return (data ?? []) as Record<string, unknown>[];
}

export async function openOpportunity(leadId: string) {
  const { data } = await admin.from("opportunities").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data as Record<string, unknown> | null;
}

export async function channelVerdicts(leadId: string, subject: { email?: string | null; phone?: string | null }, campaign: "WARM" | "COLD" = "WARM") {
  const { evaluateAllChannels } = await import("../../src/lib/policy/service.ts");
  const { byChannel } = await evaluateAllChannels(H.mustWorld().businessId, { type: "LEAD", id: leadId, ...subject }, campaign);
  return Object.fromEntries(
    Object.entries(byChannel).map(([c, d]) => [c, `${(d as { outcome: string }).outcome}/${(d as { reasonCode: string }).reasonCode}`]),
  ) as Record<string, string>;
}
