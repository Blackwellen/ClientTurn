"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Clock3, Link2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { formatRelative } from "@/lib/dates";
import { refreshConnectionHealth } from "@/lib/settings/actions";
import type { ConnectionHealthSummary as Summary } from "@/lib/integrations/catalog";

const TONES = {
  info: "bg-info-50 border-info-100 text-info-600",
  success: "bg-success-50 border-success-100 text-success-600",
  warning: "bg-warning-50 border-warning-100 text-warning-600",
  neutral: "bg-surface-sunken border-line text-content-muted",
} as const;

function Tile({
  icon: Icon,
  tone,
  value,
  label,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONES;
  value: string;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface px-4 py-4">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full border",
          TONES[tone],
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="lr-tabular text-[22px] font-semibold leading-[1.15] tracking-[-0.01em] text-content">
          {value}
        </p>
        <p className="truncate text-[13px] font-semibold text-content">{label}</p>
        <p className="truncate text-[12px] text-content-muted">{hint}</p>
      </div>
    </div>
  );
}

export function ConnectionHealthSummary({
  summary,
  canManage,
}: {
  summary: Summary;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function onRefresh() {
    setPending(true);
    const result = await refreshConnectionHealth();
    setPending(false);

    if (result.ok) {
      toast({ variant: "success", title: "Connection health refreshed" });
      router.refresh();
    } else {
      toast({
        variant: "error",
        title: "Could not refresh",
        description: result.error,
      });
    }
  }

  const lastCheck = summary.lastCheckedAt
    ? formatRelative(summary.lastCheckedAt)
    : null;

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Connection health"
          description="A quick overview of your integration health and sync status."
          action={
            <div className="flex items-center gap-3">
              <p className="hidden text-[12px] text-content-muted sm:block">
                Last updated: {lastCheck ?? "not run yet"}
              </p>
              {canManage && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  onClick={onRefresh}
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  Refresh
                </Button>
              )}
            </div>
          }
        />
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            icon={Link2}
            tone="info"
            value={String(summary.total)}
            label="Total providers"
            hint="Available integrations"
          />
          <Tile
            icon={CircleCheck}
            tone="success"
            value={String(summary.connected)}
            label="Connected"
            hint="Working properly"
          />
          <Tile
            icon={CircleAlert}
            tone="warning"
            value={String(summary.notAvailable + summary.needsAttention)}
            label={summary.needsAttention > 0 ? "Needs attention" : "Not available"}
            hint={
              summary.needsAttention > 0
                ? `${summary.needsAttention} need attention, ${summary.notAvailable} not connectable`
                : "Cannot be connected yet"
            }
          />
          <Tile
            icon={Clock3}
            tone="neutral"
            value={lastCheck ?? "—"}
            label="Last check"
            hint={
              summary.needsAttention === 0
                ? "All connected systems operational"
                : "Some connections need attention"
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
