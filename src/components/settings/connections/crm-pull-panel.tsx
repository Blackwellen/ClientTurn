"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DownloadCloud } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { setCrmPullAction } from "@/lib/settings/channel-actions";
import type { CrmPullView } from "@/lib/services/operations/channels";

function when(iso: string | null): string {
  if (!iso) return "Not run yet";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * The opt-in inbound sync per connected CRM (brief §29). Off by default. When
 * on, new and changed contacts are recorded as leads with the relationship
 * "imported" -- nobody is messaged because a CRM held their details.
 */
export function CrmPullPanel({
  crms,
  canManage,
}: {
  crms: CrmPullView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);

  if (crms.length === 0) return null;

  async function toggle(crm: CrmPullView, enabled: boolean) {
    setPending(crm.integrationId);
    const result = await setCrmPullAction({ integrationId: crm.integrationId, enabled });
    setPending(null);
    if (result.ok) {
      toast({ variant: "success", title: result.message });
      router.refresh();
    } else {
      toast({ variant: "error", title: result.error });
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={DownloadCloud}
          title="Import contacts from your CRM"
          description="New and updated contacts become leads, marked as imported. Nobody is messaged automatically because they are in your CRM, and leads we sent to your CRM are never imported back."
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {crms.map((crm) => (
          <div
            key={crm.integrationId}
            className="border-line flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-content text-[13px] font-medium">{crm.label}</p>
              <p className="text-content-muted text-[12px]">
                {crm.enabled ? (
                  <>
                    Last checked {when(crm.lastRunAt)}
                    {crm.lastRunAt
                      ? ` · ${crm.lastRunIngested} imported, ${crm.lastRunSkipped} skipped`
                      : ""}
                  </>
                ) : (
                  "Off. Switch on to import contacts added or changed from now on."
                )}
              </p>
              {crm.enabled && crm.lastRunError && (
                <p className="text-warning-700 mt-0.5 text-[12px]">{crm.lastRunError}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {crm.enabled && crm.lastRunStatus && (
                <StatusBadge kind="crm_pull_run" value={crm.lastRunStatus} dense />
              )}
              <Switch
                label={`Import contacts from ${crm.label}`}
                checked={crm.enabled}
                disabled={!canManage || pending === crm.integrationId}
                onCheckedChange={(checked) => void toggle(crm, checked)}
              />
            </div>
          </div>
        ))}
        {!canManage && (
          <p className="text-content-muted text-[12px]">Only owners and admins can change CRM imports.</p>
        )}
      </CardContent>
    </Card>
  );
}
