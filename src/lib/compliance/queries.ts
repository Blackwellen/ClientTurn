import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EMPTY_DATA_CONTROLS,
  type AllowedSourceKind,
  type DataControls,
  type LawfulBasis,
  type ProspectType,
} from "./types";

/**
 * Reading a workspace's data-control position (Programme §14).
 *
 * A workspace that has never answered gets `EMPTY_DATA_CONTROLS`, which is the
 * most restrictive position rather than a blank one: no permitted sources, no
 * stated basis, no markets. Absence of an answer is not permission, and
 * defaulting to something permissive would mean the safest-looking workspace —
 * the one that never opened Settings — was the least constrained.
 */

export const loadDataControls = cache(
  async (businessId: string): Promise<DataControls> => {
    const db = createAdminClient();
    const { data } = await db
      .from("business_data_controls")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();

    if (!data) return EMPTY_DATA_CONTROLS;

    return {
      legalName: data.legal_name,
      registeredCountry: data.registered_country,
      registeredAddress: data.registered_address,
      privacyPolicyUrl: data.privacy_policy_url,
      privacyContactEmail: data.privacy_contact_email,
      dpoContact: data.dpo_contact,
      prospectCountries: data.prospect_countries ?? [],
      prospectType: (data.prospect_type ?? "B2B") as ProspectType,
      allowedSources: (data.allowed_sources ?? []) as AllowedSourceKind[],
      marketingLawfulBasis: (data.marketing_lawful_basis ?? "UNSTATED") as LawfulBasis,
      lawfulBasisNote: data.lawful_basis_note,
      basisReviewedAt: data.basis_reviewed_at,
      retainUncontactedProspectsDays: data.retain_uncontacted_prospects_days,
      retainInactiveLeadsDays: data.retain_inactive_leads_days,
      retainRawEventsDays: data.retain_raw_events_days,
      socialAutonomousSending: data.social_autonomous_sending ?? false,
      socialAutoPromoteOnReply: data.social_auto_promote_on_reply ?? false,
      socialWithdrawAfterDays: data.social_withdraw_after_days ?? 21,
      socialFollowUpGapHours: data.social_follow_up_gap_hours ?? 96,
      socialMaxFollowUps: data.social_max_follow_ups ?? 2,
      sourcingStrictness: (data.sourcing_strictness ?? "BALANCED") as DataControls["sourcingStrictness"],
      requireRegistryMatch: data.require_registry_match ?? false,
      updatedAt: data.updated_at,
    };
  },
);

/* ------------------------------------------------------------ suppression */

export type SuppressionRow = {
  id: string;
  email: string | null;
  channel: string;
  reason: string;
  source: string;
  note: string | null;
  createdAt: string;
};

/**
 * The workspace's own suppression list.
 *
 * Read-only here on purpose. An entry is created by someone opting out, and
 * removing it is not an ordinary settings edit — it is a decision to contact
 * somebody who asked not to be contacted. That belongs to platform support with
 * an audited reason (`admin.suppression_removed` already exists), not to a
 * delete button in a customer's settings page.
 */
export async function listSuppressions(
  businessId: string,
  limit = 100,
): Promise<SuppressionRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("suppression_entries")
    .select("id, email, channel, reason, source, note, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    channel: row.channel,
    reason: row.reason,
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export type SuppressionSummary = {
  total: number;
  byReason: { reason: string; count: number }[];
};

export async function suppressionSummary(
  businessId: string,
): Promise<SuppressionSummary> {
  const db = createAdminClient();
  const { data } = await db
    .from("suppression_entries")
    .select("reason")
    .eq("business_id", businessId)
    .limit(5000);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }

  return {
    total: data?.length ?? 0,
    byReason: [...counts]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/* -------------------------------------------------------------- evidence */

export type ComplianceEvidence = {
  /** Decisions recorded in the last 30 days, and how they came out. */
  decisions: { result: string; count: number }[];
  activePolicyVersions: { name: string; version: string }[];
};

/**
 * What the workspace can show if asked "why did you contact this person".
 *
 * Every send already writes a `contactability_results` row with the policy
 * version and an evidence snapshot. This surfaces that it exists — a compliance
 * story nobody can see is one nobody trusts.
 */
export async function complianceEvidence(
  businessId: string,
): Promise<ComplianceEvidence> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: results }, { data: packs }] = await Promise.all([
    db
      .from("contactability_results")
      .select("result")
      .eq("business_id", businessId)
      .gte("evaluated_at", since)
      .limit(5000),
    db
      .from("compliance_policy_versions")
      .select("name, version")
      .eq("status", "ACTIVE"),
  ]);

  const counts = new Map<string, number>();
  for (const row of results ?? []) {
    counts.set(row.result, (counts.get(row.result) ?? 0) + 1);
  }

  return {
    decisions: [...counts]
      .map(([result, count]) => ({ result, count }))
      .sort((a, b) => b.count - a.count),
    activePolicyVersions: (packs ?? []).map((pack) => ({
      name: pack.name,
      version: pack.version,
    })),
  };
}
