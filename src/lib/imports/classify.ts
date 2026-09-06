/**
 * Import row validation and classification (V4 §7.4-7.5).
 *
 * Pure — no `server-only`, no Supabase — so every rule here is unit-testable
 * and there is exactly one copy of it.
 *
 * The whole point of this module: **an import must not turn cold rows into warm
 * leads.** A spreadsheet of companies someone bought is not a list of people who
 * asked to be contacted, and the classifier's job is to keep those apart. When
 * it cannot tell, the answer is REVIEW — never "probably fine".
 */

import {
  emailDomain,
  isDisposableEmailDomain,
  isGenericEmailDomain,
  isRoleMailbox,
  normaliseEmail,
} from "../prospects/dedupe.ts";
import { isProspectRelationship, isWarmRelationship } from "../policy/types.ts";
import type { RelationshipType } from "../policy/types.ts";

export type RowClassification =
  | "IMPORT_AS_LEAD"
  | "IMPORT_AS_PROSPECT"
  | "REVIEW"
  | "SKIP";

/** §7.5. Every flag a row can carry, as machine codes the UI maps to a sentence. */
export type ValidationFlag =
  | "EXISTING_LEAD"
  | "EXISTING_PROSPECT"
  | "SUPPRESSED_CONTACT"
  | "INVALID_EMAIL"
  | "INVALID_PHONE"
  | "MISSING_IDENTITY"
  | "UNKNOWN_RELATIONSHIP"
  | "POSSIBLE_COLD_PROSPECT"
  | "DUPLICATE_IN_FILE"
  | "CONFLICTING_SOURCE"
  | "ROLE_MAILBOX"
  | "PERSONAL_EMAIL_DOMAIN"
  | "DISPOSABLE_DOMAIN";

const FLAG_SENTENCES: Record<ValidationFlag, string> = {
  EXISTING_LEAD: "Already a lead in this workspace",
  EXISTING_PROSPECT: "Already a prospect in this workspace",
  SUPPRESSED_CONTACT: "On your suppression list",
  INVALID_EMAIL: "The email address is not usable",
  INVALID_PHONE: "The phone number is not usable",
  MISSING_IDENTITY: "No name, company or contact detail",
  UNKNOWN_RELATIONSHIP: "No relationship was stated for this row",
  POSSIBLE_COLD_PROSPECT: "Looks like a cold contact rather than an enquiry",
  DUPLICATE_IN_FILE: "Appears more than once in this file",
  CONFLICTING_SOURCE: "The source and relationship columns disagree",
  ROLE_MAILBOX: "A shared inbox rather than a person",
  PERSONAL_EMAIL_DOMAIN: "A personal email address, not a business one",
  DISPOSABLE_DOMAIN: "A disposable email domain",
};

export function flagSentence(flag: ValidationFlag): string {
  return FLAG_SENTENCES[flag] ?? flag.replace(/_/g, " ").toLowerCase();
}

export type ParsedRow = {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  roleTitle: string | null;
  relationshipType: RelationshipType | null;
  sourceDetail: string | null;
  notes: string | null;
};

export type RowContext = {
  /** Set when the same email appeared earlier in this file. */
  duplicateInFile: boolean;
  existingLeadId: string | null;
  existingProspectId: string | null;
  suppressed: boolean;
  /** The relationship the operator chose for the whole file, if any. */
  defaultRelationship: RelationshipType | null;
};

export type RowVerdict = {
  classification: RowClassification;
  flags: ValidationFlag[];
  /** One sentence explaining the classification, shown in the review table. */
  reason: string;
};

function hasIdentity(row: ParsedRow): boolean {
  return Boolean(
    (row.firstName && row.lastName) || row.companyName || row.email || row.phone,
  );
}

/**
 * Classifies one row.
 *
 * Order matters and is deliberate: SKIP for anything unusable, then the
 * duplicate checks (an existing lead always wins over creating a prospect,
 * §60.3), then the relationship question that decides lead vs prospect.
 */
export function classifyRow(row: ParsedRow, context: RowContext): RowVerdict {
  const flags: ValidationFlag[] = [];

  /* 1. Unusable rows are skipped, not reviewed. There is nothing to decide. */
  if (!hasIdentity(row)) {
    return {
      classification: "SKIP",
      flags: ["MISSING_IDENTITY"],
      reason: "There is nothing here to import.",
    };
  }

  const email = normaliseEmail(row.email);
  if (row.email && !email) flags.push("INVALID_EMAIL");

  const domain = emailDomain(email);
  if (isDisposableEmailDomain(domain)) {
    return {
      classification: "SKIP",
      flags: [...flags, "DISPOSABLE_DOMAIN"],
      reason: "Disposable email addresses are never imported.",
    };
  }

  if (context.suppressed) {
    return {
      classification: "SKIP",
      flags: [...flags, "SUPPRESSED_CONTACT"],
      reason: "This contact has opted out and cannot be re-added.",
    };
  }

  if (context.duplicateInFile) flags.push("DUPLICATE_IN_FILE");

  /* 2. Records the workspace already holds. An existing lead outranks
   *    everything: re-importing must never demote it to a cold prospect. */
  if (context.existingLeadId) {
    return {
      classification: "SKIP",
      flags: [...flags, "EXISTING_LEAD"],
      reason: "Already a lead — the existing record is kept.",
    };
  }
  if (context.existingProspectId) {
    return {
      classification: "SKIP",
      flags: [...flags, "EXISTING_PROSPECT"],
      reason: "Already a prospect — the existing record is kept.",
    };
  }

  /* 3. Contact quality. None of these disqualify a row, but they are the
   *    difference between a person and a shared inbox. */
  if (email && isRoleMailbox(email)) flags.push("ROLE_MAILBOX");
  if (isGenericEmailDomain(domain)) flags.push("PERSONAL_EMAIL_DOMAIN");

  /* 4. The relationship. This is the question the whole wizard exists to ask. */
  const relationship = row.relationshipType ?? context.defaultRelationship;

  if (!relationship) {
    return {
      classification: "REVIEW",
      flags: [...flags, "UNKNOWN_RELATIONSHIP"],
      reason: "Say how you know these people before any of them can be contacted.",
    };
  }

  if (isProspectRelationship(relationship)) {
    return {
      classification: "IMPORT_AS_PROSPECT",
      flags,
      reason: "Imported as a prospect, for review before any contact.",
    };
  }

  if (isWarmRelationship(relationship)) {
    // A warm relationship still needs a way to reach them.
    if (!email && !row.phone) {
      return {
        classification: "REVIEW",
        flags: [...flags, "MISSING_IDENTITY"],
        reason: "No usable email or phone number for this person.",
      };
    }
    return {
      classification: "IMPORT_AS_LEAD",
      flags,
      reason: "Imported as a lead — you have an existing relationship.",
    };
  }

  // REFERRAL, IMPORTED and OTHER are genuinely ambiguous: they can be warm or
  // cold depending on evidence the spreadsheet does not carry.
  return {
    classification: "REVIEW",
    flags: [...flags, "POSSIBLE_COLD_PROSPECT"],
    reason: "This relationship could be warm or cold — decide before importing.",
  };
}

/* --------------------------------------------------------------- mapping */

/** The fields an import can populate. */
export const IMPORT_FIELDS = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "companyName", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "postcode", label: "Postcode" },
  { key: "roleTitle", label: "Job title" },
  { key: "sourceDetail", label: "Where they came from" },
  { key: "notes", label: "Notes" },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

/** Header spellings seen in real exports, lower-cased and stripped. */
const HEADER_HINTS: Record<ImportField, string[]> = {
  firstName: ["first name", "firstname", "first", "forename", "given name"],
  lastName: ["last name", "lastname", "last", "surname", "family name"],
  companyName: ["company", "company name", "organisation", "organization", "business", "account"],
  email: ["email", "email address", "e-mail", "work email", "primary email"],
  phone: ["phone", "telephone", "mobile", "phone number", "contact number", "tel"],
  postcode: ["postcode", "post code", "zip", "zip code", "postal code"],
  roleTitle: ["title", "job title", "role", "position"],
  sourceDetail: ["source", "lead source", "origin", "how they found us"],
  notes: ["notes", "note", "comments", "description"],
};

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Best-effort column mapping from a file's headers.
 *
 * A guess, offered for confirmation — never applied silently. Mapping the wrong
 * column into `email` is how an import contacts the wrong people, so the wizard
 * always shows this for review.
 */
export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();

  for (const [field, hints] of Object.entries(HEADER_HINTS) as [ImportField, string[]][]) {
    // Both sides are normalised: a hint written "e-mail" must still match a
    // header spelled "E-Mail", and comparing a raw hint to a normalised header
    // silently matched nothing.
    const normalisedHints = hints.map(normaliseHeader);
    const index = headers.findIndex(
      (header, position) =>
        !used.has(position) && normalisedHints.includes(normaliseHeader(header)),
    );
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }

  return mapping;
}

export type ImportSummary = Record<RowClassification, number>;

export function summarise(verdicts: RowVerdict[]): ImportSummary {
  const summary: ImportSummary = {
    IMPORT_AS_LEAD: 0,
    IMPORT_AS_PROSPECT: 0,
    REVIEW: 0,
    SKIP: 0,
  };
  for (const verdict of verdicts) summary[verdict.classification] += 1;
  return summary;
}

export const CLASSIFICATION_LABELS: Record<RowClassification, string> = {
  IMPORT_AS_LEAD: "Import as lead",
  IMPORT_AS_PROSPECT: "Import as prospect",
  REVIEW: "Needs review",
  SKIP: "Skip",
};

export function classificationTone(
  value: RowClassification,
): "success" | "accent" | "warning" | "neutral" {
  if (value === "IMPORT_AS_LEAD") return "success";
  if (value === "IMPORT_AS_PROSPECT") return "accent";
  if (value === "REVIEW") return "warning";
  return "neutral";
}
