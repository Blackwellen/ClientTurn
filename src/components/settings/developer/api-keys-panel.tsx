"use client";

import * as React from "react";
import { Check, Copy, KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { createApiKeyAction, revokeApiKeyAction } from "@/lib/api-keys/actions";
import {
  API_KEY_EXPIRY_OPTIONS,
  API_KEY_STATUS_LABELS,
  API_KEY_STATUS_TONES,
  ENVIRONMENT_LABELS,
  apiKeyStatus,
  isAllowedIpEntry,
  maskedKey,
  type ApiKeyView,
} from "@/lib/api-keys/types";

/**
 * API keys (Settings → Developer).
 *
 * This panel hands out a credential that can read a workspace's leads from
 * anywhere on the internet, so it is written to make that visible rather than
 * convenient:
 *
 *   * **Nothing is pre-selected.** No default permissions, and an expiry that
 *     defaults to 90 days — the safe option is the one you have to actively
 *     leave alone, not the one you have to find.
 *   * **The key appears once**, in a dialog that says so, because only its
 *     digest is stored and there is no code path that could show it again.
 *   * **Refusals are shown next to successes.** A key being refused repeatedly
 *     is either a misconfiguration or someone probing, and both are worth
 *     noticing without going looking.
 */

type ScopeOption = { scope: string; label: string };

export function ApiKeysPanel({
  keys,
  scopeOptions,
  canManage,
}: {
  keys: ApiKeyView[];
  scopeOptions: ScopeOption[];
  canManage: boolean;
}) {
  const [creating, setCreating] = React.useState(false);
  const [issued, setIssued] = React.useState<null | {
    name: string;
    key: string;
  }>(null);

  const live = keys.filter((key) => !key.revokedAt);
  const revoked = keys.filter((key) => key.revokedAt);

  return (
    <section
      aria-labelledby="api-keys-heading"
      className="rounded-xl border border-line bg-surface p-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-content-secondary"
          >
            <KeyRound className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 id="api-keys-heading" className="text-[14px] font-semibold text-content">
              API keys
            </h3>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              Let your own software read and update this workspace over HTTPS.
              Each key gets only the permissions you choose, and acts with your
              access — never more.
            </p>
          </div>
        </div>

        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            New key
          </Button>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {live.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-content-muted">
            No API keys yet. Create one to call the ClientTurn API from your own
            systems.
          </p>
        ) : (
          live.map((key) => (
            <KeyRow key={key.id} apiKey={key} canManage={canManage} />
          ))
        )}
      </div>

      {revoked.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-content-muted">
            {revoked.length} revoked key{revoked.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 space-y-2">
            {revoked.map((key) => (
              <KeyRow key={key.id} apiKey={key} canManage={false} />
            ))}
          </div>
        </details>
      )}

      {creating && (
        <CreateKeyDialog
          scopeOptions={scopeOptions}
          onClose={() => setCreating(false)}
          onCreated={(value) => {
            setCreating(false);
            setIssued(value);
          }}
        />
      )}

      {issued && <KeyRevealDialog issued={issued} onClose={() => setIssued(null)} />}
    </section>
  );
}

/* -------------------------------------------------------------------- row */

function KeyRow({ apiKey, canManage }: { apiKey: ApiKeyView; canManage: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const status = apiKeyStatus(apiKey);

  async function revoke() {
    setPending(true);
    setError(null);
    const result = await revokeApiKeyAction({ keyId: apiKey.id });
    setPending(false);
    setConfirming(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-content">{apiKey.name}</span>
            <Badge tone={API_KEY_STATUS_TONES[status]} dense dot={status === "active"}>
              {API_KEY_STATUS_LABELS[status]}
            </Badge>
            {apiKey.environment === "test" && (
              <Badge tone="neutral" dense>
                {ENVIRONMENT_LABELS.test}
              </Badge>
            )}
          </div>

          <code className="mt-1 block font-mono text-[11.5px] text-content-subtle">
            {maskedKey(apiKey)}
          </code>

          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-content-subtle">
            <span>Acts as {apiKey.ownerIsCaller ? "you" : apiKey.ownerName}</span>
            <span>
              {apiKey.lastUsedAt
                ? `Last used ${new Date(apiKey.lastUsedAt).toLocaleDateString("en-GB")}`
                : "Never used"}
            </span>
            {apiKey.recentRequests > 0 && (
              <span>{apiKey.recentRequests} calls in 7 days</span>
            )}
            {apiKey.expiresAt && (
              <span>
                {status === "expired" ? "Expired" : "Expires"}{" "}
                {new Date(apiKey.expiresAt).toLocaleDateString("en-GB")}
              </span>
            )}
            {apiKey.allowedIps.length > 0 && (
              <span>{apiKey.allowedIps.length} allowed address ranges</span>
            )}
          </p>

          {apiKey.recentDenials > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-warning-700">
              <ShieldAlert aria-hidden className="size-3.5 shrink-0" />
              {apiKey.recentDenials} request
              {apiKey.recentDenials === 1 ? " was" : "s were"} refused in the last
              7 days.
            </p>
          )}

          <ul className="mt-1.5 flex flex-wrap gap-1">
            {apiKey.scopes.map((scope) => (
              <li key={scope}>
                <Badge tone="neutral" dense>
                  {scope}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        {canManage && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setConfirming(true)}
            aria-label={`Revoke ${apiKey.name}`}
          >
            <Trash2 aria-hidden className="size-3.5" />
          </Button>
        )}
      </div>

      {error && <p className="mt-2 text-[12px] text-danger-700">{error}</p>}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Revoke ${apiKey.name}?`}
        description="Anything using this key stops working immediately. This cannot be undone — you would need to create a new key and update whatever uses it."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={pending} onClick={revoke}>
              Revoke
            </Button>
          </>
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------------- create */

function CreateKeyDialog({
  scopeOptions,
  onClose,
  onCreated,
}: {
  scopeOptions: ScopeOption[];
  onClose: () => void;
  onCreated: (value: { name: string; key: string }) => void;
}) {
  const [name, setName] = React.useState("");
  const [environment, setEnvironment] = React.useState<"live" | "test">("live");
  // Nothing is pre-selected. A default set of permissions is a decision made on
  // the customer's behalf about what leaves their workspace.
  const [scopes, setScopes] = React.useState<string[]>([]);
  const [expiry, setExpiry] = React.useState<string>("90");
  const [ipText, setIpText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const allowedIps = ipText
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const badIp = allowedIps.find((entry) => !isAllowedIpEntry(entry));

  function toggle(scope: string) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((value) => value !== scope)
        : [...current, scope],
    );
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await createApiKeyAction({
      name,
      environment,
      scopes,
      expiry,
      allowedIps,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated({ name, key: result.data.key });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New API key"
      description="Choose what this key may do. It acts with your access, and can never do more than you can."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!name.trim() || scopes.length === 0 || Boolean(badIp)}
            onClick={submit}
          >
            Create key
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="text-[12.5px] font-medium text-content">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="Zapier — lead sync"
            className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-content outline-none focus:border-accent-400"
          />
          <span className="mt-1 block text-[11.5px] text-content-subtle">
            So you can tell your keys apart later, and know what to turn off.
          </span>
        </label>

        <fieldset>
          <legend className="text-[12.5px] font-medium text-content">Permissions</legend>
          <ul className="mt-1.5 space-y-1">
            {scopeOptions.map((option) => (
              <li key={option.scope}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={scopes.includes(option.scope)}
                    onChange={() => toggle(option.scope)}
                    className="mt-0.5 size-3.5 shrink-0 accent-accent-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-content">
                      {option.label}
                    </span>
                    <span className="block font-mono text-[11px] text-content-subtle">
                      {option.scope}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12.5px] font-medium text-content">Expires</span>
            <select
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-content outline-none focus:border-accent-400"
            >
              {API_KEY_EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[12.5px] font-medium text-content">Environment</span>
            <select
              value={environment}
              onChange={(event) =>
                setEnvironment(event.target.value === "test" ? "test" : "live")
              }
              className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-content outline-none focus:border-accent-400"
            >
              <option value="live">Live</option>
              <option value="test">Test</option>
            </select>
            <span className="mt-1 block text-[11.5px] text-content-subtle">
              Both read the same workspace. The label tells you which is which.
            </span>
          </label>
        </div>

        <label className="block">
          <span className="text-[12.5px] font-medium text-content">
            Only allow these addresses{" "}
            <span className="font-normal text-content-subtle">(optional)</span>
          </span>
          <textarea
            value={ipText}
            onChange={(event) => setIpText(event.target.value)}
            rows={2}
            placeholder="203.0.113.4, 198.51.100.0/24"
            className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[12px] text-content outline-none focus:border-accent-400"
          />
          <span className="mt-1 block text-[11.5px] text-content-subtle">
            If your integration runs from a fixed address, listing it here means a
            stolen key is useless from anywhere else.
          </span>
        </label>

        {badIp && (
          <p className="text-[12px] text-danger-700">
            &ldquo;{badIp}&rdquo; is not a valid IP address or range.
          </p>
        )}
        {error && <p className="text-[12px] text-danger-700">{error}</p>}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- reveal */

function KeyRevealDialog({
  issued,
  onClose,
}: {
  issued: { name: string; key: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The browser can refuse clipboard access. The value is on screen and
      // selectable, so there is nothing to recover from.
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Copy this key now"
      description="This is the only time it will be shown. ClientTurn stores only a fingerprint of it, so it cannot be shown again — if you lose it, create a new one."
      footer={<Button onClick={onClose}>I have copied it</Button>}
    >
      <div className="space-y-3">
        <div>
          <span className="text-[12px] font-medium text-content-secondary">
            {issued.name}
          </span>
          <div className="mt-1 flex items-start gap-1.5">
            <code className="block flex-1 overflow-x-auto rounded-md border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11.5px] text-content">
              {issued.key}
            </code>
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? (
                <Check aria-hidden className="size-3.5" />
              ) : (
                <Copy aria-hidden className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <p className="text-[12px] text-content-muted">
          Send it as{" "}
          <code className="font-mono">Authorization: Bearer …</code> from your own
          server. Never put it in a web page or a mobile app — anyone who can view
          the page can read the key.
        </p>
      </div>
    </Modal>
  );
}
