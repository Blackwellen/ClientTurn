import * as React from "react";
import { z } from "zod";
import Link from "next/link";
import { History } from "lucide-react";
import { getPlatformSettings } from "@/lib/admin/platform-settings";
import { SETTINGS_VIEWS } from "@/lib/admin/platform-settings-types";
import { SettingsView } from "@/components/admin/settings/settings-view";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  view: z.enum(SETTINGS_VIEWS).default("providers").catch("providers"),
  q: z.string().trim().max(80).default("").catch(""),
  provider: z.string().trim().max(60).optional().catch(undefined),
});

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const params = paramsSchema.parse({
    view: first(raw.view),
    q: first(raw.q),
    provider: first(raw.provider),
  });

  const data = await getPlatformSettings(params.view, params.provider);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-content sm:text-[30px]">
            Platform Settings
          </h1>
          <p className="mt-1 text-[14px] text-content-muted">
            Configure providers, AI agents, outreach, compliance, pricing and platform
            behaviour.
          </p>
        </div>
        {/*
          There is no page-level "Save changes": each section saves its own
          settings through its own guarded action, so a single button cannot
          quietly commit a change the operator made on a tab they have left.
        */}
        <Link
          href="/admin/settings?view=providers#change-log"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-content-secondary shadow-xs transition-colors hover:bg-surface-hover hover:text-content"
        >
          <History className="size-3.5" aria-hidden />
          View change log
        </Link>
      </div>

      <SettingsView data={data} search={params.q} />
    </div>
  );
}
