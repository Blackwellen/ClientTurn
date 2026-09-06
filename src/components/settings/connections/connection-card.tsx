"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock3, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/dates";
import {
  AVAILABILITY_META,
  accountReference,
  connectionActions,
  type ProviderCardModel,
} from "@/lib/integrations/catalog";
import { testConnection } from "@/lib/settings/actions";
import { ProviderIcon } from "./provider-icon";

/** Amber "cannot be connected" panel, matching the platform-credential state. */
function NotAvailablePanel({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-warning-100 bg-warning-50 px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-warning-700">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        Not yet available
      </p>
      <p className="mt-1 text-[12px] leading-[1.45] text-warning-700/90">{reason}</p>
    </div>
  );
}

export function ConnectionCard({
  model,
  canManage,
  onOpenSetup,
}: {
  model: ProviderCardModel;
  canManage: boolean;
  onOpenSetup: (model: ProviderCardModel) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [testing, setTesting] = React.useState(false);

  const { definition, integration, block } = model;
  const actions = connectionActions(model);
  const meta = AVAILABILITY_META[actions.availability];
  const reference = accountReference(integration);
  const isPlatform = definition.connection === "platform";

  async function onTest() {
    setTesting(true);
    const result = await testConnection(definition.id);
    setTesting(false);

    if (result.ok) {
      toast({ variant: "success", title: "Connection tested successfully" });
    } else {
      toast({
        variant: "error",
        title: "Connection requires attention",
        description: result.error,
      });
    }
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start gap-2.5">
        <ProviderIcon provider={definition.id} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[13.5px] font-semibold leading-tight text-content">
            {definition.name}
          </h3>
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
        </div>
      </div>

      <p className="text-[12.5px] leading-[1.45] text-content-muted">
        {definition.summary}
      </p>

      {reference && (
        <p className="truncate text-[12px] text-content-secondary">
          <span className="text-content-subtle">{definition.accountLabel}: </span>
          {reference}
        </p>
      )}

      {(model.connected || isPlatform) && !block && (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-sunken/50 px-2.5 py-2">
          <Clock3 className="mt-0.5 size-3.5 shrink-0 text-content-muted" aria-hidden />
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-content">
              Last successful sync
            </p>
            <p className="text-[12px] text-content-muted">
              {integration?.lastSuccessAt
                ? formatRelative(integration.lastSuccessAt)
                : "No successful sync yet"}
            </p>
          </div>
        </div>
      )}

      {model.connected && !meta.healthy && integration?.lastErrorMessage && (
        <p className="flex items-start gap-1.5 rounded-lg border border-danger-100 bg-danger-50 px-2.5 py-2 text-[12px] leading-[1.45] text-danger-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{integration.lastErrorMessage}</span>
        </p>
      )}

      {block?.kind === "unavailable" && <NotAvailablePanel reason={block.reason} />}

      {block?.kind === "plan" && (
        <div className="rounded-lg border border-line bg-surface-sunken px-2.5 py-2">
          <p className="text-[12px] font-semibold text-content">
            Not included in your plan
          </p>
          <p className="mt-1 text-[12px] leading-[1.45] text-content-muted">
            {block.reason}
          </p>
          <Link
            href="/app/settings?section=billing"
            className="mt-1.5 inline-block rounded-xs text-[12px] font-medium text-content-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
          >
            Compare plans
          </Link>
        </div>
      )}

      {isPlatform && !block && (
        <p className="flex items-start gap-1.5 rounded-lg border border-info-100 bg-info-50 px-2.5 py-2 text-[12px] leading-[1.45] text-info-700">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">
              Run by Client Turn on your behalf.
            </span>{" "}
            There is nothing to connect.
          </span>
        </p>
      )}

      {/* Actions pin to the bottom so cards in a row line up however tall
          their descriptions and health panels happen to be. */}
      <div className="mt-auto space-y-2 pt-0.5">
        {actions.availability === "NOT_AVAILABLE" && !isPlatform && (
          <Button
            size="sm"
            variant="secondary"
            fullWidth
            disabled
            // A flat filled block rather than an outlined button: this is a
            // state, not an action waiting to be taken.
            className="border-transparent bg-surface-sunken text-content-subtle shadow-none"
          >
            Not yet available
          </Button>
        )}

        {canManage && actions.primaryLabel && actions.availability !== "NOT_AVAILABLE" && (
          <Button
            size="sm"
            fullWidth
            variant={actions.canReconnect ? "secondary" : "primary"}
            onClick={() => onOpenSetup(model)}
          >
            {actions.primaryLabel}
          </Button>
        )}

        {canManage && (actions.canTest || actions.canConfigure) && (
          <div className="flex gap-2">
            {actions.canTest && (
              <Button
                size="sm"
                variant="secondary"
                fullWidth
                loading={testing}
                onClick={onTest}
              >
                {testing ? "Testing…" : "Test connection"}
              </Button>
            )}
            {actions.canConfigure && (
              <Button
                size="sm"
                variant="secondary"
                fullWidth
                onClick={() => onOpenSetup(model)}
              >
                Manage
              </Button>
            )}
          </div>
        )}

        {!canManage && !isPlatform && (
          <p className="text-[12px] text-content-subtle">
            Only an owner or admin can change connections.
          </p>
        )}
      </div>
    </div>
  );
}
