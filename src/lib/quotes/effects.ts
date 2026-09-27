import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueue } from "@/lib/jobs/queue";
import { serverEnv } from "@/lib/env";
import { can } from "@/lib/billing/capabilities";
import type { Capability } from "@/lib/billing/capability-rules";
import { emitQuoteEvent } from "./events";
import { createQuoteStore } from "./store";
import type { DeliveryResult, QuoteDeps, QuoteEffects } from "./service-core";

/**
 * The live side effects of the quote core: queue an email through the normal
 * send pipeline, queue jobs, emit events, build the public URL. No provider
 * I/O happens here: the message is a QUEUED row and a `message.send` job, and
 * the send gate re-checks opt-out, suppression, quiet hours and the plan
 * immediately before it goes (CLAUDE.md: follow-up respects stop conditions).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export function quotePublicUrl(token: string): string {
  return `${serverEnv.siteUrl.replace(/\/$/, "")}/q/${token}`;
}

/** Queue one email to the lead through the send pipeline. Idempotent on sendKey. */
export async function queueLeadEmail(input: {
  businessId: string;
  leadId: string;
  subject: string;
  body: string;
  sendKey: string;
  origin: "manual" | "automation" | "system";
}): Promise<DeliveryResult> {
  const client = db();
  const { data: lead } = await client
    .from("leads")
    .select("id, email, opted_out, anonymised_at, archived_at")
    .eq("id", input.leadId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  const row = lead as { id: string; email: string | null; opted_out: boolean; anonymised_at: string | null; archived_at: string | null } | null;
  if (!row?.email) return { queued: false, channel: "email", detail: "The lead has no email address." };
  if (row.opted_out || row.anonymised_at || row.archived_at) {
    return { queued: false, channel: "email", detail: "The lead cannot be emailed (opted out, archived or anonymised)." };
  }

  let conversationId: string;
  const { data: existing } = await client
    .from("conversations")
    .select("id")
    .eq("business_id", input.businessId)
    .eq("lead_id", row.id)
    .eq("channel", "email")
    .maybeSingle();
  if (existing) {
    conversationId = (existing as { id: string }).id;
  } else {
    const { data: created, error } = await client
      .from("conversations")
      .insert({ business_id: input.businessId, lead_id: row.id, channel: "email" })
      .select("id")
      .single();
    if (error || !created) return { queued: false, channel: "email", detail: "The email conversation could not be opened." };
    conversationId = (created as { id: string }).id;
  }

  const { data: message, error: messageError } = await client
    .from("messages")
    .insert({
      business_id: input.businessId,
      conversation_id: conversationId,
      lead_id: row.id,
      direction: "outbound",
      channel: "email",
      subject: input.subject.slice(0, 200),
      body: input.body,
      status: "QUEUED",
      origin: input.origin,
      send_key: input.sendKey,
    })
    .select("id")
    .single();
  if (messageError?.code === "23505") return { queued: true, channel: "email", detail: "Already queued." };
  if (messageError || !message) return { queued: false, channel: "email", detail: "The email could not be queued." };

  await enqueue(
    "message.send",
    { messageId: (message as { id: string }).id, leadId: row.id, sendKey: input.sendKey },
    { businessId: input.businessId, idempotencyKey: `message.send:${input.sendKey}` },
  );
  return { queued: true, channel: "email", detail: "Queued. Quiet hours and stop conditions are re-checked before it is sent." };
}

export function quoteEmail(input: {
  sellerName: string;
  buyerName: string;
  number: string;
  title: string;
  url: string;
  validUntil: string | null;
  kind: "SENT" | "REMINDER";
}): { subject: string; body: string } {
  const first = input.buyerName.split(" ")[0] || "there";
  const until = input.validUntil ? ` It is valid until ${input.validUntil.slice(0, 10)}.` : "";
  if (input.kind === "REMINDER") {
    return {
      subject: `Reminder: quote ${input.number} from ${input.sellerName}`,
      body: `Hi ${first},\n\nJust a reminder about quote ${input.number} (${input.title}).${until}\n\nYou can view it, and accept it online, here:\n${input.url}\n\n${input.sellerName}`,
    };
  }
  return {
    subject: `Your quote ${input.number} from ${input.sellerName}`,
    body: `Hi ${first},\n\nThank you for your enquiry. Your quote ${input.number} (${input.title}) is ready.${until}\n\nView it, download the PDF and accept it online here:\n${input.url}\n\n${input.sellerName}`,
  };
}

export const quoteEffects: QuoteEffects = {
  async deliverLink(input) {
    if (!input.opportunity.leadId) return { queued: false, channel: "email", detail: "This opportunity has no lead to email." };
    const seller = await createQuoteStore().loadSeller(input.businessId);
    const email = quoteEmail({
      sellerName: seller.name || "Your supplier",
      buyerName: input.opportunity.lead?.name ?? "there",
      number: input.quote.number,
      title: input.quote.title,
      url: input.url,
      validUntil: input.revision.validUntil,
      kind: input.kind,
    });
    return queueLeadEmail({
      businessId: input.businessId,
      leadId: input.opportunity.leadId,
      subject: email.subject,
      body: email.body,
      sendKey: input.sendKey,
      origin: input.origin ?? "manual",
    });
  },
  async enqueue(type, payload, options) {
    await enqueue(type, payload, { businessId: options.businessId, runAt: options.runAt, idempotencyKey: options.idempotencyKey });
  },
  async emit(businessId, type, payload) {
    await emitQuoteEvent(businessId, type, payload);
  },
  publicUrl: quotePublicUrl,
};

export function liveQuoteDeps(businessId: string): QuoteDeps {
  return {
    store: createQuoteStore(),
    effects: quoteEffects,
    can: async (capability: Capability) => {
      const decision = await can(businessId, capability);
      return { allowed: decision.allowed, message: decision.message };
    },
    now: () => new Date(),
  };
}
