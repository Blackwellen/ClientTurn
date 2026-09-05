import "server-only";
import { serverEnv } from "@/lib/env";
import type { OAuthConfig, TokenResponse } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerLeadSourcePoller } from "@/lib/integrations/providers/lead-source-registry";

/**
 * Microsoft Advertising — OAuth connect. Lead-form polling is deliberately NOT implemented;
 * see the comment on `poll` below for why.
 *
 * Docs consulted while building this (fetched live, not from training data):
 * - OAuth (Entra ID) endpoints/scope:
 *   https://learn.microsoft.com/en-us/advertising/guides/authentication-oauth-get-tokens
 *   (authorize: https://login.microsoftonline.com/common/oauth2/v2.0/authorize,
 *    token: https://login.microsoftonline.com/common/oauth2/v2.0/token,
 *    scope: "https://ads.microsoft.com/msads.manage offline_access", tenant "common")
 * - Account/user identity call:
 *   https://learn.microsoft.com/en-us/advertising/customer-management-service/getuser
 *   (REST: POST https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/User/Query,
 *    headers Authorization: Bearer <token> and DeveloperToken: <token>)
 *
 * ASSUMPTION / gap in public docs: Microsoft Advertising has a "Lead Form" ad extension
 * (announced in-product), but as of the documentation available at build time there is no
 * published Microsoft Advertising API operation, Bulk file column, or Reporting Service report
 * that returns individual lead-form submission records — unlike Google's documented
 * `lead_form_submission_data` GAQL resource. Searches of learn.microsoft.com's Customer
 * Management, Campaign Management, Bulk, and Reporting service docs (e.g.
 * https://learn.microsoft.com/en-us/advertising/guides/reports,
 * https://learn.microsoft.com/en-us/advertising/campaign-management-service/campaign-management-data-objects)
 * turned up ad-extension and performance reporting types but nothing describing lead-form
 * submission retrieval. Rather than guess at an undocumented endpoint, `poll` below fails loudly
 * with an explanatory error so the integration surfaces as ACTION_REQUIRED instead of silently
 * reporting HEALTHY while never actually fetching a lead. OAuth connect and account identification
 * are fully implemented against confirmed endpoints, so the moment Microsoft documents (or a
 * partner-only endpoint is disclosed for) lead-form retrieval, only `poll` needs replacing.
 */

const SCOPE = "https://ads.microsoft.com/msads.manage offline_access";

function config(): OAuthConfig | null {
  const { clientId, clientSecret, developerToken } = serverEnv.microsoftAds;
  if (!clientId || !clientSecret || !developerToken) return null;

  return {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientId,
    clientSecret,
    scope: SCOPE,
  };
}

type MicrosoftUserResponse = {
  User?: {
    Name?: { FirstName?: string; LastName?: string };
  };
  CustomerRoles?: { CustomerId?: number | string; AccountIds?: (number | string)[] }[];
};

async function identify(token: TokenResponse) {
  const developerToken = serverEnv.microsoftAds.developerToken ?? "";

  const response = await fetch(
    "https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/User/Query",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        DeveloperToken: developerToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );

  if (!response.ok) {
    throw new Error(`Could not identify the Microsoft Advertising account (status ${response.status}).`);
  }

  const json = (await response.json()) as MicrosoftUserResponse;
  const role = json.CustomerRoles?.[0];
  const customerId = role?.CustomerId != null ? String(role.CustomerId) : null;
  const name = json.User?.Name;
  const displayName = customerId
    ? `Microsoft Advertising customer ${customerId}`
    : name?.FirstName || name?.LastName
      ? [name?.FirstName, name?.LastName].filter(Boolean).join(" ")
      : null;

  return {
    externalAccountId: customerId,
    displayName,
    scopes: SCOPE.split(" "),
  };
}

async function poll(): Promise<void> {
  throw new Error(
    "Microsoft Advertising lead-form retrieval is not implemented: Microsoft has not published " +
      "a Bulk, Campaign Management, or Reporting API operation for Lead Form extension " +
      "submissions as of this build. The account is connected, but leads cannot be pulled " +
      "automatically yet.",
  );
}

registerOAuthProvider("microsoft_ads", { getConfig: config, identify });
registerLeadSourcePoller("microsoft_ads", { poll });
