"use client";

import * as React from "react";
import {
  CircleCheck,
  CircleDashed,
  MoreVertical,
  PauseCircle,
  Play,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { DropdownItem, DropdownMenu } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { setAutomationEnabled } from "@/lib/automations/actions";
import { FOLLOW_UP_STATE_META, type FollowUpStatus } from "@/lib/follow-up/types";
import { cn } from "@/lib/cn";

/**
 * The wide banner above the sequence editor: is follow-up actually running,
 * when did it last change, and who by.
 *
 * "Published" is rendered only from a persisted `published_at`, never from
 * optimistic local state — the whole point of the card is that it can be
 * trusted at a glance.
 */
export function FollowUpStatusCard({
  status,
  automation,
  canEdit,
}: {
  status: FollowUpStatus;
  automation: { id: string; enabled: boolean; leadsInSequence: number } | null;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const meta = FOLLOW_UP_STATE_META[status.state];
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const Icon =
    status.state === "published"
      ? CircleCheck
      : status.state === "paused"
        ? PauseCircle
        : CircleDashed;

  async function toggle() {
    if (!automation) return;
    setPending(true);
    try {
      const result = await setAutomationEnabled({
        automationId: automation.id,
        enabled: !automation.enabled,
      });
      if (result.ok) {
        toast({
          variant: "success",
          title: automation.enabled
            ? "Follow-up paused"
            : "Follow-up automation activated",
        });
        setConfirming(false);
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setPending(false);
    }
  }

  const updated = status.updatedAt ? new Date(status.updatedAt) : null;

  return (
    <>
      <Card className="px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span
            aria-hidden
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              status.state === "published"
                ? "bg-success-500 text-white"
                : status.state === "paused"
                  ? "bg-warning-50 text-warning-600"
                  : "bg-surface-sunken text-content-muted",
            )}
          >
            <Icon className="size-5" />
          </span>

          <div className="min-w-[14rem] flex-1">
            <h2 className="text-content text-[15px] font-semibold">{meta.title}</h2>
            <p className="text-content-muted mt-0.5 text-[12.5px]">
              {meta.description}
            </p>
          </div>

          <Badge tone={meta.tone} className="rounded-md px-2.5 py-1 text-[12px] font-semibold">
            {meta.badge}
          </Badge>

          <div className="border-line-subtle shrink-0 sm:border-l sm:pl-4">
            <p className="text-content-subtle text-[11.5px] leading-tight">Last updated</p>
            <p className="text-content lr-tabular mt-0.5 text-[12.5px] leading-tight font-medium">
              {updated
                ? new Intl.DateTimeFormat("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(updated)
                : "Not published yet"}
            </p>
            {status.updatedByInitials && (
              <p className="text-content-subtle mt-0.5 text-[11.5px] leading-tight">
                by{" "}
                <span title={status.updatedByName ?? undefined}>
                  {status.updatedByInitials}
                </span>
              </p>
            )}
          </div>

          {canEdit && automation && status.state !== "draft" && (
            <div className="shrink-0">
              <DropdownMenu
                trigger={
                  <IconButton variant="ghost" size="sm" label="Follow-up options">
                    <MoreVertical className="size-4" />
                  </IconButton>
                }
              >
                <DropdownItem
                  icon={automation.enabled ? PauseCircle : Play}
                  onSelect={() => setConfirming(true)}
                >
                  {automation.enabled ? "Pause follow-up" : "Resume follow-up"}
                </DropdownItem>
              </DropdownMenu>
            </div>
          )}
        </div>
      </Card>

      {automation && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          onConfirm={toggle}
          loading={pending}
          variant={automation.enabled ? "warning" : "default"}
          title={
            automation.enabled ? "Pause follow-up?" : "Resume follow-up?"
          }
          scope={`${automation.leadsInSequence} ${
            automation.leadsInSequence === 1 ? "lead is" : "leads are"
          } currently part-way through this sequence`}
          consequence={
            automation.enabled
              ? "No further step is sent. Leads mid-sequence are held at the step they reached and resume there when you switch it back on."
              : "Held leads resume from the step they reached, and every stop condition is re-checked immediately before each send."
          }
          confirmLabel={automation.enabled ? "Pause" : "Resume"}
        />
      )}
    </>
  );
}
