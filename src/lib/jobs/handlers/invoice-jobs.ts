import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { enqueue } from "@/lib/jobs/queue";
import { recordAudit } from "@/lib/audit";
import { liveInvoiceDeps, invoiceEffects } from "@/lib/invoicing/store";
import { InvoiceServiceError, issueInvoice } from "@/lib/invoicing/service-core";
import { computeReminderSchedule, nextReminder } from "@/lib/invoicing/reminders";
import { loadQuoteSettings } from "@/lib/quotes/store";
import { checkAutomatedTouchAllowed } from "@/lib/reengagement/service";
import { parsePayload } from "./parse";

/**
 * Invoice jobs (P2).
 *
 * `invoice.issue` issues a scheduled draft on its date (the person who
 * created the invoices from the quote chose automatic issue, and confirmed
 * it). `invoice.remind` sends one payment reminder: it re-reads the invoice,
 * asks `nextReminder` (pure; a job that was down sends only the LATEST due
 * reminder, never a burst), passes the re-engagement frequency guard, and
 * records the step in `invoice_reminders` so a retry never sends it twice.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const issuePayload = z.object({ invoiceId: z.string().uuid() });

export async function handleInvoiceIssue(job: ClaimedJob): Promise<void> {
  const { invoiceId } = parsePayload(issuePayload, job.payload);
  const { data } = await db().from("invoices").select("business_id, status").eq("id", invoiceId).maybeSingle();
  const row = data as { business_id: string; status: string } | null;
  if (!row || row.status !== "DRAFT") return;
  try {
    await issueInvoice(liveInvoiceDeps(row.business_id), row.business_id, { kind: "SYSTEM", userId: null }, { invoiceId, send: true });
  } catch (error) {
    if (error instanceof InvoiceServiceError) {
      console.info("[invoice.issue] not issued", { invoiceId, reason: error.message });
      return;
    }
    throw error;
  }
  await recordAudit({ businessId: row.business_id, actorType: "system", action: "invoice.issued_automatically", entityType: "invoice", entityId: invoiceId });
}

const remindPayload = z.object({ invoiceId: z.string().uuid(), step: z.number().int().min(1).max(20) });

export async function handleInvoiceRemind(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(remindPayload, job.payload);
  const client = db();
  const deps = liveInvoiceDeps("");
  const { data } = await client.from("invoices").select("business_id").eq("id", payload.invoiceId).maybeSingle();
  const businessId = (data as { business_id: string } | null)?.business_id;
  if (!businessId) return;
  const invoice = await deps.store.loadInvoice(businessId, payload.invoiceId);
  if (!invoice || !invoice.issueDate || !invoice.dueDate) return;

  const settings = await loadQuoteSettings(businessId);
  const schedule = computeReminderSchedule({ issueDate: invoice.issueDate, dueDate: invoice.dueDate, offsetsDays: settings.reminderOffsets });
  const { data: sentRows } = await client.from("invoice_reminders").select("step").eq("invoice_id", invoice.id);
  const sentSteps = ((sentRows ?? []) as { step: number }[]).map((row) => row.step);
  const today = new Date().toISOString().slice(0, 10);
  const decision = nextReminder({ schedule, status: invoice.status, sentSteps, today });
  if (!decision.send || decision.step.step !== payload.step) return;

  const record = async (step: number, outcome: "SENT" | "SKIPPED" | "SUPPRESSED") => {
    await client.from("invoice_reminders").insert({ invoice_id: invoice.id, business_id: businessId, step, outcome });
  };
  for (const skipped of decision.skipped) await record(skipped, "SKIPPED");

  const quote = invoice.quoteId ? await deps.store.loadQuoteForInvoicing(businessId, invoice.quoteId) : null;
  const leadId = quote?.leadId ?? null;
  if (!leadId) {
    await record(decision.step.step, "SUPPRESSED");
    return;
  }
  const verdict = await checkAutomatedTouchAllowed({ businessId, leadId, loop: "checkout_nudge" });
  if (verdict.action === "defer") {
    await enqueue("invoice.remind", payload, { businessId, runAt: verdict.at, idempotencyKey: `invoice.remind:${invoice.id}:${payload.step}:${verdict.at.toISOString()}` });
    return;
  }
  if (verdict.action === "skip") {
    await record(decision.step.step, "SUPPRESSED");
    return;
  }

  const delivery = await invoiceEffects.deliverInvoice({ businessId, invoice, leadId, sendKey: `invoice-reminder:${invoice.id}:${decision.step.step}`, kind: "REMINDER" });
  await record(decision.step.step, delivery.queued ? "SENT" : "SUPPRESSED");
  if (decision.step.kind === "OVERDUE" && !sentSteps.some((step) => schedule.find((s) => s.step === step)?.kind === "OVERDUE")) {
    await invoiceEffects.emit(businessId, "invoice.overdue", { invoiceId: invoice.id, number: invoice.number, dueDate: invoice.dueDate, dueMinor: invoice.totalMinor - invoice.paidMinor, leadId });
    await recordAudit({ businessId, actorType: "system", action: "invoice.marked_overdue", entityType: "invoice", entityId: invoice.id });
  }
  await recordAudit({ businessId, actorType: "system", action: "invoice.reminded", entityType: "invoice", entityId: invoice.id, metadata: { step: decision.step.step, queued: delivery.queued } });
}
