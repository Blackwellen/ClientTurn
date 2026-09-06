import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  companyKey,
  normaliseCompany,
  normaliseEmail,
  normalisePhoneValue,
  type DuplicateConfidence,
  type DuplicateMatch,
} from "./types";

/**
 * The one duplicate service. The wizard calls it while the operator types (UX)
 * and the create action calls it again immediately before insert (the decision).
 * Both go through this function, so there is exactly one definition of "we
 * already have this person" in the product.
 *
 * Always workspace-scoped: the `business_id` comes from the session, never from
 * the caller's payload, so a hand-crafted request cannot probe another tenant.
 */

export type DuplicateInput = {
  email?: string | null;
  mobile?: string | null;
  telephone?: string | null;
  company?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/** Enough to recognise your own record, not enough to harvest a contact. */
function maskEmail(value: string | null): string | null {
  if (!value) return null;
  const [local, domain] = value.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function maskPhone(value: string | null): string | null {
  if (!value) return null;
  return `${value.slice(0, 3)}${"•".repeat(Math.max(value.length - 6, 1))}${value.slice(-3)}`;
}

function displayName(
  first: string | null,
  last: string | null,
  fallback: string | null,
) {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || fallback || "Unnamed record";
}

/** Highest-confidence signal wins when one record matches on several. */
const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = {
  EXACT_EMAIL: 4,
  EXACT_PHONE: 3,
  NAME_COMPANY: 2,
  COMPANY_MATCH: 1,
};

export async function findDuplicates(
  businessId: string,
  input: DuplicateInput,
): Promise<DuplicateMatch[]> {
  const email = normaliseEmail(input.email);
  const phones = [
    normalisePhoneValue(input.mobile),
    normalisePhoneValue(input.telephone),
  ].filter((value): value is string => Boolean(value));
  const company = normaliseCompany(input.company);
  const key = companyKey(company);
  const first = (input.firstName ?? "").trim().toLowerCase();
  const last = (input.lastName ?? "").trim().toLowerCase();

  if (!email && phones.length === 0 && !key) return [];

  const admin = createAdminClient();
  const found = new Map<string, DuplicateMatch>();

  const add = (match: DuplicateMatch) => {
    const existing = found.get(match.id);
    if (
      !existing ||
      CONFIDENCE_RANK[match.confidence] > CONFIDENCE_RANK[existing.confidence]
    ) {
      found.set(match.id, match);
    }
  };

  /* ------------------------------------------------------------- leads --- */

  const leadSelect =
    "id, first_name, last_name, company_name, email, phone_normalized, phone, status, created_at";

  const leadQueries: PromiseLike<{ data: LeadRow[] | null }>[] = [];

  if (email) {
    leadQueries.push(
      admin
        .from("leads")
        .select(leadSelect)
        .eq("business_id", businessId)
        .ilike("email", email)
        .limit(5)
        .then((r) => ({ data: (r.data ?? []) as LeadRow[] })),
    );
  }
  if (phones.length > 0) {
    leadQueries.push(
      admin
        .from("leads")
        .select(leadSelect)
        .eq("business_id", businessId)
        .in("phone_normalized", phones)
        .limit(5)
        .then((r) => ({ data: (r.data ?? []) as LeadRow[] })),
    );
  }
  if (company) {
    leadQueries.push(
      admin
        .from("leads")
        .select(leadSelect)
        .eq("business_id", businessId)
        .ilike("company_name", company)
        .limit(10)
        .then((r) => ({ data: (r.data ?? []) as LeadRow[] })),
    );
  }

  /* --------------------------------------------------------- prospects --- */

  const prospectSelect =
    "id, first_name, last_name, email, phone_e164, status, created_at, company_id";

  const prospectQueries: PromiseLike<{ data: ProspectRow[] | null }>[] = [];

  if (email) {
    prospectQueries.push(
      admin
        .from("prospects")
        .select(prospectSelect)
        .eq("business_id", businessId)
        .eq("email", email)
        .limit(5)
        .then((r) => ({ data: (r.data ?? []) as ProspectRow[] })),
    );
  }
  if (phones.length > 0) {
    prospectQueries.push(
      admin
        .from("prospects")
        .select(prospectSelect)
        .eq("business_id", businessId)
        .in("phone_e164", phones)
        .limit(5)
        .then((r) => ({ data: (r.data ?? []) as ProspectRow[] })),
    );
  }

  const [leadResults, prospectResults] = await Promise.all([
    Promise.all(leadQueries),
    Promise.all(prospectQueries),
  ]);

  for (const result of leadResults) {
    for (const row of result.data ?? []) {
      const rowEmail = normaliseEmail(row.email);
      const rowPhone = row.phone_normalized ?? normalisePhoneValue(row.phone);
      const rowKey = companyKey(row.company_name);

      let confidence: DuplicateConfidence | null = null;
      if (email && rowEmail === email) confidence = "EXACT_EMAIL";
      else if (rowPhone && phones.includes(rowPhone)) confidence = "EXACT_PHONE";
      else if (
        key &&
        rowKey === key &&
        first &&
        last &&
        (row.first_name ?? "").trim().toLowerCase() === first &&
        (row.last_name ?? "").trim().toLowerCase() === last
      ) {
        confidence = "NAME_COMPANY";
      } else if (key && rowKey === key) confidence = "COMPANY_MATCH";

      if (!confidence) continue;

      add({
        id: row.id,
        kind: "LEAD",
        name: displayName(row.first_name, row.last_name, row.company_name),
        company: row.company_name,
        emailMasked: maskEmail(rowEmail),
        phoneMasked: maskPhone(rowPhone),
        status: row.status,
        createdAt: row.created_at,
        confidence,
      });
    }
  }

  // A prospect's company lives on `prospect_companies`, resolved in one extra
  // round trip only when there is something to resolve.
  const companyIds = [
    ...new Set(
      prospectResults
        .flatMap((result) => result.data ?? [])
        .map((row) => row.company_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const companyNames = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data } = await admin
      .from("prospect_companies")
      .select("id, name")
      .eq("business_id", businessId)
      .in("id", companyIds);
    for (const row of data ?? []) {
      if (row.id) companyNames.set(row.id, row.name);
    }
  }

  for (const result of prospectResults) {
    for (const row of result.data ?? []) {
      if (!row.id) continue;
      const rowEmail = normaliseEmail(row.email);
      const rowPhone = row.phone_e164;
      const confidence: DuplicateConfidence | null =
        email && rowEmail === email
          ? "EXACT_EMAIL"
          : rowPhone && phones.includes(rowPhone)
            ? "EXACT_PHONE"
            : null;
      if (!confidence) continue;

      const companyName = row.company_id
        ? (companyNames.get(row.company_id) ?? null)
        : null;

      add({
        id: row.id,
        kind: "PROSPECT",
        name: displayName(row.first_name, row.last_name, companyName),
        company: companyName,
        emailMasked: maskEmail(rowEmail),
        phoneMasked: maskPhone(rowPhone),
        status: row.status,
        createdAt: row.created_at,
        confidence,
      });
    }
  }

  return [...found.values()].sort(
    (a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence],
  );
}

type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  phone_normalized: string | null;
  phone: string | null;
  status: string;
  created_at: string;
};

type ProspectRow = {
  id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_e164: string | null;
  status: string;
  created_at: string;
  company_id: string | null;
};

/**
 * The suppression-relevant state of records that already exist for this
 * contact. Step 3's summary needs to say "already booked" or "active
 * conversation", and those facts live on the matched lead, not on the
 * suppression list.
 */
export type ExistingLeadState = {
  optedOut: boolean;
  booked: boolean;
  won: boolean;
  activeConversation: boolean;
  recentContactAt: string | null;
};

export async function existingLeadState(
  businessId: string,
  leadIds: string[],
): Promise<ExistingLeadState | null> {
  if (leadIds.length === 0) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("id, opted_out, status, booked_at, won_at, last_contact_at, automation_active")
    .eq("business_id", businessId)
    .in("id", leadIds);

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const recent = rows
    .map((row) => row.last_contact_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return {
    optedOut: rows.some((row) => row.opted_out),
    booked: rows.some((row) => Boolean(row.booked_at) || row.status === "BOOKED"),
    won: rows.some((row) => Boolean(row.won_at) || row.status === "WON"),
    activeConversation: rows.some(
      (row) => row.automation_active && row.status !== "LOST",
    ),
    recentContactAt: recent ?? null,
  };
}
