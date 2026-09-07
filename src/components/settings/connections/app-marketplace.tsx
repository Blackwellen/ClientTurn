"use client";

import Image from "next/image";
import * as React from "react";
import { ArrowUpRight, Check, Copy, Webhook, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AUTH_METHODS,
  CONNECTOR_STATUS_COPY,
  INSTALLABLE_APPS,
  connectorFor,
  type AuthMethod,
  type CredentialField,
} from "@/lib/integrations/apps";
import {
  generateConnectorSecret,
  installWorkspaceApp,
  listAppInstalls,
  uninstallWorkspaceApp,
  type AppInstall,
} from "@/lib/integrations/app-actions";
import { ConnectorOperations } from "./connector-operations";

/**
 * Settings → Connections.
 *
 * The framing here is load-bearing. Every entry is an inbound contact
 * endpoint, so the section says that once at the top and each card repeats it
 * — a Pipedrive tile that looks like the OAuth connections elsewhere in
 * Settings would promise a two-way sync this product does not have. For the
 * same reason a saved credential never renders as "Connected": the status
 * comes from what the endpoint has actually received.
 */

function CredentialInput({
  field,
  value,
  onChange,
  onGenerate,
}: {
  field: CredentialField;
  value: string;
  onChange: (next: string) => void;
  onGenerate?: () => void;
}) {
  const id = `cred-${field.key}`;
  const describedBy = field.help ? `${id}-help` : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {field.label}
        {field.required && (
          <span className="text-danger-600" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id={id}
          type={field.type === "secret" ? "password" : "text"}
          inputMode={field.type === "number" ? "numeric" : undefined}
          autoComplete={field.type === "secret" ? "new-password" : "off"}
          required={field.required}
          aria-required={field.required}
          aria-describedby={describedBy}
          minLength={field.minLength}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface p-3 text-sm"
        />
        {onGenerate && (
          <Button type="button" variant="secondary" size="sm" onClick={onGenerate}>
            Generate
          </Button>
        )}
      </div>
      {field.help && (
        <p id={describedBy} className="mt-1.5 text-xs text-content-muted">
          {field.help}
        </p>
      )}
    </div>
  );
}

/** The endpoint URL has to be absolute for someone to paste into another
 *  tool, but `window` does not exist during the server render. Subscribing
 *  with no-op teardown reads it on the client only, without the render-then-
 *  correct flash that a state-setting effect would produce. */
const NO_SUBSCRIBE = () => () => {};

function useOrigin() {
  return React.useSyncExternalStore(
    NO_SUBSCRIBE,
    () => window.location.origin,
    () => "",
  );
}

export function AppMarketplace({ canManage }: { canManage: boolean }) {
  const origin = useOrigin();
  const [installed, setInstalled] = React.useState<AppInstall[]>([]);
  const [appId, setAppId] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<AuthMethod>("hmac_sha256");
  const [credentials, setCredentials] = React.useState<Record<string, string>>({});
  const [label, setLabel] = React.useState("");
  const [sourceId, setSourceId] = React.useState("");
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    if (!canManage) return;
    listAppInstalls()
      .then(setInstalled)
      .catch(() => setError("Installed apps could not be loaded."));
  }, [canManage]);

  const chosen = appId ? connectorFor(appId) : undefined;
  const current = installed.find((i) => i.appKey === appId && i.active);
  const fields = AUTH_METHODS[method].fields;

  function openConnector(id: string) {
    const existing = installed.find((i) => i.appKey === id && i.active);
    setAppId(id);
    // Credentials are write-only: an existing install reopens with the fields
    // blank, because saving re-seals whatever is in the form and a masked
    // placeholder would be re-submitted as literal asterisks.
    setMethod(existing?.authMethod ?? "hmac_sha256");
    setCredentials({});
    setLabel(existing?.label ?? "");
    setSourceId(existing?.sourceId ?? "");
    setError("");
  }

  const missingRequired = fields.some(
    (f) => f.required && !(credentials[f.key] ?? "").trim(),
  );

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <div>
        <h2 className="text-base font-semibold">Inbound contact connections</h2>
        <p className="mt-1 text-sm text-content-muted">
          Each connection is an endpoint ClientTurn hosts for you: your other
          system posts contacts to it and they arrive in Find Leads for review.
          This is a one-way import, not a two-way sync — ClientTurn does not
          sign in to these tools and cannot read or change anything in them.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {INSTALLABLE_APPS.map((app) => {
          const install = installed.find((i) => i.appKey === app.id && i.active);
          const status = CONNECTOR_STATUS_COPY[install?.status ?? "not_configured"];

          return (
            <div
              key={app.id}
              className="flex min-w-0 flex-col rounded-xl border border-line p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  {app.domain ? (
                    <Image
                      src={`/brands/apps/${app.id}.png`}
                      alt=""
                      width={30}
                      height={30}
                      className="shrink-0 rounded-md object-contain"
                    />
                  ) : (
                    <Webhook className="size-7 shrink-0 text-content-muted" aria-hidden />
                  )}
                  <h3 className="truncate text-sm font-semibold">{app.name}</h3>
                </div>
                <span className="shrink-0 text-xs text-content-muted">
                  {app.category}
                </span>
              </div>

              <p className="mt-3 text-sm text-content-muted">{app.description}</p>

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canManage}
                  onClick={() => openConnector(app.id)}
                >
                  {install ? "Manage" : "Set up"}
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Button>
                {/* Tone is carried by the label as well as the colour, so the
                    state is readable without seeing the hue. */}
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>

      {chosen && (
        <div className="space-y-4 rounded-xl border border-content-accent bg-bg p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold">{chosen.name}</h3>
              <p className="text-sm text-content-muted">
                Inbound contact endpoint
              </p>
            </div>
            <button
              type="button"
              aria-label="Close connection setup"
              className="rounded-md p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
              onClick={() => setAppId(null)}
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {current && (
            <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
              <p className="text-sm font-medium">Your endpoint URL</p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-bg p-3 text-xs">
                  {origin}/api/apps/{current.id}/events
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(`${origin}/api/apps/${current.id}/events`)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                      .catch(() => setError("Could not copy. Select the URL instead."));
                  }}
                >
                  {copied ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <Copy className="size-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <dl className="grid gap-1 text-xs text-content-muted sm:grid-cols-2">
                <div>
                  <dt className="inline font-medium">Last accepted: </dt>
                  <dd className="inline">
                    {current.lastReceivedAt
                      ? new Date(current.lastReceivedAt).toLocaleString("en-GB")
                      : "No request yet"}
                  </dd>
                </div>
                {current.lastFailureAt && (
                  <div>
                    <dt className="inline font-medium">Last rejected: </dt>
                    <dd className="inline text-danger-600">
                      {new Date(current.lastFailureAt).toLocaleString("en-GB")}
                      {current.lastFailureReason
                        ? ` (${current.lastFailureReason.replace(/_/g, " ")})`
                        : ""}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {current && (
            <ConnectorOperations
              installId={current.id}
              authMethod={current.authMethod}
              canManage={canManage}
            />
          )}

          <fieldset>
            <legend className="text-sm font-medium">How the sender authenticates</legend>
            <div className="mt-2 space-y-2">
              {chosen.authMethods.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3 text-sm has-[:checked]:border-content-accent"
                >
                  <input
                    type="radio"
                    name="auth-method"
                    className="mt-1 shrink-0"
                    checked={method === key}
                    onChange={() => {
                      setMethod(key);
                      setCredentials({});
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{AUTH_METHODS[key].label}</span>
                    <span className="mt-0.5 block text-xs text-content-muted">
                      {AUTH_METHODS[key].summary}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {!AUTH_METHODS[method].signed && (
            <p
              role="note"
              className="rounded-lg border border-warning-100 bg-warning-50 p-3 text-xs text-warning-700"
            >
              A static credential cannot detect a replayed request. Use a signed
              request instead wherever your sender can compute an HMAC.
            </p>
          )}

          <div className="space-y-4">
            {fields.map((field) => (
              <CredentialInput
                key={field.key}
                field={field}
                value={credentials[field.key] ?? ""}
                onChange={(next) =>
                  setCredentials((c) => ({ ...c, [field.key]: next }))
                }
                onGenerate={
                  field.type === "secret" && field.key !== "header_name"
                    ? () =>
                        start(async () => {
                          try {
                            const value = await generateConnectorSecret();
                            setCredentials((c) => ({ ...c, [field.key]: value }));
                          } catch {
                            setError("Could not generate a secret. Enter one instead.");
                          }
                        })
                    : undefined
                }
              />
            ))}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="conn-label" className="block text-sm font-medium">
                  Connection name
                </label>
                <input
                  id="conn-label"
                  value={label}
                  maxLength={60}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={`e.g. ${chosen.name} — UK pipeline`}
                  className="mt-2 w-full rounded-lg border border-line-strong bg-surface p-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="conn-source" className="block text-sm font-medium">
                  Source identifier
                </label>
                <input
                  id="conn-source"
                  value={sourceId}
                  maxLength={40}
                  onChange={(e) => setSourceId(e.target.value)}
                  placeholder={chosen.id}
                  aria-describedby="conn-source-help"
                  className="mt-2 w-full rounded-lg border border-line-strong bg-surface p-3 text-sm"
                />
                <p id="conn-source-help" className="mt-1.5 text-xs text-content-muted">
                  Recorded against each imported contact for attribution.
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm text-content-muted">
            Contacts arrive in Find Leads for review. Setting up a connection
            does not start outreach, and imported contacts stay subject to
            suppression and contactability rules.{" "}
            <a href="/app/help#app-installs" className="text-content-accent underline">
              Payload format and signing instructions
            </a>
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              loading={pending}
              disabled={missingRequired}
              onClick={() =>
                start(async () => {
                  try {
                    const result = await installWorkspaceApp({
                      app: chosen.id,
                      authMethod: method,
                      credentials,
                      label,
                      sourceId,
                    });
                    if (result.error) {
                      setError(result.error);
                      return;
                    }
                    setError("");
                    setCredentials({});
                    setInstalled(await listAppInstalls());
                  } catch {
                    setError("Could not save this connection. Check your access and retry.");
                  }
                })
              }
            >
              {current ? "Save and rotate credentials" : "Create endpoint"}
            </Button>

            {current && (
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      const result = await uninstallWorkspaceApp(current.id);
                      setError(result.error ?? "");
                      setInstalled(await listAppInstalls());
                    } catch {
                      setError("Could not remove this connection.");
                    }
                  })
                }
              >
                Remove connection
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-content-muted">Need a different integration?</p>
        <Button
          variant="ghost"
          onClick={() => window.dispatchEvent(new Event("clientturn:support"))}
        >
          Contact support →
        </Button>
      </div>
    </section>
  );
}
