"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, EyeOff, ShieldOff, Trash2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DataRightsMode } from "@/lib/data-rights/wording";
import type { ActionAvailability, LeadPageAction } from "@/lib/leads/detail-page";
import {
  anonymiseLeadAction,
  deleteLeadAction,
  exportLeadAction,
  leadCrmSystemsAction,
  suppressLeadAction,
} from "@/lib/data-rights/actions";
import { LeadDataRightsDialogs } from "../lead-data-rights";

/**
 * The Data rights tab's actions: the drawer's own dialogs (lib/data-rights
 * wording, never "deleted" when something remains), opened from here. Each
 * runs a DESTRUCTIVE or admin-only registry operation behind its dialog.
 */
export function LeadPageDataRights({
  leadId,
  availability,
}: {
  leadId: string;
  availability: Record<LeadPageAction, ActionAvailability>;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<DataRightsMode | null>(null);

  const actions = React.useMemo(
    () => ({
      suppress: async (input: { leadId: string; channel: string; reason: string }) => {
        const result = await suppressLeadAction(input);
        if (result.ok) router.refresh();
        return result;
      },
      anonymise: async (input: { leadId: string; alsoRemoveFromCrm?: boolean }) => {
        const result = await anonymiseLeadAction(input);
        if (result.ok) router.refresh();
        return result;
      },
      erase: deleteLeadAction,
      exportData: exportLeadAction,
      crmSystems: leadCrmSystemsAction,
    }),
    [router],
  );

  const items: {
    mode: DataRightsMode;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    state: ActionAvailability;
    danger?: boolean;
  }[] = [
    { mode: "SUPPRESS", label: "Suppress…", icon: ShieldOff, state: availability.suppress },
    { mode: "RESTRICT", label: "Restrict processing…", icon: EyeOff, state: availability.suppress },
    { mode: "EXPORT", label: "Export data…", icon: Download, state: availability.export },
    { mode: "ANONYMISE", label: "Anonymise…", icon: UserX, state: availability.anonymise, danger: true },
    { mode: "DELETE", label: "Erase…", icon: Trash2, state: availability.delete, danger: true },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.mode}
              size="sm"
              variant="secondary"
              disabled={!item.state.allowed}
              title={item.state.reason ?? undefined}
              onClick={() => setMode(item.mode)}
            >
              <Icon className={item.danger ? "size-3.5 text-danger-500" : "size-3.5 text-content-subtle"} />
              {item.label}
              {!item.state.allowed && item.state.reason && <span className="sr-only">. {item.state.reason}</span>}
            </Button>
          );
        })}
      </div>

      <LeadDataRightsDialogs
        leadId={leadId}
        mode={mode}
        onClose={() => setMode(null)}
        onErased={() => router.push("/app/leads")}
        actions={actions}
      />
    </>
  );
}
