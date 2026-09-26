/**
 * The company an inbound connector event names. Pure.
 *
 * The public events endpoint accepts `company` (Pipedrive, folk, Make, n8n
 * and custom senders all send it), and `process_workspace_app_event` dropped
 * it: the prospect arrived with a name and an email and no company, which is
 * the one field a B2B prospect is scored and grouped by.
 */
import {
  companyDedupeKey,
  isGenericEmailDomain,
  normaliseDomain,
} from "../prospects/dedupe.ts";

export type ConnectorCompany = {
  name: string;
  domain: string | null;
  dedupeKey: string;
};

export function connectorCompany(input: {
  company: unknown;
  email: unknown;
}): ConnectorCompany | null {
  const name = typeof input.company === "string" ? input.company.trim().replace(/\s+/g, " ") : "";
  if (!name) return null;

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const emailDomain = normaliseDomain(email.includes("@") ? email.split("@")[1] : null);
  // A gmail.com address says nothing about the company; using it as the
  // domain would merge every freemail contact's company into one row.
  const domain = emailDomain && !isGenericEmailDomain(emailDomain) ? emailDomain : null;

  return {
    name: name.slice(0, 150),
    domain,
    dedupeKey: companyDedupeKey({ domain, name }),
  };
}
