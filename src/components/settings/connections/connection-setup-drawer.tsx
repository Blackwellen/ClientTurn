"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerHeader } from "@/components/ui/drawer";
import { FormField, Input } from "@/components/ui/form";
import { IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { X } from "lucide-react";
import { formatRelative } from "@/lib/dates";
import {
  AVAILABILITY_META,
  accountReference,
  connectionActions,
  type ProviderCardModel,
} from "@/lib/integrations/catalog";
import {
  connectProviderToken,
  disconnectIntegration,
  testConnection,
} from "@/lib/settings/actions";
import { ProviderIcon } from "./provider-icon";

/**
 * Every provider is configured here rather than on its own page. Secrets are
 * write-only: a stored credential is shown as a mask and never returned by the
 * server, so this form can replace one but never reveal it.
 */
export function ConnectionSetupDrawer({
  model,
  onClose,
}: {
  model: ProviderCardModel | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [token, setToken] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!model) {
    return <Drawer open={false} onClose={onClose} title="" anchor="content">{null}</Drawer>;
  }

  const { definition, integration } = model;
  const actions = connectionActions(model);
  const meta = AVAILABILITY_META[actions.availability];
  const reference = accountReference(integration);
  const isTokenProvider = definition.connectionMethod === "token";

  async function onConnectOAuth() {
    if (!definition.connectPath) return;
    // The connect route is a server route handler: it mints the OAuth state
    // server-side, so the browser never constructs the authorize URL itself.
    window.location.href = definition.connectPath;
  }

  async function onConnectToken(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await connectProviderToken(definition.id, token.trim());
    setPending(false);

    if (result.ok) {
      setToken("");
      toast({ variant: "success", title: "Connection successful" });
      onClose();
      router.refresh();
    } else {
      setError(result.error);
    }
  }

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

  async function onDisconnect() {
    setPending(true);
    const result = await disconnectIntegration(definition.id);
    setPending(false);
    setConfirmDisconnect(false);

    if (result.ok) {
      toast({ variant: "success", title: "Integration disconnected" });
      onClose();
      router.refresh();
    } else {
      toast({
        variant: "error",
        title: "Not disconnected",
        description: result.error,
      });
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        anchor="content"
        size="panel"
        title={definition.name}
        header={
          <DrawerHeader>
            <div className="flex min-w-0 items-start gap-3">
              <ProviderIcon provider={definition.id} />
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold text-content">
                  {definition.name}
                </h2>
                <div className="mt-1">
                  <Badge tone={meta.tone} dot>
                    {meta.label}
                  </Badge>
                </div>
              </div>
            </div>
            <IconButton size="sm" label="Close panel" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </DrawerHeader>
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            {isTokenProvider && !model.connected && (
              <Button
                size="sm"
                type="submit"
                form="connection-token-form"
                loading={pending}
              >
                Connect
              </Button>
            )}
            {!isTokenProvider && actions.primaryLabel && (
              <Button size="sm" onClick={onConnectOAuth} disabled={!definition.connectPath}>
                {actions.primaryLabel}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-5">
          <p className="text-[13px] text-content-secondary">{definition.summary}</p>

          <section className="space-y-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">
              Account
            </h3>
            <dl className="space-y-2 rounded-lg border border-line px-3.5 py-3 text-[13px]">
              <div className="flex items-baseline gap-3">
                <dt className="w-36 shrink-0 text-content-subtle">
                  {definition.accountLabel}
                </dt>
                <dd className="min-w-0 truncate text-content">
                  {reference ?? "Not connected yet"}
                </dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-36 shrink-0 text-content-subtle">
                  Last successful sync
                </dt>
                <dd className="min-w-0 text-content">
                  {integration?.lastSuccessAt
                    ? formatRelative(integration.lastSuccessAt)
                    : "No successful sync yet"}
                </dd>
              </div>
              {integration?.lastErrorAt && (
                <div className="flex items-baseline gap-3">
                  <dt className="w-36 shrink-0 text-content-subtle">Last error</dt>
                  <dd className="min-w-0 text-danger-700">
                    {integration.lastErrorMessage ??
                      formatRelative(integration.lastErrorAt)}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {isTokenProvider && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">
                Credentials
              </h3>
              {model.connected ? (
                <FormField
                  label="Stored access token"
                  htmlFor="connection-token-stored"
                  hint="Stored credentials are never shown again. Disconnect and reconnect to replace one."
                >
                  <Input
                    id="connection-token-stored"
                    value="••••••••••••••••"
                    readOnly
                    disabled
                  />
                </FormField>
              ) : (
                <form id="connection-token-form" onSubmit={onConnectToken}>
                  <FormField
                    label={`${definition.name} access token`}
                    htmlFor="connection-token"
                    required
                    error={error ?? undefined}
                    hint="Held server-side and encrypted at rest. It is never returned to the browser."
                  >
                    <Input
                      id="connection-token"
                      type="password"
                      autoComplete="off"
                      required
                      value={token}
                      aria-invalid={Boolean(error) || undefined}
                      onChange={(event) => setToken(event.target.value)}
                    />
                  </FormField>
                </form>
              )}
            </section>
          )}

          {model.block?.kind === "unavailable" && (
            <div className="rounded-lg border border-warning-100 bg-warning-50 px-3.5 py-3">
              <p className="text-[13px] font-semibold text-warning-700">
                Not yet available
              </p>
              <p className="mt-1 text-[13px] text-warning-700/90">
                {model.block.reason}
              </p>
            </div>
          )}

          {model.connected && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">
                Connection test
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={testing}
                  onClick={onTest}
                >
                  {testing ? "Testing…" : "Test connection"}
                </Button>
                <p className="text-[12px] text-content-muted">
                  Checks credentials only. Nothing is sent to a customer.
                </p>
              </div>
            </section>
          )}

          {actions.canDisconnect && (
            <section className="space-y-2 border-t border-line pt-4">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">
                Disconnect
              </h3>
              <p className="text-[13px] text-content-muted">
                {definition.disconnectConsequence}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger-600 hover:bg-danger-50"
                onClick={() => setConfirmDisconnect(true)}
              >
                Disconnect {definition.name}
              </Button>
            </section>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={onDisconnect}
        loading={pending}
        variant="danger"
        title={`Disconnect ${definition.name}?`}
        scope={`${definition.name} stops working for this workspace straight away.`}
        consequence={definition.disconnectConsequence}
        confirmLabel="Disconnect"
      />
    </>
  );
}
