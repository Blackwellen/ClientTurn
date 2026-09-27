/**
 * LinkedIn organisations and scopes. Pure, so the scope decision and the ACL
 * parsing are testable without LinkedIn.
 */

export type LinkedInOrganization = {
  /** Numeric id, as `integrations.external_account_id` holds it. */
  id: string;
  /** `urn:li:organization:<id>`, as the engagement provider reads it. */
  urn: string;
  name: string;
};

/** Lead Sync scopes: Lead Gen Forms only. */
export const LINKEDIN_LEAD_SYNC_SCOPES = [
  "r_marketing_leadgen_automation",
  "r_ads",
  "r_organization_admin",
] as const;

/**
 * The scopes the connect flow requests: Lead Gen Forms only.
 *
 * `r_organization_social` (company-page engagement) is never requested.
 * LinkedIn's terms forbid using member data to identify sales prospects, so
 * the engagement prospect source it served was removed.
 */
export function linkedinScopes(): string {
  return [...LINKEDIN_LEAD_SYNC_SCOPES].join(" ");
}

/** Organisations from an `organizationAcls?q=roleAssignee` response, de-duplicated. */
export function organizationsFromAcls(
  elements: Array<{
    organizationalTarget?: string;
    "organizationalTarget~"?: { localizedName?: string };
  }>,
): LinkedInOrganization[] {
  const seen = new Map<string, LinkedInOrganization>();
  for (const element of elements) {
    const urn = element.organizationalTarget;
    if (!urn || !urn.startsWith("urn:li:organization:")) continue;
    const id = urn.split(":").pop();
    if (!id || seen.has(id)) continue;
    seen.set(id, {
      id,
      urn,
      name: element["organizationalTarget~"]?.localizedName ?? `Organisation ${id}`,
    });
  }
  return [...seen.values()];
}
