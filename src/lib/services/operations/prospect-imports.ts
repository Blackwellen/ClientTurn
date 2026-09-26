import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { companyDedupeKey } from "@/lib/prospects/dedupe";
import {
  LINKEDIN_SURFACES,
  parseLinkedinExport,
  type LinkedinSurface,
} from "@/lib/find-leads/linkedin-import";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * `prospect.import_linkedin_list`: the customer's own LinkedIn export, written
 * where the LinkedIn adapter's ingested-list route reads it.
 *
 * Before this existed the adapter read `prospect_data_sources` rows with
 * provider `linkedin_sales_navigator` and field `linkedin_lead`, and nothing
 * wrote them, so without a partner token that route always returned nothing.
 *
 * Each row becomes one `linkedin_lead` provenance row on its company:
 *
 *   * source_type IMPORT, and policy tags that say it was customer supplied
 *     and which surface (Sales Navigator or a standard account) it came from;
 *   * the value blob in exactly the shape `readIngestedList` reads;
 *   * no phone number, ever -- the parser drops the column before this sees it.
 *
 * Re-importing the same file adds nothing: a row whose company and profile URL
 * (or, without one, name) is already held is counted as a duplicate.
 */

const MAX_CSV_BYTES = 5_000_000;
const INSERT_CHUNK = 500;

type ImportArgs = {
  csv: string;
  surface: LinkedinSurface | null;
  fileName: string | null;
};

type ImportData = {
  surface: LinkedinSurface;
  imported: number;
  duplicates: number;
  rejected: number;
  companies: number;
  errors: { row: number; message: string }[];
  discardedColumns: string[];
};

function leadKey(companyId: string, blob: { publicProfileUrl?: unknown; firstName?: unknown; lastName?: unknown }): string {
  const url = typeof blob.publicProfileUrl === "string" ? blob.publicProfileUrl.toLowerCase().replace(/\/+$/, "") : "";
  if (url) return `${companyId}|${url}`;
  return `${companyId}|${String(blob.firstName ?? "").toLowerCase()} ${String(blob.lastName ?? "").toLowerCase()}`;
}

defineOperation("prospect.import_linkedin_list", {
  schema: z.object({
    csv: z.string().min(1).max(MAX_CSV_BYTES),
    surface: z.enum(LINKEDIN_SURFACES).nullable().default(null),
    fileName: z.string().trim().max(200).nullable().default(null),
  }),
  async run({ args, context }: HandlerInput<ImportArgs>) {
    const parsed = parseLinkedinExport(args.csv, args.surface);
    if (parsed.problem) throw new ServiceError("INVALID_INPUT", parsed.problem);
    if (parsed.rows.length === 0) {
      const first = parsed.errors[0];
      throw new ServiceError(
        "INVALID_INPUT",
        first
          ? `No row could be imported. Row ${first.row}: ${first.message}.`
          : "No row could be imported.",
      );
    }

    const admin = createAdminClient();
    const businessId = context.businessId;

    /* ---- companies: one per domain, created only where none exists ---- */

    const byDomain = new Map<string, { name: string; key: string }>();
    for (const row of parsed.rows) {
      if (!byDomain.has(row.companyDomain)) {
        byDomain.set(row.companyDomain, {
          name: row.companyName ?? row.companyDomain,
          key: companyDedupeKey({ domain: row.companyDomain }),
        });
      }
    }

    const keys = [...byDomain.values()].map((entry) => entry.key);
    const companyIds = new Map<string, string>();

    const readExisting = async () => {
      for (let index = 0; index < keys.length; index += INSERT_CHUNK) {
        const { data, error } = await admin
          .from("prospect_companies")
          .select("id, dedupe_key")
          .eq("business_id", businessId)
          .in("dedupe_key", keys.slice(index, index + INSERT_CHUNK));
        if (error) throw new ServiceError("UNAVAILABLE", "Your companies could not be read.");
        for (const row of data ?? []) companyIds.set(row.dedupe_key, row.id);
      }
    };

    await readExisting();

    const missing = [...byDomain.entries()].filter(([, entry]) => !companyIds.has(entry.key));
    for (let index = 0; index < missing.length; index += INSERT_CHUNK) {
      const { error } = await admin.from("prospect_companies").insert(
        missing.slice(index, index + INSERT_CHUNK).map(([domain, entry]) => ({
          business_id: businessId,
          name: entry.name,
          domain,
          website_url: `https://${domain}`,
          dedupe_key: entry.key,
        })),
      );
      // 23505: another writer created one of them first. Re-read below.
      if (error && error.code !== "23505") {
        throw new ServiceError("UNAVAILABLE", "Your companies could not be saved.");
      }
    }
    if (missing.length > 0) await readExisting();

    /* ---- leads: skip what is already held for the same company ---- */

    const ids = [...new Set(companyIds.values())];
    const held = new Set<string>();
    for (let index = 0; index < ids.length; index += INSERT_CHUNK) {
      const { data, error } = await admin
        .from("prospect_data_sources")
        .select("company_id, value_json")
        .eq("business_id", businessId)
        .eq("provider", "linkedin_sales_navigator")
        .eq("field_name", "linkedin_lead")
        .in("company_id", ids.slice(index, index + INSERT_CHUNK))
        .limit(20_000);
      if (error) throw new ServiceError("UNAVAILABLE", "Your existing LinkedIn list could not be read.");
      for (const row of data ?? []) {
        if (row.company_id) held.add(leadKey(row.company_id, (row.value_json ?? {}) as Record<string, unknown>));
      }
    }

    const importedAt = new Date().toISOString();
    const inserts: {
      business_id: string;
      company_id: string;
      field_name: string;
      provider: string;
      source_type: string;
      source_url: string | null;
      provider_entity_id: string | null;
      confidence: number;
      value_json: never;
      policy_tags: never;
    }[] = [];
    let duplicates = 0;

    for (const row of parsed.rows) {
      const companyId = companyIds.get(byDomain.get(row.companyDomain)!.key);
      if (!companyId) continue;

      const blob = {
        firstName: row.firstName,
        lastName: row.lastName,
        roleTitle: row.roleTitle,
        publicProfileUrl: row.linkedinUrl,
        location: row.location,
        companyName: row.companyName,
        // Only when the customer's own file carried an address. It is their
        // import, so its origin is CRM_IMPORTED, and it is unverified until
        // the waterfall verifies it like any other.
        ...(row.email ? { email: row.email, emailOrigin: "CRM_IMPORTED" } : {}),
        surface: parsed.surface,
        importedAt,
        importedBy: context.userId,
        fileName: args.fileName,
        correlationId: context.correlationId,
      };

      const key = leadKey(companyId, blob);
      if (held.has(key)) {
        duplicates += 1;
        continue;
      }
      held.add(key);

      inserts.push({
        business_id: businessId,
        company_id: companyId,
        field_name: "linkedin_lead",
        provider: "linkedin_sales_navigator",
        source_type: "IMPORT",
        source_url: row.linkedinUrl,
        provider_entity_id: row.linkedinUrl,
        // The customer's own selection, but a title in an export can be stale.
        confidence: 0.8,
        value_json: blob as never,
        policy_tags: ["CUSTOMER_SUPPLIED", `SURFACE_${parsed.surface}`] as never,
      });
    }

    for (let index = 0; index < inserts.length; index += INSERT_CHUNK) {
      const { error } = await admin
        .from("prospect_data_sources")
        .insert(inserts.slice(index, index + INSERT_CHUNK));
      if (error) throw new ServiceError("UNAVAILABLE", "The list could not be saved. Nothing after the failure was imported.");
    }

    const warnings = parsed.discardedColumns.length
      ? [
          {
            code: "PHONE_DISCARDED",
            message: `Discarded ${parsed.discardedColumns.join(", ")}: ClientTurn does not store phone numbers from lists.`,
          },
        ]
      : [];

    const data: ImportData = {
      surface: parsed.surface,
      imported: inserts.length,
      duplicates,
      rejected: parsed.errors.length,
      companies: ids.length,
      errors: parsed.errors.slice(0, 20),
      discardedColumns: parsed.discardedColumns,
    };

    return {
      data,
      after: { imported: data.imported, duplicates, rejected: data.rejected, surface: data.surface },
      warnings,
    };
  },
});
