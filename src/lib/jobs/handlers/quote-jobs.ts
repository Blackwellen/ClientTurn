import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { enqueue } from "@/lib/jobs/queue";
import { recordAudit } from "@/lib/audit";
import { putObject, quotePdfKey } from "@/lib/storage/r2";
import { renderQuotePdf } from "@/lib/quotes/pdf";
import { emitQuoteEvent } from "@/lib/quotes/events";
import { liveQuoteDeps } from "@/lib/quotes/effects";
import { loadQuoteSettings } from "@/lib/quotes/store";
import { MAX_NUDGES, QuoteServiceError, sendQuote } from "@/lib/quotes/service-core";
import { checkAutomatedTouchAllowed } from "@/lib/reengagement/service";
import type { QuoteRenderModel } from "@/lib/quotes/types";
import { parsePayload } from "./parse";

/**
 * Quote jobs (P2). Each re-reads the quote before acting and is safe to run
 * twice: the PDF is written once per revision (same deterministic bytes, a
 * write-once key), expiry and reminders go through the row-locked
 * `quote_transition` RPC with the expected status, and a reminder is sent
 * only when the re-engagement frequency guard allows it right now.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/* ------------------------------------------------------------ render pdf */

const renderPayload = z.object({ revisionId: z.string().uuid() });

export async function handleQuoteRenderPdf(job: ClaimedJob): Promise<void> {
  const { revisionId } = parsePayload(renderPayload, job.payload);
  const { data } = await db()
    .from("quote_revisions")
    .select("id, business_id, quote_id, render_model, render_hash, pdf_object_key, frozen_at")
    .eq("id", revisionId)
    .maybeSingle();
  const rev = data as {
    id: string;
    business_id: string;
    quote_id: string;
    render_model: QuoteRenderModel | null;
    render_hash: string | null;
    pdf_object_key: string | null;
    frozen_at: string | null;
  } | null;
  if (!rev || !rev.frozen_at || !rev.render_model) return;
  if (rev.pdf_object_key) return;

  const bytes = renderQuotePdf(rev.render_model, { documentHash: rev.render_hash });
  const key = quotePdfKey(rev.business_id, rev.id);
  try {
    await putObject(key, bytes, "application/pdf");
  } catch (error) {
    if (error instanceof Error && error.message === "R2 is not configured") {
      console.warn("[quote.render_pdf] R2 is not configured; the PDF was not stored", { revisionId });
      return;
    }
    throw error;
  }
  await db().from("quote_revisions").update({ pdf_object_key: key }).eq("id", rev.id).is("pdf_object_key", null);
  await recordAudit({
    businessId: rev.business_id,
    actorType: "system",
    action: "quote.pdf_rendered",
    entityType: "quote",
    entityId: rev.quote_id,
    metadata: { revision_id: rev.id, bytes: bytes.byteLength },
  });
}

/* ---------------------------------------------------------------- expire */

const expirePayload = z.object({ quoteId: z.string().uuid(), revisionId: z.string().uuid() });
const LIVE_STATES = ["PENDING_APPROVAL", "APPROVED", "SENT", "VIEWED"];

export async function handleQuoteExpire(job: ClaimedJob): Promise<void> {
  const { quoteId, revisionId } = parsePayload(expirePayload, job.payload);
  const client = db();
  const { data: quote } = await client.from("quotes").select("id, business_id, status, current_revision_id, number, opportunity_id").eq("id", quoteId).maybeSingle();
  const q = quote as { id: string; business_id: string; status: string; current_revision_id: string | null; number: string; opportunity_id: string } | null;
  if (!q || q.current_revision_id !== revisionId || !LIVE_STATES.includes(q.status)) return;
  const { data: revision } = await client.from("quote_revisions").select("valid_until").eq("id", revisionId).maybeSingle();
  const validUntil = (revision as { valid_until: string | null } | null)?.valid_until;
  if (!validUntil) return;
  if (Date.parse(validUntil) >= Date.now()) {
    await enqueue("quote.expire", { quoteId, revisionId }, {
      businessId: q.business_id,
      runAt: new Date(Date.parse(validUntil) + 60_000),
      idempotencyKey: `quote.expire:${revisionId}:${validUntil}`,
    });
    return;
  }
  const { data, error } = await client.rpc("quote_transition", {
    p_business_id: q.business_id,
    p_quote_id: q.id,
    p_action: "EXPIRE",
    p_expected_status: q.status,
    p_actor_kind: "SYSTEM",
    p_action_key: null,
    p_detail: {},
  });
  if (error) throw new Error(`quote.expire: ${error.message}`);
  const result = data as { ok: boolean; reason?: string };
  if (!result.ok) return; // STALE / already moved on: nothing to do.
  const { data: opp } = await client.from("opportunities").select("lead_id").eq("id", q.opportunity_id).maybeSingle();
  const leadId = (opp as { lead_id: string | null } | null)?.lead_id ?? null;
  await emitQuoteEvent(q.business_id, "quote.expired", { quoteId: q.id, number: q.number, leadId }, { leadId, eventId: `quote.expired:${revisionId}` });
  await recordAudit({ businessId: q.business_id, actorType: "system", action: "quote.expired", entityType: "quote", entityId: q.id, metadata: { revision_id: revisionId } });
}

/* ----------------------------------------------------------------- nudge */

const nudgePayload = z.object({ quoteId: z.string().uuid(), revisionId: z.string().uuid(), step: z.number().int().min(1).max(MAX_NUDGES) });

export async function handleQuoteNudge(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(nudgePayload, job.payload);
  const client = db();
  const { data: quote } = await client.from("quotes").select("id, business_id, status, current_revision_id, number, opportunity_id").eq("id", payload.quoteId).maybeSingle();
  const q = quote as { id: string; business_id: string; status: string; current_revision_id: string | null; number: string; opportunity_id: string } | null;
  if (!q || q.current_revision_id !== payload.revisionId || (q.status !== "SENT" && q.status !== "VIEWED")) return;
  const settings = await loadQuoteSettings(q.business_id);
  if (!settings.quoteNudgesEnabled) return;

  const { data: revision } = await client.from("quote_revisions").select("valid_until").eq("id", payload.revisionId).maybeSingle();
  const validUntil = (revision as { valid_until: string | null } | null)?.valid_until ?? null;
  if (validUntil && Date.parse(validUntil) < Date.now() + 12 * 3_600_000) return; // too close to expiry to be useful

  const { data: opp } = await client.from("opportunities").select("lead_id").eq("id", q.opportunity_id).maybeSingle();
  const leadId = (opp as { lead_id: string | null } | null)?.lead_id ?? null;
  if (!leadId) return;

  // The re-engagement frequency guard: never a burst, never over the caps.
  const verdict = await checkAutomatedTouchAllowed({ businessId: q.business_id, leadId, loop: "checkout_nudge" });
  if (verdict.action === "skip") {
    console.info("[quote.nudge] skipped by the frequency guard", { quoteId: q.id, step: payload.step, reason: verdict.reason });
    return;
  }
  if (verdict.action === "defer") {
    await enqueue("quote.nudge", payload, {
      businessId: q.business_id,
      runAt: verdict.at,
      idempotencyKey: `quote.nudge:${payload.revisionId}:${payload.step}:${verdict.at.toISOString()}`,
    });
    return;
  }

  try {
    await sendQuote(
      liveQuoteDeps(q.business_id),
      q.business_id,
      { kind: "SYSTEM", userId: null, role: "admin" },
      { quoteId: q.id, channel: "email", origin: "automation" },
    );
  } catch (error) {
    if (error instanceof QuoteServiceError) {
      console.info("[quote.nudge] not sent", { quoteId: q.id, reason: error.message });
      return;
    }
    throw error;
  }
  await client.from("quote_events").insert({
    business_id: q.business_id,
    quote_id: q.id,
    revision_id: payload.revisionId,
    event_type: "quote.reminded",
    actor_kind: "SYSTEM",
    detail: { step: payload.step },
  });
  await emitQuoteEvent(q.business_id, "quote.reminded", { quoteId: q.id, number: q.number, step: payload.step, leadId }, { leadId });
  await recordAudit({ businessId: q.business_id, actorType: "system", action: "quote.nudged", entityType: "quote", entityId: q.id, metadata: { step: payload.step } });

  if (payload.step < MAX_NUDGES && validUntil) {
    // The second (last) reminder: two days before the quote expires.
    const at = new Date(Date.parse(validUntil) - 2 * 86_400_000);
    if (at.getTime() > Date.now() + 86_400_000) {
      await enqueue("quote.nudge", { ...payload, step: payload.step + 1 }, {
        businessId: q.business_id,
        runAt: at,
        idempotencyKey: `quote.nudge:${payload.revisionId}:${payload.step + 1}`,
      });
    }
  }
}
