import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseEmail } from "@/lib/email/account";
import { suppress } from "@/lib/policy/suppression";
import { isUnsubscribeToken } from "./unsubscribe-links";

/**
 * Unsubscribe by token — the one implementation behind both the RFC 8058
 * one-click POST (`/api/unsubscribe/[token]`) and the confirm button on the
 * visible page (`/unsubscribe/[token]`).
 *
 * The token is a per-lead (or per-prospect) random value, so knowing it proves
 * the holder received the mail. No login, no lookup by email address, and no
 * way to enumerate other leads.
 *
 * Only ever run on POST. A GET is fetched by link scanners and mail-client
 * previews without anyone clicking, and must not unsubscribe anybody.
 *
 * Idempotent: every write either sets a terminal value or is a suppression
 * insert that treats "already suppressed" as success, so a second POST for the
 * same token reports success and changes nothing.
 */

export type UnsubscribeResult =
  | { ok: true; business: string }
  | { ok: false; reason: "invalid" | "error" };

/**
 * `unsubscribed` is whether this record has already opted out. The page reads
 * it so `?status=done` can only show "You've been unsubscribed" when that is
 * true (surface QA 2026-09-30: the query string alone used to decide).
 */
type Subject =
  | { kind: "lead"; id: string; businessId: string; email: string | null; business: string; unsubscribed: boolean }
  | { kind: "prospect"; id: string; businessId: string; email: string | null; business: string; unsubscribed: boolean };

function businessName(value: unknown): string {
  const business = value as { name?: string } | null;
  return business?.name ?? "this business";
}

/**
 * Who a token belongs to, without changing anything. The GET page uses this to
 * name the business on its confirm screen.
 */
export async function findUnsubscribeSubject(
  token: string,
): Promise<Subject | null | "error"> {
  if (!isUnsubscribeToken(token)) return null;

  const admin = createAdminClient();

  // `unsubscribe_token` is added by migration 0039. `database.types.ts` is
  // generated from the deployed schema, so the column is absent from the
  // generated types until that migration has been applied and the types
  // regenerated. The filter column is narrowed here rather than casting the
  // whole query, so the selected columns stay fully typed.
  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("id, business_id, email, opted_out, businesses ( name )")
    .eq("unsubscribe_token" as "id", token)
    .maybeSingle();
  if (leadError) return "error";

  if (lead) {
    return {
      kind: "lead",
      id: lead.id,
      businessId: lead.business_id,
      email: lead.email,
      business: businessName(lead.businesses),
      unsubscribed: lead.opted_out === true,
    };
  }

  // A token that is not a lead may be a prospect: cold outreach carries the
  // same one-click unsubscribe, and it has to actually work.
  const { data: prospect, error: prospectError } = await admin
    .from("prospects")
    .select("id, business_id, email, status, businesses ( name )")
    .eq("unsubscribe_token" as "id", token)
    .maybeSingle();
  if (prospectError) return "error";

  if (!prospect) return null;
  return {
    kind: "prospect",
    id: prospect.id,
    businessId: prospect.business_id,
    email: prospect.email,
    business: businessName(prospect.businesses),
    unsubscribed: prospect.status === "UNSUBSCRIBED",
  };
}

export async function performUnsubscribe(token: string): Promise<UnsubscribeResult> {
  const subject = await findUnsubscribeSubject(token);
  if (subject === "error") return { ok: false, reason: "error" };
  if (!subject) return { ok: false, reason: "invalid" };

  try {
    if (subject.kind === "lead") await unsubscribeLead(subject);
    else await unsubscribeProspect(subject);
  } catch (error) {
    console.error("[unsubscribe] failed", {
      kind: subject.kind,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "error" };
  }

  return { ok: true, business: subject.business };
}

async function unsubscribeLead(subject: Subject) {
  const admin = createAdminClient();

  // Suppression first: it is the write every send path reads, so if a later
  // write fails the person is already protected.
  //
  // The address itself, not just the lead, so a second lead record with the
  // same address cannot be mailed either. Channel ALL: someone using an
  // unsubscribe link is asking not to be contacted, and honouring that only on
  // the channel the link arrived by is a reading nobody intends.
  const email = normaliseEmail(subject.email);
  if (email) {
    await suppress({
      businessId: subject.businessId,
      channel: "ALL",
      reason: "OPT_OUT",
      source: "UNSUBSCRIBE_LINK",
      email,
    });
  }

  const { error: leadError } = await admin
    .from("leads")
    .update({ opted_out: true, automation_active: false })
    .eq("id", subject.id);
  if (leadError) throw leadError;

  const { error: contactsError } = await admin
    .from("campaign_contacts")
    .update({ state: "stopped", stopped_reason: "opted_out" })
    .eq("lead_id", subject.id)
    .in("state", ["pending", "scheduled"]);
  if (contactsError) throw contactsError;
}

/**
 * The prospect half of unsubscribe.
 *
 * Suppression is written first and at workspace scope, not just on the one
 * prospect row: the point of an opt-out is that the *address* stops being
 * contactable, including by a future sourcing run that rediscovers the same
 * person at the same company.
 */
async function unsubscribeProspect(subject: Subject) {
  const admin = createAdminClient();

  const email = normaliseEmail(subject.email);
  if (email) {
    await suppress({
      businessId: subject.businessId,
      channel: "ALL",
      reason: "OPT_OUT",
      source: "UNSUBSCRIBE_LINK",
      email,
    });
  }

  const { error: prospectError } = await admin
    .from("prospects")
    .update({
      status: "UNSUBSCRIBED",
      outreach_eligibility: "SUPPRESSED",
      eligibility_reason: "Unsubscribed",
      campaign_id: null,
    })
    .eq("id", subject.id);
  if (prospectError) throw prospectError;

  const { error: runsError } = await admin
    .from("outreach_recipient_runs")
    .update({
      status: "STOPPED",
      stop_reason: "OPTED_OUT",
      stopped_at: new Date().toISOString(),
    })
    .eq("prospect_id", subject.id)
    .in("status", ["PENDING", "SCHEDULED", "ACTIVE"]);
  if (runsError) throw runsError;
}
