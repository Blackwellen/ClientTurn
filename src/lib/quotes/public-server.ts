import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { can } from "@/lib/billing/capabilities";
import { parseAuthority } from "@/lib/commercial/authority";
import { createDownloadUrl } from "@/lib/storage/r2";
import { emitQuoteEvent } from "./events";
import { loadQuoteSettings } from "./store";
import { hashToken, verifyPublicToken } from "./tokens";
import { signatureRpcPayload, type NextStep, type PublicDeps, type PublicQuoteContext } from "./public-sign";
import type { QuoteState } from "./lifecycle";
import type { QuoteRenderModel } from "./types";

/**
 * The live dependencies of the public quote page and its two POST handlers.
 * Service role throughout: the anonymous visitor has no database identity,
 * so every read is by the token's hash and every write is one of the 0153
 * RPCs (which re-check status, revision, expiry and hashes under a row lock).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/** HMAC key for the page's form nonce. No dedicated secret is provisioned, so
 *  it falls back to the service-role key, as google-login.ts and step-up do. */
export function quoteFormSecret(): string {
  return process.env.QUOTE_FORM_SECRET || serverEnv.supabase.serviceRoleKey;
}

export function allowedOrigins(): string[] {
  const origins = new Set<string>();
  try {
    origins.add(new URL(serverEnv.siteUrl).origin);
  } catch {
    // siteUrl is always set (defaults to localhost).
  }
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.NODE_ENV !== "production") origins.add("http://localhost:3000");
  return [...origins];
}

/** Resolve a token to its quote, VERIFIED (hash lookup, constant-time compare, not revoked or expired, current revision). */
export async function resolvePublicQuote(token: string): Promise<PublicQuoteContext | null> {
  const client = db();
  const { data: tokenRow } = await client
    .from("quote_access_tokens")
    .select("business_id, quote_id, revision_id, token_hash, purpose, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  const row = tokenRow as {
    business_id: string;
    quote_id: string;
    revision_id: string;
    token_hash: string;
    purpose: "VIEW_AND_SIGN" | "VIEW_ONLY";
    expires_at: string;
    revoked_at: string | null;
  } | null;
  if (!row) return null;

  const { data: quote } = await client
    .from("quotes")
    .select("id, status, current_revision_id, opportunity_id")
    .eq("id", row.quote_id)
    .eq("business_id", row.business_id)
    .maybeSingle();
  const q = quote as { id: string; status: QuoteState; current_revision_id: string | null; opportunity_id: string } | null;
  if (!q) return null;
  const check = verifyPublicToken(
    token,
    { tokenHash: row.token_hash, revisionId: row.revision_id, expiresAt: row.expires_at, revokedAt: row.revoked_at },
    new Date().toISOString(),
    q.current_revision_id ?? undefined,
  );
  if (!check.ok) return null;

  const { data: revision } = await client
    .from("quote_revisions")
    .select("id, render_model, render_hash, calculation_hash, valid_until, first_viewed_at, frozen_at")
    .eq("id", row.revision_id)
    .eq("business_id", row.business_id)
    .maybeSingle();
  const rev = revision as {
    id: string;
    render_model: QuoteRenderModel | null;
    render_hash: string | null;
    calculation_hash: string;
    valid_until: string | null;
    first_viewed_at: string | null;
    frozen_at: string | null;
  } | null;
  if (!rev?.frozen_at || !rev.render_model || !rev.render_hash) return null;

  const { data: opp } = await client.from("opportunities").select("lead_id").eq("id", q.opportunity_id).maybeSingle();
  const [settings, esign] = await Promise.all([loadQuoteSettings(row.business_id), can(row.business_id, "esign_enabled").catch(() => null)]);

  return {
    businessId: row.business_id,
    quoteId: q.id,
    revisionId: rev.id,
    quoteStatus: q.status,
    renderModel: rev.render_model,
    renderHash: rev.render_hash,
    calculationHash: rev.calculation_hash,
    validUntil: rev.valid_until,
    firstViewedAt: rev.first_viewed_at,
    purpose: row.purpose,
    leadId: (opp as { lead_id: string | null } | null)?.lead_id ?? null,
    esignEnabled: Boolean(esign?.allowed),
    requireDrawnSignature: settings.requireDrawnSignature,
  };
}

/** What the public page shows through the anonymous RPC (0153 quote_public_view). */
export async function publicView(token: string): Promise<{
  revisionId: string;
  status: QuoteState;
  validUntil: string | null;
  renderModel: QuoteRenderModel;
  renderHash: string;
  canSign: boolean;
} | null> {
  const { data, error } = await db().rpc("quote_public_view", { p_token: token });
  if (error || !data) return null;
  const view = data as { revision_id: string; status: QuoteState; valid_until: string | null; render_model: QuoteRenderModel; render_hash: string; can_sign: boolean };
  return {
    revisionId: view.revision_id,
    status: view.status,
    validUntil: view.valid_until,
    renderModel: view.render_model,
    renderHash: view.render_hash,
    canSign: view.can_sign,
  };
}

/** The workspace logo for the page header: a fresh signed URL (never sealed into the document). */
export async function publicLogoUrl(businessId: string): Promise<string | null> {
  const { data } = await db().from("businesses").select("logo_key").eq("id", businessId).maybeSingle();
  const key = (data as { logo_key: string | null } | null)?.logo_key;
  if (!key) return null;
  try {
    return await createDownloadUrl(key, 600);
  } catch {
    return null;
  }
}

/** The PDF of the revision, when the job has rendered it. */
export async function publicPdfUrl(context: PublicQuoteContext): Promise<string | null> {
  const { data } = await db().from("quote_revisions").select("pdf_object_key").eq("id", context.revisionId).eq("business_id", context.businessId).maybeSingle();
  const key = (data as { pdf_object_key: string | null } | null)?.pdf_object_key;
  if (!key) return null;
  try {
    return await createDownloadUrl(key, 300);
  } catch {
    return null;
  }
}

/**
 * After acceptance: the payment step, using the workspace's existing
 * direct-sale checkout link (the opportunity's, or the first quoted item's)
 * when direct close is available. No Stripe object is created here: the link
 * is the customer's own, registered in commercial authority.
 */
export async function paymentNextStep(context: PublicQuoteContext): Promise<NextStep> {
  const noPayment: NextStep = { kind: "NONE", message: "Thank you. We have your acceptance and will be in touch about the next steps." };
  const direct = await can(context.businessId, "direct_close_enabled").catch(() => null);
  if (!direct?.allowed) return noPayment;
  const client = db();
  const { data: authorityRow } = await client.from("commercial_authority").select("*").eq("business_id", context.businessId).maybeSingle();
  const authority = parseAuthority(authorityRow);
  if (authority.approved_checkout_links.length === 0) return noPayment;

  const { data: quote } = await client.from("quotes").select("opportunity_id").eq("id", context.quoteId).maybeSingle();
  const { data: opp } = quote
    ? await client.from("opportunities").select("checkout_link_id").eq("id", (quote as { opportunity_id: string }).opportunity_id).maybeSingle()
    : { data: null };
  let linkId = (opp as { checkout_link_id: string | null } | null)?.checkout_link_id ?? null;
  if (!linkId) {
    const { data: lines } = await client.from("quote_line_items").select("item_id").eq("revision_id", context.revisionId).not("item_id", "is", null);
    const ids = ((lines ?? []) as { item_id: string }[]).map((l) => l.item_id);
    if (ids.length > 0) {
      const { data: items } = await client.from("catalogue_items").select("checkout_link_id").in("id", ids).not("checkout_link_id", "is", null).limit(1);
      linkId = ((items ?? []) as { checkout_link_id: string }[])[0]?.checkout_link_id ?? null;
    }
  }
  const link = authority.approved_checkout_links.find((candidate) => candidate.id === linkId);
  if (!link) return noPayment;
  const amount = context.renderModel.deposit ?? context.renderModel.firstPayment;
  return { kind: "PAY", label: context.renderModel.deposit ? `Pay the ${amount} deposit` : `Pay ${amount} now`, url: link.url };
}

const AUDIT_ACTION = {
  "quote.accepted": "quote.customer_accepted",
  "quote.signed": "quote.customer_signed",
  "quote.viewed": "quote.customer_viewed",
} as const;

export function livePublicDeps(): PublicDeps {
  return {
    now: () => new Date(),
    secret: quoteFormSecret(),
    allowedOrigins: allowedOrigins(),
    rateLimited: async (clientId) => !(await checkRateLimit("quote:public", clientId)).allowed,
    resolve: resolvePublicQuote,
    async accept({ context, actionKey, evidence }) {
      const { data, error } = await db().rpc("quote_transition", {
        p_business_id: context.businessId,
        p_quote_id: context.quoteId,
        p_action: "ACCEPT",
        p_expected_status: context.quoteStatus,
        p_actor_kind: "CUSTOMER",
        p_action_key: actionKey,
        p_detail: {},
      });
      if (error) return { ok: false, reason: "RPC_ERROR" };
      const result = data as { ok: boolean; duplicate?: boolean; reason?: string };
      if (result.ok && !result.duplicate) {
        await db().from("quote_acceptance_events").insert({
          business_id: context.businessId,
          quote_id: context.quoteId,
          revision_id: context.revisionId,
          action: "ACCEPT",
          document_hash: evidence.documentHash,
          actor_email: evidence.email,
          ip: evidence.ip === "0.0.0.0" ? null : evidence.ip,
          user_agent: evidence.userAgent,
        });
      }
      return result;
    },
    async recordSignature({ context, actionKey, record }) {
      const { data, error } = await db().rpc("quote_record_signature", {
        p_business_id: context.businessId,
        p_quote_id: context.quoteId,
        p_revision_id: context.revisionId,
        p_expected_status: "ACCEPTED",
        p_action_key: actionKey,
        p_signature: signatureRpcPayload(record),
      });
      if (error) {
        console.error("[quote sign] signature not recorded", { quoteId: context.quoteId, code: error.code });
        return { ok: false, reason: "RPC_ERROR" };
      }
      return data as { ok: boolean; duplicate?: boolean; reason?: string };
    },
    async markViewed(context) {
      const { data, error } = await db().rpc("quote_transition", {
        p_business_id: context.businessId,
        p_quote_id: context.quoteId,
        p_action: "MARK_VIEWED",
        p_expected_status: "SENT",
        p_actor_kind: "CUSTOMER",
        p_action_key: null,
        p_detail: {},
      });
      const result = (error ? null : data) as { ok: boolean; to?: string } | null;
      return { firstView: Boolean(result?.ok && result.to === "VIEWED") };
    },
    nextStep: paymentNextStep,
    async emit(context, type) {
      await emitQuoteEvent(context.businessId, type, {
        quoteId: context.quoteId,
        number: context.renderModel.quote.number,
        revision: context.renderModel.quote.revision,
        leadId: context.leadId,
      }, { leadId: context.leadId, eventId: `${type}:${context.revisionId}` });
      await recordAudit({
        businessId: context.businessId,
        actorType: "system",
        action: AUDIT_ACTION[type],
        entityType: "quote",
        entityId: context.quoteId,
        metadata: { actor: "customer", revision_id: context.revisionId },
      });
    },
  };
}
