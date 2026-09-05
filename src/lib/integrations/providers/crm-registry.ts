import "server-only";

export type CrmLeadInput = {
  id: string;
  business_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  postcode: string | null;
  status: string;
  qualification_state: string;
  created_at: string;
  services: { name: string; average_value: number | null } | null;
};

export type CrmPushResult = {
  externalContactId: string;
  externalDealId?: string | null;
};

export type CrmAdapter = {
  push: (params: { integrationId: string; lead: CrmLeadInput }) => Promise<CrmPushResult>;
};

const registry = new Map<string, CrmAdapter>();

export function registerCrmProvider(provider: "hubspot" | "zoho_crm", adapter: CrmAdapter) {
  registry.set(provider, adapter);
}

export function isCrmProvider(provider: string): provider is "hubspot" | "zoho_crm" {
  return registry.has(provider);
}

export function getCrmPushAdapter(provider: string): CrmAdapter {
  const adapter = registry.get(provider);
  if (!adapter) throw new Error(`No CRM adapter registered for ${provider}`);
  return adapter;
}
