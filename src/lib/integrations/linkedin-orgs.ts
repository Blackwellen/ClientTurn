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

/** Lead Sync scopes, always; page engagement only when LinkedIn approved it. */
export const LINKEDIN_LEAD_SYNC_SCOPES = [
  "r_marketing_leadgen_automation",
  "r_ads",
  "r_organization_admin",
] as const;

/**
 * The scopes the connect flow requests.
 *
 * `r_organization_social` belongs to LinkedIn's Community Management API, a
 * separate product that needs its own approval. Requesting a scope the app
 * has not been granted makes LinkedIn refuse the authorisation outright, so
 * asking for it unconditionally would break Lead Gen Forms too.
 */
export function linkedinScopes(communityManagementApproved: boolean): string {
  return [
    ...LINKEDIN_LEAD_SYNC_SCOPES,
    ...(communityManagementApproved ? ["r_organization_social"] : []),
  ].join(" ");
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
