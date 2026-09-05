import * as React from "react";
import { z } from "zod";
import {
  getAiUsageStats,
  getEconomicsStats,
  getIntegrationsTab,
  getMessagingStats,
  getWebhookProviders,
  listJobErrors,
  listWebhookEvents,
} from "@/lib/admin/queries";
import { PageHeader } from "@/components/app/page-header";
import { SystemTabs } from "@/components/admin/system-tabs";

export const dynamic = "force-dynamic";

const SYSTEM_TABS = [
  "integrations",
  "webhooks",
  "messaging",
  "ai",
  "economics",
  "billing",
  "errors",
] as const;

const paramsSchema = z.object({
  tab: z.enum(SYSTEM_TABS).default("integrations").catch("integrations"),
  provider: z.string().trim().max(40).default("all").catch("all"),
  status: z.string().trim().max(40).default("all").catch("all"),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});

export default async function AdminSystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const params = paramsSchema.parse({
    tab: first(raw.tab),
    provider: first(raw.provider),
    status: first(raw.status),
    page: first(raw.page),
  });

  const isWebhookTab = params.tab === "webhooks" || params.tab === "billing";

  const [integrations, webhooks, providers, messaging, ai, economics, errors] =
    await Promise.all([
      params.tab === "integrations" ? getIntegrationsTab() : null,
      isWebhookTab
        ? listWebhookEvents({
            provider: params.tab === "billing" ? "stripe" : params.provider,
            status: params.status,
            page: params.page,
            pageSize: 25,
            onlyStripe: params.tab === "billing",
          })
        : null,
      isWebhookTab ? getWebhookProviders() : null,
      params.tab === "messaging" ? getMessagingStats() : null,
      params.tab === "ai" ? getAiUsageStats() : null,
      params.tab === "economics" ? getEconomicsStats() : null,
      params.tab === "errors" ? listJobErrors(50) : null,
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="System"
        description="Provider health, webhook delivery, messaging volume and job failures."
      />
      <SystemTabs
        tab={params.tab}
        provider={params.provider}
        status={params.status}
        page={params.page}
        integrations={integrations}
        webhooks={webhooks}
        providers={providers}
        messaging={messaging}
        ai={ai}
        economics={economics}
        errors={errors}
      />
    </div>
  );
}
