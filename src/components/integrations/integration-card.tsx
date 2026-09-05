"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Mail,
  MessageCircle,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/modal";
import { PlanLimitState } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/dates";
import {
  accountReference,
  formMappingState,
  primaryActionLabel,
  type IntegrationCategory,
  type IntegrationObjectRecord,
  type ProviderCardModel,
} from "@/lib/integrations/catalog";
import { connectProviderToken, disconnectIntegration } from "@/lib/settings/actions";
import { TokenConnectDialog } from "./token-connect-dialog";

/** Category glyph only — never a fabricated brand logo. */
const CATEGORY_ICON: Record<IntegrationCategory, React.ComponentType<{ className?: string }>> = {
  leads: Zap,
  messaging: MessageCircle,
  booking: CalendarClock,
  email: Mail,
  crm: Building2,
};

function MetaObjects({
  pages,
  forms,
}: {
  pages: IntegrationObjectRecord[];
  forms: IntegrationObjectRecord[];
}) {
  if (pages.length === 0 && forms.length === 0) {
    return (
      <p className="text-content-muted border-line mt-4 border-t pt-3 text-[13px]">
        No Pages or lead forms have been selected yet. Choose them in Configure so
        Client Turn knows which forms to listen to.
      </p>
    );
  }

  return (
    <div className="border-line mt-4 space-y-3 border-t pt-3">
      <div>
        <p className="text-content-subtle text-[12px] font-medium uppercase tracking-wide">
          Pages
        </p>
        <ul className="mt-1.5 space-y-1">
          {pages.map((page) => (
            <li
              key={page.id}
              className="flex items-center justify-between gap-3 text-[13px]"
            >
              <span className="text-content truncate">
                {page.name ?? page.externalId}
              </span>
              <Badge tone={page.enabled ? "success" : "neutral"} dot>
                {page.enabled ? "Active" : "Paused"}
              </Badge>
            </li>
          ))}
          {pages.length === 0 && (
            <li className="text-content-muted text-[13px]">No Pages selected.</li>
          )}
        </ul>
      </div>

      <div>
        <p className="text-content-subtle text-[12px] font-medium uppercase tracking-wide">
          Lead forms
        </p>
        <ul className="mt-1.5 space-y-1">
          {forms.map((form) => {
            const state = formMappingState(form);
            return (
              <li
                key={form.id}
                className="flex items-center justify-between gap-3 text-[13px]"
              >
                <span className="text-content truncate">
                  {form.name ?? form.externalId}
                </span>
                <Badge tone={state.tone} dot>
                  {state.label}
                </Badge>
              </li>
            );
          })}
          {forms.length === 0 && (
            <li className="text-content-muted text-[13px]">
              No lead forms selected.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

export function IntegrationCard({
  model,
  canManage,
  metaPages,
  metaForms,
}: {
  model: ProviderCardModel;
  canManage: boolean;
  metaPages?: IntegrationObjectRecord[];
  metaForms?: IntegrationObjectRecord[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const { definition, integration, block, connected } = model;
  const reference = accountReference(integration);
  const actionLabel = primaryActionLabel(model);
  const CategoryIcon = CATEGORY_ICON[definition.category];

  async function handleDisconnect() {
    setPending(true);
    const result = await disconnectIntegration(definition.id);
    setPending(false);
    setConfirming(false);

    if (result.ok) {
      toast({
        variant: "success",
        title: `${definition.name} disconnected`,
      });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Not disconnected", description: result.error });
    }
  }

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="bg-surface-sunken border-line flex size-10 shrink-0 items-center justify-center rounded-lg border">
              <CategoryIcon className="text-content-accent size-4.5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-content text-[15px] font-semibold">
                {definition.name}
              </h3>
              <p className="text-content-muted mt-1 text-[13px]">
                {definition.summary}
              </p>
            </div>
          </div>
          <StatusBadge kind="integration" value={model.status} className="shrink-0" />
        </div>

        <dl className="border-line mt-4 space-y-1.5 border-t pt-3">
          {reference && (
            <div className="flex items-baseline gap-2">
              <dt className="text-content-subtle w-32 shrink-0 text-[12px]">
                {definition.accountLabel}
              </dt>
              <dd className="text-content truncate text-[13px]">{reference}</dd>
            </div>
          )}
          {connected && (
            <div className="flex items-baseline gap-2">
              <dt className="text-content-subtle w-32 shrink-0 text-[12px]">
                Last successful sync
              </dt>
              <dd className="text-content text-[13px]">
                {integration?.lastSuccessAt
                  ? formatRelative(integration.lastSuccessAt)
                  : "No successful sync yet"}
              </dd>
            </div>
          )}
          {!reference && !connected && (
            <p className="text-content-subtle text-[13px]">Not connected yet.</p>
          )}
        </dl>

        {integration?.lastErrorMessage && model.status !== "HEALTHY" && (
          <p className="border-danger-100 bg-danger-50 text-danger-700 mt-3 flex items-start gap-1.5 rounded-md border px-3 py-2 text-[13px]">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{integration.lastErrorMessage}</span>
          </p>
        )}

        {block?.kind === "plan" && (
          <div className="mt-4">
            <PlanLimitState
              title="Not included in your plan"
              description={block.reason}
              action={
                <Link
                  href="/app/settings/billing"
                  className="text-content-accent focus-visible:outline-content-accent inline-block rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Compare plans
                </Link>
              }
            />
          </div>
        )}

        {block?.kind === "unavailable" && (
          <div className="border-line bg-surface-sunken mt-4 rounded-lg border px-3 py-2.5">
            <p className="text-content text-[13px] font-medium">Not yet available</p>
            <p className="text-content-muted mt-1 text-[13px]">{block.reason}</p>
          </div>
        )}

        {definition.connection === "platform" && !block && (
          <p className="text-content-muted mt-4 flex items-start gap-1.5 text-[13px]">
            <ShieldCheck className="text-success-600 mt-0.5 size-3.5 shrink-0" aria-hidden />
            Run by Client Turn on your behalf. There is nothing to connect.
          </p>
        )}

        {definition.id === "meta" && connected && (
          <MetaObjects pages={metaPages ?? []} forms={metaForms ?? []} />
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          {actionLabel && canManage && (
            <Button
              size="sm"
              variant={connected ? "secondary" : "primary"}
              disabled={definition.connectionMethod === "oauth" && !definition.connectPath}
              onClick={() => {
                if (definition.connectionMethod === "token") {
                  setTokenDialogOpen(true);
                } else if (definition.connectPath) {
                  router.push(definition.connectPath);
                }
              }}
            >
              {actionLabel}
            </Button>
          )}

          {connected && canManage && definition.connection === "workspace" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger-600 hover:bg-danger-50"
              onClick={() => setConfirming(true)}
            >
              Disconnect
            </Button>
          )}

          {!canManage && (
            <p className="text-content-subtle text-[12px]">
              Only an owner or admin can change connections.
            </p>
          )}
        </div>
      </CardContent>

      {definition.connectionMethod === "token" && (
        <TokenConnectDialog
          open={tokenDialogOpen}
          providerName={definition.name}
          helpUrl={
            definition.id === "hubspot"
              ? "https://developers.hubspot.com/docs/api/private-apps"
              : "#"
          }
          onClose={() => setTokenDialogOpen(false)}
          onSubmit={(token) => connectProviderToken(definition.id, token)}
        />
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={handleDisconnect}
        loading={pending}
        variant="danger"
        title={`Disconnect ${definition.name}?`}
        scope={`This removes the connection between ${definition.name} and this workspace, and deletes the stored credentials.`}
        consequence={definition.disconnectConsequence}
        confirmLabel="Disconnect"
      />
    </Card>
  );
}
