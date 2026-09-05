import "server-only";

export type LeadSourcePoller = {
  poll: (params: { integrationId: string; businessId: string }) => Promise<void>;
};

const registry = new Map<string, LeadSourcePoller>();

export function registerLeadSourcePoller(provider: string, poller: LeadSourcePoller) {
  registry.set(provider, poller);
}

export function isPollableLeadSource(provider: string): boolean {
  return registry.has(provider);
}

export function getLeadSourcePoller(provider: string): LeadSourcePoller {
  const poller = registry.get(provider);
  if (!poller) throw new Error(`No poller registered for ${provider}`);
  return poller;
}
