import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { companyDedupeKey, isGenericEmailDomain, normaliseDomain } from "@/lib/prospects/dedupe";
import { assessContacts } from "@/lib/find-leads/contact-legality";
import {
  LINKEDIN_SURFACES,
  importSubscriberType,
  parseLinkedinExport,
  personCompanyKey,
  profileKey,
  resolveImportDomain,
  type DomainResolution,
  type LinkedinSurface,
} from "@/lib/find-leads/linkedin-import";
import { lookupCompany, type RegistryVerdict } from "@/lib/find-leads/server/providers/companies-house";
import { enrichProspectContact } from "@/lib/find-leads/server/research";
import { checkProspectIntent } from "@/lib/find-leads/server/intent-record";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * `prospect.import_linkedin_list`: the customer's own list, as prospects.
 *
 * Two kinds of file, both the customer's own data:
 *
 *   * LinkedIn's own export of their 1st-degree connections (Settings → Data
 *     privacy → Get a copy of your data → Connections.csv);
 *   * any CSV they own: their CRM, an event list, a spreadsheet.
 *
 * Nothing here touches LinkedIn. A connection is a relationship, not consent
 * to marketing, so every prospect starts in REVIEW with its subscriber type
 * derived from its details, and the policy engine's rules for individual-type
 * subscribers (non-promotional openers only) apply unchanged.
 *
 * Each valid row becomes a prospect straight away, with its company, whether
 * or not the file says where the company's website is (see
 * `linkedin-import.ts` for the resolution order). A `linkedin_lead`
 * provenance row is written for each, carrying the prospect id, so a sourcing
 * run's list route does not create the same person twice.
 *
 * Re-importing is idempotent: a person already held (same profile URL, else
 * same name at the same company, else same email) is counted, not re-created.
 */

const MAX_CSV_BYTES = 5_000_000;
const CHUNK = 200;
/** Companies House lookups per import: well inside 600 requests per 5 minutes. */
const MAX_REGISTRY_LOOKUPS = 150;

type ImportArgs = {
  csv: string;
  surface: LinkedinSurface | null;
  fileName: string | null;
  sessionId: string | null;
};

type RegistryCheck = "MATCHED" | "NO_MATCH" | "NOT_CONFIGURED" | "NOT_NEEDED" | "SKIPPED_LIMIT";

type ImportData = {
  surface: LinkedinSurface;
  imported: number;
  duplicates: number;
  rejected: number;
  companies: number;
  withoutWebsite: number;
  resolutions: Record<DomainResolution, number>;
  registryMatched: number;
  errors: { row: number; message: string }[];
  discardedColumns: string[];
};

/** The canonical profile URL stored on the prospect, so re-imports match exactly. */
function canonicalProfileUrl(url: string | null): string | null {
  const key = profileKey(url);
  return key ? `https://www.linkedin.com/${key}` : null;
}

defineOperation("prospect.import_linkedin_list", {
  schema: z.object({
    csv: z.string().min(1).max(MAX_CSV_BYTES),
    surface: z.enum(LINKEDIN_SURFACES).nullable().default(null),
    fileName: z.string().trim().max(200).nullable().default(null),
    sessionId: z.uuid().nullable().default(null),
  }),
  async run({ args, context }: HandlerInput<ImportArgs>) {
    const parsed = parseLinkedinExport(args.csv, args.surface);
    if (parsed.problem) throw new ServiceError("INVALID_INPUT", parsed.problem);
    if (parsed.rows.length === 0) {
      const first = parsed.errors[0];
      throw new ServiceError(
        "INVALID_INPUT",
        first ? `No row could be imported. Row ${first.row}: ${first.message}.` : "No row could be imported.",
      );
    }

    const admin = createAdminClient();
    const businessId = context.businessId;

    // Session context is recorded only when the session is this workspace's.
    let sessionId: string | null = null;
    if (args.sessionId) {
      const { data: session } = await admin
        .from("search_sessions")
        .select("id")
        .eq("business_id", businessId)
        .eq("id", args.sessionId)
        .maybeSingle();
      sessionId = session?.id ?? null;
    }

    /* ---- 1. domain resolution: column, then work email ---- */

    const rows = parsed.rows.map((row) => ({ ...row, ...resolveImportDomain(row) }));

    /* ---- 2. the register, for companies still without a domain ---- */

    const verdicts = new Map<string, RegistryVerdict>();
    const registryCheck = new Map<string, RegistryCheck>();
    const chConfigured = Boolean(serverEnv.sourcing.companiesHouseApiKey);
    const unresolvedNames = [
      ...new Set(rows.filter((row) => !row.domain && row.companyName).map((row) => row.companyName!)),
    ];
    for (const [index, name] of unresolvedNames.entries()) {
      if (!chConfigured) {
        registryCheck.set(name, "NOT_CONFIGURED");
        continue;
      }
      if (index >= MAX_REGISTRY_LOOKUPS) {
        registryCheck.set(name, "SKIPPED_LIMIT");
        continue;
      }
      // Exact normalised name match only (see lookupCompany). The register
      // publishes no website, so a match confirms the company and its type
      // but never supplies a domain: none is invented.
      const verdict = await lookupCompany(name);
      if (verdict.companyNumber) {
        verdicts.set(name, verdict);
        registryCheck.set(name, "MATCHED");
      } else {
        registryCheck.set(name, "NO_MATCH");
      }
    }

    /* ---- 3. companies: by domain where known, else by name ---- */

    type CompanyPlan = { key: string; domain: string | null; name: string; verdict: RegistryVerdict | null };
    const companyFor = (row: (typeof rows)[number]): CompanyPlan => {
      const verdict = !row.domain && row.companyName ? (verdicts.get(row.companyName) ?? null) : null;
      const name = row.companyName ?? row.domain ?? "Unknown company";
      return {
        key: row.domain ? companyDedupeKey({ domain: row.domain }) : companyDedupeKey({ name }),
        domain: row.domain,
        name,
        verdict,
      };
    };

    const plans = new Map<string, CompanyPlan>();
    for (const row of rows) {
      const plan = companyFor(row);
      if (!plans.has(plan.key)) plans.set(plan.key, plan);
    }

    const companyIds = new Map<string, string>();
    const keys = [...plans.keys()];
    const domains = [...plans.values()].map((p) => p.domain).filter((d): d is string => Boolean(d));

    const readExisting = async () => {
      for (let index = 0; index < keys.length; index += CHUNK) {
        const { data, error } = await admin
          .from("prospect_companies")
          .select("id, dedupe_key, domain")
          .eq("business_id", businessId)
          .in("dedupe_key", keys.slice(index, index + CHUNK));
        if (error) throw new ServiceError("UNAVAILABLE", "Your companies could not be read.");
        for (const row of data ?? []) companyIds.set(row.dedupe_key, row.id);
      }
      // A company found earlier by a run may hold the domain under another key.
      for (let index = 0; index < domains.length; index += CHUNK) {
        const { data } = await admin
          .from("prospect_companies")
          .select("id, domain")
          .eq("business_id", businessId)
          .in("domain", domains.slice(index, index + CHUNK));
        for (const row of data ?? []) {
          if (row.domain) companyIds.set(companyDedupeKey({ domain: row.domain }), row.id);
        }
      }
    };

    await readExisting();

    const missing = [...plans.values()].filter((plan) => !companyIds.has(plan.key));
    for (let index = 0; index < missing.length; index += CHUNK) {
      const { error } = await admin.from("prospect_companies").insert(
        missing.slice(index, index + CHUNK).map((plan) => ({
          business_id: businessId,
          name: plan.name,
          domain: plan.domain,
          website_url: plan.domain ? `https://${plan.domain}` : null,
          dedupe_key: plan.key,
          ...(plan.verdict
            ? {
                registration_id: plan.verdict.companyNumber,
                subscriber_type: plan.verdict.subscriberType,
                registry_reason: plan.verdict.reason,
                registry_checked_at: new Date().toISOString(),
              }
            : {}),
        })),
      );
      // 23505: another writer created one first. Re-read below.
      if (error && error.code !== "23505") {
        throw new ServiceError("UNAVAILABLE", "Your companies could not be saved.");
      }
    }
    if (missing.length > 0) await readExisting();

    /* ---- 4. dedupe: profile URL, then name + company, then email ---- */

    const companyIdOf = (row: (typeof rows)[number]) => companyIds.get(companyFor(row).key) ?? null;
    const heldProfiles = new Set<string>();
    const heldPeople = new Set<string>();
    const heldEmails = new Set<string>();

    const urls = [...new Set(rows.map((row) => canonicalProfileUrl(row.linkedinUrl)).filter((u): u is string => Boolean(u)))];
    for (let index = 0; index < urls.length; index += CHUNK) {
      const { data } = await admin
        .from("prospects")
        .select("linkedin_url")
        .eq("business_id", businessId)
        .in("linkedin_url", urls.slice(index, index + CHUNK));
      for (const row of data ?? []) {
        const key = profileKey(row.linkedin_url);
        if (key) heldProfiles.add(key);
      }
    }

    const ids = [...new Set(companyIds.values())];
    const companyById = new Map<string, { domain: string | null; name: string }>();
    for (let index = 0; index < ids.length; index += CHUNK) {
      const slice = ids.slice(index, index + CHUNK);
      const [{ data: companies }, { data: people }] = await Promise.all([
        admin.from("prospect_companies").select("id, domain, name").eq("business_id", businessId).in("id", slice),
        admin
          .from("prospects")
          .select("first_name, last_name, company_id")
          .eq("business_id", businessId)
          .in("company_id", slice)
          .limit(20_000),
      ]);
      for (const company of companies ?? []) companyById.set(company.id, company);
      for (const person of people ?? []) {
        const company = person.company_id ? companyById.get(person.company_id) : null;
        const key = personCompanyKey({
          firstName: person.first_name,
          lastName: person.last_name,
          companyDomain: company?.domain ?? null,
          companyName: company?.name ?? null,
        });
        if (key) heldPeople.add(key);
      }
    }

    const emails = [...new Set(rows.map((row) => row.email).filter((e): e is string => Boolean(e)))];
    for (let index = 0; index < emails.length; index += CHUNK) {
      const { data } = await admin
        .from("prospects")
        .select("email")
        .eq("business_id", businessId)
        .in("email", emails.slice(index, index + CHUNK));
      for (const row of data ?? []) if (row.email) heldEmails.add(row.email.toLowerCase());
    }

    /* ---- 5. prospects, then provenance ---- */

    const importedAt = new Date().toISOString();
    const resolutions: Record<DomainResolution, number> = { WEBSITE_COLUMN: 0, WORK_EMAIL: 0, UNRESOLVED: 0 };
    let duplicates = 0;
    let imported = 0;
    let withoutWebsite = 0;
    let registryMatched = 0;

    type Pending = { row: (typeof rows)[number]; companyId: string; insert: Record<string, unknown> };
    const pending: Pending[] = [];

    for (const row of rows) {
      const companyId = companyIdOf(row);
      if (!companyId) continue;
      const company = companyById.get(companyId);
      const profile = profileKey(row.linkedinUrl);
      const person = personCompanyKey({
        firstName: row.firstName,
        lastName: row.lastName,
        companyDomain: company?.domain ?? row.domain,
        companyName: company?.name ?? row.companyName,
      });

      if (
        (profile && heldProfiles.has(profile)) ||
        (person && heldPeople.has(person)) ||
        (row.email && heldEmails.has(row.email))
      ) {
        duplicates += 1;
        continue;
      }
      if (profile) heldProfiles.add(profile);
      if (person) heldPeople.add(person);
      if (row.email) heldEmails.add(row.email);

      // The same legality rules as a sourced record. No phone is ever passed:
      // the parser dropped the column before this point.
      const contacts = assessContacts({ email: row.email, phone: null }, true);
      const verdict = row.companyName ? verdicts.get(row.companyName) : undefined;

      pending.push({
        row,
        companyId,
        insert: {
          business_id: businessId,
          company_id: companyId,
          first_name: row.firstName,
          last_name: row.lastName,
          role_title: row.roleTitle,
          email: contacts.email,
          phone_e164: null,
          email_origin: contacts.email ? "CRM_IMPORTED" : null,
          linkedin_url: canonicalProfileUrl(row.linkedinUrl),
          subscriber_type: importSubscriberType(contacts.subscriberType, verdict?.subscriberType ?? null),
          status: "DISCOVERED",
          source_provider: "linkedin_list_import",
          // An imported person is never eligible until the policy engine says
          // so. A connection is a relationship, not permission to market.
          outreach_eligibility: "REVIEW",
        },
      });
    }

    const insertOne = async (item: Pending) => {
      const { data, error } = await admin.from("prospects").insert(item.insert as never).select("id").maybeSingle();
      if (error?.code === "23505") {
        duplicates += 1;
        return null;
      }
      return data?.id ?? null;
    };

    const created: { item: Pending; id: string }[] = [];
    for (let index = 0; index < pending.length; index += CHUNK) {
      const slice = pending.slice(index, index + CHUNK);
      const { data, error } = await admin
        .from("prospects")
        .insert(slice.map((item) => item.insert) as never)
        .select("id");
      if (!error && data && data.length === slice.length) {
        data.forEach((row, offset) => created.push({ item: slice[offset], id: row.id }));
        continue;
      }
      // A conflict (another writer, or an address held under different case)
      // fails the whole batch. Fall back to one at a time for this chunk.
      if (error && error.code !== "23505") {
        throw new ServiceError("UNAVAILABLE", "The prospects could not be saved. Nothing after the failure was imported.");
      }
      for (const item of slice) {
        const id = await insertOne(item);
        if (id) created.push({ item, id });
      }
    }

    const provenance = created.map(({ item, id }) => {
      const { row } = item;
      const check: RegistryCheck = row.domain
        ? "NOT_NEEDED"
        : row.companyName
          ? (registryCheck.get(row.companyName) ?? "NOT_NEEDED")
          : "NOT_NEEDED";
      resolutions[row.resolution] += 1;
      if (!row.domain) withoutWebsite += 1;
      if (check === "MATCHED") registryMatched += 1;
      imported += 1;

      return {
        business_id: businessId,
        prospect_id: id,
        company_id: item.companyId,
        field_name: "linkedin_lead",
        provider: "linkedin_list_import",
        source_type: "IMPORT",
        source_url: canonicalProfileUrl(row.linkedinUrl),
        provider_entity_id: canonicalProfileUrl(row.linkedinUrl),
        confidence: 0.8,
        value_json: {
          firstName: row.firstName,
          lastName: row.lastName,
          roleTitle: row.roleTitle,
          publicProfileUrl: canonicalProfileUrl(row.linkedinUrl),
          location: row.location,
          companyName: row.companyName,
          surface: parsed.surface,
          domainResolution: row.resolution,
          registryCheck: check,
          importedAt,
          importedBy: context.userId,
          fileName: args.fileName,
          sessionId,
          correlationId: context.correlationId,
        } as never,
        policy_tags: ["CUSTOMER_SUPPLIED", `SURFACE_${parsed.surface}`] as never,
      };
    });

    // The relationship, recorded where the policy engine reads it. A 1st-degree
    // connection is ACCEPTED_SOCIAL_CONNECTION: a real relationship, but not
    // consent, so an individual-type subscriber gets a non-promotional opener
    // only. Any other list is IMPORTED, which needs consent for individuals.
    const connections = parsed.surface === "LINKEDIN_CONNECTIONS";
    const permissions = created.map(({ item, id }) => ({
      business_id: businessId,
      subject_type: "PROSPECT",
      subject_id: id,
      relationship_type: connections ? "ACCEPTED_SOCIAL_CONNECTION" : "IMPORTED",
      relationship_detail: connections
        ? "A 1st-degree LinkedIn connection, from the workspace's own LinkedIn Connections export."
        : `Imported from the workspace's own list${args.fileName ? ` (${args.fileName})` : ""}.`,
      consent_status: "UNKNOWN",
      lawful_basis_tag: "LEGITIMATE_INTERESTS",
      subscriber_type: String(item.insert.subscriber_type),
      email: (item.insert.email as string | null) ?? null,
    }));
    for (let index = 0; index < permissions.length; index += CHUNK) {
      await admin
        .from("contact_permissions")
        .upsert(permissions.slice(index, index + CHUNK), {
          onConflict: "business_id,subject_type,subject_id",
          ignoreDuplicates: true,
        });
    }

    for (let index = 0; index < provenance.length; index += CHUNK) {
      const { error } = await admin.from("prospect_data_sources").insert(provenance.slice(index, index + CHUNK));
      if (error) throw new ServiceError("UNAVAILABLE", "The prospects were saved but their source record was not. Try the import again: it will not duplicate them.");
    }

    const warnings = [
      ...(parsed.discardedColumns.length
        ? [{ code: "PHONE_DISCARDED", message: `Discarded ${parsed.discardedColumns.join(", ")}: ClientTurn does not store phone numbers from lists.` }]
        : []),
      ...(withoutWebsite > 0
        ? [{ code: "WEBSITE_UNKNOWN", message: `${withoutWebsite} prospect${withoutWebsite === 1 ? " has" : "s have"} no company website yet. Add one on the prospect to find a work email and check buying signals.` }]
        : []),
    ];

    const data: ImportData = {
      surface: parsed.surface,
      imported,
      duplicates,
      rejected: parsed.errors.length,
      companies: new Set(created.map(({ item }) => item.companyId)).size,
      withoutWebsite,
      resolutions,
      registryMatched,
      errors: parsed.errors.slice(0, 20),
      discardedColumns: parsed.discardedColumns,
    };

    return {
      data,
      after: { imported, duplicates, rejected: data.rejected, withoutWebsite, surface: data.surface },
      warnings,
    };
  },
});

/* ------------------------------------------------------------ add website */

type WebsiteArgs = { prospectId: string; website: string };

/**
 * `prospect.set_company_website`: "Add website" on a prospect whose company
 * has none (typically an imported one). Sets the company's domain -- or moves
 * the prospect to the company that already holds it -- then runs the normal
 * email waterfall and the free intent checks for it.
 */
defineOperation("prospect.set_company_website", {
  schema: z.object({ prospectId: z.uuid(), website: z.string().trim().min(3).max(253) }),
  async run({ args, context }: HandlerInput<WebsiteArgs>) {
    const domain = normaliseDomain(args.website);
    if (!domain) throw new ServiceError("INVALID_INPUT", "That is not a website address.");
    if (isGenericEmailDomain(domain)) {
      throw new ServiceError("INVALID_INPUT", "That is an email provider, not the company's website.");
    }

    const admin = createAdminClient();
    const businessId = context.businessId;

    const { data: prospect } = await admin
      .from("prospects")
      .select("id, email, company_id")
      .eq("business_id", businessId)
      .eq("id", args.prospectId)
      .maybeSingle();
    if (!prospect) throw new ServiceError("NOT_FOUND", "That prospect could not be found.");
    if (!prospect.company_id) throw new ServiceError("CONFLICT", "This prospect has no company to add a website to.");

    const { data: company } = await admin
      .from("prospect_companies")
      .select("id, domain")
      .eq("business_id", businessId)
      .eq("id", prospect.company_id)
      .maybeSingle();
    if (!company) throw new ServiceError("NOT_FOUND", "That company could not be found.");
    if (company.domain) {
      throw new ServiceError("CONFLICT", `This company already has a website (${company.domain}).`);
    }

    const { data: holder } = await admin
      .from("prospect_companies")
      .select("id")
      .eq("business_id", businessId)
      .eq("domain", domain)
      .maybeSingle();

    let companyId = company.id;
    if (holder) {
      // The workspace already knows this company by its website. The prospect
      // joins it rather than creating a second record of the same company.
      companyId = holder.id;
      await admin.from("prospects").update({ company_id: holder.id }).eq("business_id", businessId).eq("id", prospect.id);
      await admin
        .from("prospect_data_sources")
        .update({ company_id: holder.id })
        .eq("business_id", businessId)
        .eq("prospect_id", prospect.id);
    } else {
      const { error } = await admin
        .from("prospect_companies")
        .update({ domain, website_url: `https://${domain}`, dedupe_key: companyDedupeKey({ domain }) })
        .eq("business_id", businessId)
        .eq("id", company.id);
      if (error) throw new ServiceError("UNAVAILABLE", "The website could not be saved.");
    }

    await admin.from("prospect_data_sources").insert({
      business_id: businessId,
      prospect_id: prospect.id,
      company_id: companyId,
      field_name: "company_domain",
      provider: "user",
      source_type: "MANUAL",
      source_url: `https://${domain}`,
      confidence: 0.9,
      value_json: { domain, addedBy: context.userId } as never,
      policy_tags: ["CUSTOMER_SUPPLIED"] as never,
    });

    // The normal waterfall: discover a work email when none is held.
    const warnings: { code: string; message: string }[] = [];
    let emailFound = false;
    if (!prospect.email) {
      const outcome = await enrichProspectContact(businessId, prospect.id, "EMAIL", context.userId);
      emailFound = outcome.found;
      if (!outcome.ok && outcome.error) warnings.push({ code: "EMAIL_NOT_FOUND", message: outcome.error });
    }

    const intent = await checkProspectIntent(businessId, prospect.id);

    return {
      data: { domain, companyId, emailFound, intentMatched: intent.matched, intentChecked: intent.checked },
      entityId: prospect.id,
      before: { domain: null },
      after: { domain, companyId },
      warnings,
    };
  },
});
