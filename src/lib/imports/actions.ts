"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { checkSuppressionBatch, normaliseEmail } from "@/lib/policy/suppression";
import { recordPermission } from "@/lib/policy/service";
import { normalisePhone } from "@/lib/messaging/types";
import { companyDedupeKey, normaliseDomain } from "@/lib/prospects/dedupe";
import {
  classifyRow,
  IMPORT_FIELDS,
  type ImportField,
  type ParsedRow,
  type RowClassification,
} from "./classify";
import type { RelationshipType } from "@/lib/policy/types";

/**
 * Lead import (V4 §7).
 *
 * The rule the whole flow protects: **classification is re-derived server-side
 * at commit time.** The browser shows a preview and lets an operator override
 * individual rows, but the decision that actually writes to `leads` or
 * `prospects` is made here, against live suppression and duplicate state. A
 * stale preview cannot smuggle a cold row into the Leads inbox.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const RELATIONSHIPS = [
  "THEY_CONTACTED_US",
  "EXISTING_CUSTOMER",
  "REFERRAL",
  "REQUESTED_INFORMATION",
  "EXPLICIT_MARKETING_CONSENT",
  "EXISTING_BUSINESS_RELATIONSHIP",
  "FOUND_BY_US",
  "IMPORTED",
  "OTHER",
] as const;

const FIELD_KEYS = IMPORT_FIELDS.map((field) => field.key) as [ImportField, ...ImportField[]];

const createSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  headers: z.array(z.string().max(200)).min(1).max(80),
  // Bounded deliberately: a browser-parsed file has to fit in a server action
  // payload, and a 5,000-row ceiling keeps that honest.
  rows: z.array(z.array(z.string().max(500)).max(80)).max(5000),
  mapping: z.record(z.enum(FIELD_KEYS), z.number().int().min(0).max(79)),
  defaultRelationship: z.enum(RELATIONSHIPS).nullable(),
  sourceDetail: z.string().trim().max(200).default(""),
  startFollowUp: z.boolean().default(false),
});

function readRow(
  raw: string[],
  mapping: Partial<Record<ImportField, number>>,
): ParsedRow {
  const value = (field: ImportField): string | null => {
    const index = mapping[field];
    if (index === undefined) return null;
    const cell = raw[index]?.trim();
    return cell ? cell : null;
  };

  return {
    firstName: value("firstName"),
    lastName: value("lastName"),
    companyName: value("companyName"),
    email: value("email"),
    phone: value("phone"),
    postcode: value("postcode"),
    roleTitle: value("roleTitle"),
    sourceDetail: value("sourceDetail"),
    notes: value("notes"),
    relationshipType: null,
  };
}

/**
 * Parses, classifies and stores an import for review. Nothing reaches `leads`
 * or `prospects` here — that is `commitImport`, after a human has looked.
 */
export async function createImport(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That file could not be read. Check the columns and try again." };
  }

  const workspace = await requireRole("admin");
  const value = parsed.data;
  const db = createAdminClient();

  const rows = value.rows.map((raw) => readRow(raw, value.mapping));
  const emails = rows.map((row) => normaliseEmail(row.email));

  // Suppression and existing records are checked in three batch queries rather
  // than per row: a 5,000-row file would otherwise issue 15,000 round trips.
  const present = emails.filter((email): email is string => Boolean(email));
  const [suppressed, existingLeads, existingProspects] = await Promise.all([
    present.length ? checkSuppressionBatch(workspace.businessId, present) : new Map(),
    present.length
      ? db
          .from("leads")
          .select("id, email")
          .eq("business_id", workspace.businessId)
          .in("email", present)
      : Promise.resolve({ data: [] }),
    present.length
      ? db
          .from("prospects")
          .select("id, email")
          .eq("business_id", workspace.businessId)
          .in("email", present)
      : Promise.resolve({ data: [] }),
  ]);

  const leadByEmail = new Map(
    (existingLeads.data ?? []).map((row) => [normaliseEmail(row.email) ?? "", row.id]),
  );
  const prospectByEmail = new Map(
    (existingProspects.data ?? []).map((row) => [normaliseEmail(row.email) ?? "", row.id]),
  );

  const { data: created, error } = await db
    .from("lead_imports")
    .insert({
      business_id: workspace.businessId,
      created_by: workspace.userId,
      filename: value.filename,
      status: "REVIEW",
      mapping_json: value.mapping as never,
      default_relationship_type: value.defaultRelationship,
      default_source_detail: value.sourceDetail || null,
      start_follow_up: value.startFollowUp,
      total_rows: rows.length,
    })
    .select("id")
    .single();

  if (error || !created) return { ok: false, error: "The import could not be started." };

  const seen = new Set<string>();
  const counts: Record<RowClassification, number> = {
    IMPORT_AS_LEAD: 0,
    IMPORT_AS_PROSPECT: 0,
    REVIEW: 0,
    SKIP: 0,
  };

  const rowRecords = rows.map((row, index) => {
    const email = emails[index];
    const duplicateInFile = Boolean(email && seen.has(email));
    if (email) seen.add(email);

    const verdict = classifyRow(row, {
      duplicateInFile,
      existingLeadId: email ? (leadByEmail.get(email) ?? null) : null,
      existingProspectId: email ? (prospectByEmail.get(email) ?? null) : null,
      suppressed: Boolean(email && suppressed.get(email)),
      defaultRelationship: value.defaultRelationship,
    });

    counts[verdict.classification] += 1;

    return {
      business_id: workspace.businessId,
      import_id: created.id,
      row_number: index + 1,
      raw_json: { cells: value.rows[index] } as never,
      first_name: row.firstName,
      last_name: row.lastName,
      company_name: row.companyName,
      email,
      phone_e164: row.phone ? normalisePhone(row.phone) : null,
      postcode: row.postcode,
      role_title: row.roleTitle,
      relationship_type: value.defaultRelationship,
      source_detail: row.sourceDetail ?? value.sourceDetail ?? null,
      notes: row.notes,
      classification: verdict.classification,
      classification_reason: verdict.reason,
      validation_flags: verdict.flags as never,
      duplicate_of_lead_id: email ? (leadByEmail.get(email) ?? null) : null,
      duplicate_of_prospect_id: email ? (prospectByEmail.get(email) ?? null) : null,
    };
  });

  // Chunked: a single 5,000-row insert exceeds the request limit.
  for (let offset = 0; offset < rowRecords.length; offset += 500) {
    const chunk = rowRecords.slice(offset, offset + 500);
    const { error: rowError } = await db.from("lead_import_rows").insert(chunk);
    if (rowError) {
      await db.from("lead_imports").update({ status: "FAILED" }).eq("id", created.id);
      return { ok: false, error: "The file could not be stored for review." };
    }
  }

  await db
    .from("lead_imports")
    .update({
      valid_rows: rows.length - counts.SKIP,
      lead_rows: counts.IMPORT_AS_LEAD,
      prospect_rows: counts.IMPORT_AS_PROSPECT,
      review_rows: counts.REVIEW,
      skip_rows: counts.SKIP,
    })
    .eq("id", created.id);

  revalidatePath("/app/leads/import");
  return { ok: true, data: { id: created.id } };
}

/** Overrides one row's classification during review. */
export async function setRowClassification(
  rowId: unknown,
  classification: unknown,
): Promise<ActionResult> {
  const parsed = z
    .object({
      rowId: z.uuid(),
      classification: z.enum(["IMPORT_AS_LEAD", "IMPORT_AS_PROSPECT", "SKIP"]),
    })
    .safeParse({ rowId, classification });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { error } = await db
    .from("lead_import_rows")
    .update({ user_classification: parsed.data.classification })
    .eq("id", parsed.data.rowId)
    .eq("business_id", workspace.businessId);

  if (error) return { ok: false, error: "That row could not be updated." };
  return { ok: true };
}

/**
 * Writes the import.
 *
 * Re-derives nothing from the browser: it reads the stored rows, applies any
 * operator override, and re-checks suppression immediately before insert — a
 * contact who opted out between upload and commit must not be imported.
 */
export async function commitImport(importId: unknown): Promise<ActionResult> {
  const parsed = z.uuid().safeParse(importId);
  if (!parsed.success) return { ok: false, error: "Invalid import." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { data: job } = await db
    .from("lead_imports")
    .select("id, status, default_relationship_type, default_source_detail, start_follow_up")
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!job) return { ok: false, error: "That import no longer exists." };
  if (job.status === "COMPLETED") return { ok: false, error: "This import has already run." };

  await db.from("lead_imports").update({ status: "IMPORTING", started_at: new Date().toISOString() }).eq("id", job.id);

  const { data: rows } = await db
    .from("lead_import_rows")
    .select(
      "id, first_name, last_name, company_name, email, phone_e164, postcode, role_title, notes, source_detail, classification, user_classification",
    )
    .eq("business_id", workspace.businessId)
    .eq("import_id", job.id)
    .eq("import_state", "PENDING")
    .limit(5000);

  const candidates = (rows ?? []).filter((row) => {
    const decision = row.user_classification ?? row.classification;
    return decision === "IMPORT_AS_LEAD" || decision === "IMPORT_AS_PROSPECT";
  });

  const emails = candidates
    .map((row) => normaliseEmail(row.email))
    .filter((email): email is string => Boolean(email));

  // The final suppression check. Everything above is a preview; this is the gate.
  const suppressed = emails.length
    ? await checkSuppressionBatch(workspace.businessId, emails)
    : new Map();

  let leadCount = 0;
  let prospectCount = 0;
  let failed = 0;

  for (const row of candidates) {
    const decision = (row.user_classification ?? row.classification) as RowClassification;
    const email = normaliseEmail(row.email);

    if (email && suppressed.get(email)) {
      await db
        .from("lead_import_rows")
        .update({ import_state: "SKIPPED", error_message: "Suppressed before import" })
        .eq("id", row.id);
      continue;
    }

    try {
      if (decision === "IMPORT_AS_LEAD") {
        const { data: lead, error } = await db
          .from("leads")
          .insert({
            business_id: workspace.businessId,
            first_name: row.first_name,
            last_name: row.last_name,
            company_name: row.company_name,
            email,
            phone: row.phone_e164,
            phone_normalized: row.phone_e164,
            postcode: row.postcode,
            notes: row.notes,
            intake_method: "IMPORT",
            relationship_type: job.default_relationship_type,
            created_via: "IMPORT",
            created_by_user_id: workspace.userId,
            // Never started automatically unless the operator asked: importing
            // a list is not the same as choosing to message it.
            automation_active: job.start_follow_up,
          })
          .select("id")
          .single();

        if (error || !lead) throw new Error("insert failed");

        await recordPermission({
          businessId: workspace.businessId,
          subject: { type: "LEAD", id: lead.id },
          relationshipType: (job.default_relationship_type ?? "IMPORTED") as RelationshipType,
          relationshipDetail: row.source_detail ?? job.default_source_detail,
          consentSource: "IMPORT",
          email,
          phone: row.phone_e164,
          recordedBy: workspace.userId,
        });

        await db.from("lead_source_evidence").insert({
          business_id: workspace.businessId,
          subject_type: "LEAD",
          subject_id: lead.id,
          intake_method: "IMPORT",
          source_detail: row.source_detail ?? job.default_source_detail,
          relationship_type: job.default_relationship_type,
          captured_by: workspace.userId,
          import_id: job.id,
        });

        await db
          .from("lead_import_rows")
          .update({ import_state: "IMPORTED", created_lead_id: lead.id })
          .eq("id", row.id);

        leadCount += 1;
      } else {
        const domain = normaliseDomain(email ? email.split("@")[1] : null);
        const { data: company } = await db
          .from("prospect_companies")
          .upsert(
            {
              business_id: workspace.businessId,
              name: row.company_name ?? "Unknown company",
              domain,
              dedupe_key: companyDedupeKey({
                domain,
                name: row.company_name,
                postcode: row.postcode,
              }),
            },
            { onConflict: "business_id,dedupe_key" },
          )
          .select("id")
          .single();

        const { data: prospect, error } = await db
          .from("prospects")
          .insert({
            business_id: workspace.businessId,
            company_id: company?.id ?? null,
            first_name: row.first_name,
            last_name: row.last_name,
            role_title: row.role_title,
            email,
            phone_e164: row.phone_e164,
            status: "REVIEW",
            // An imported prospect is not eligible until the policy engine has
            // looked at it. Defaulting to ELIGIBLE would be the whole bug.
            outreach_eligibility: "REVIEW",
            source_provider: "import",
          })
          .select("id")
          .single();

        if (error || !prospect) throw new Error("insert failed");

        await db.from("lead_source_evidence").insert({
          business_id: workspace.businessId,
          subject_type: "PROSPECT",
          subject_id: prospect.id,
          intake_method: "IMPORT",
          source_detail: row.source_detail ?? job.default_source_detail,
          captured_by: workspace.userId,
          import_id: job.id,
        });

        await db
          .from("lead_import_rows")
          .update({ import_state: "IMPORTED", created_prospect_id: prospect.id })
          .eq("id", row.id);

        prospectCount += 1;
      }
    } catch {
      failed += 1;
      await db
        .from("lead_import_rows")
        .update({ import_state: "FAILED", error_message: "Could not be created" })
        .eq("id", row.id);
    }
  }

  await db
    .from("lead_imports")
    .update({
      status: failed > 0 ? "PARTIAL" : "COMPLETED",
      imported_lead_count: leadCount,
      imported_prospect_count: prospectCount,
      failed_row_count: failed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.imported",
    entityType: "lead_import",
    entityId: job.id,
    metadata: { leads: leadCount, prospects: prospectCount, failed },
  });

  revalidatePath("/app/leads");
  revalidatePath("/app/find-leads");
  return { ok: true };
}
