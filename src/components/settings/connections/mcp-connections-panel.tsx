"use client";

import * as React from "react";
import { Check, Copy, KeyRound, Plug, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  createMcpClientAction,
  issueMcpTokenAction,
  revokeMcpClientAction,
  approveMcpRequestAction,
  rejectMcpRequestAction,
} from "@/lib/mcp/actions";
import type { McpConnection, McpPendingApproval } from "@/lib/mcp/queries";

/**
 * Assistant connections (Programme §1).
 *
 * This panel is where a workspace hands an outside assistant — Claude, Codex,
 * Gemini — a key to its own data, so it is written to make the consequences of
 * that visible rather than convenient:
 *
 *   * **Permissions are chosen explicitly.** There is no "all access" option and
 *     no default selection. Someone has to decide what the assistant may do.
 *   * **The secret appears once.** It is shown in a dialog that says so, and it
 *     cannot be retrieved afterwards, because it is never stored — only its
 *     digest is.
 *   * **Refusals are as visible as successes.** A connection being denied
 *     repeatedly is shown on the card. That is either a misconfiguration or
 *     something worse, and both are worth noticing.
 *
 * Nothing here can widen its own reach: the scopes offered are the scopes the
 * service registry declares, and every call is re-checked against the
 * authorising person's live role at the moment it runs.
 */

type ScopeOption = { scope: string; label: string };

export function McpConnectionsPanel({
  connections,
  approvals,
  scopeOptions,
  canManage,
}: {
  connections: McpConnection[];
  approvals: McpPendingApproval[];
  scopeOptions: ScopeOption[];
  canManage: boolean;
}) {
  const [creating, setCreating] = React.useState(false);
  const [issued, setIssued] = React.useState<null | {
    name: string;
    oauthClientId: string;
    clientSecret: string;
  }>(null);

  return (
    <section
      aria-labelledby="mcp-heading"
      className="rounded-xl border border-line bg-surface p-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-content-secondary"
          >
            <Plug className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 id="mcp-heading" className="text-[14px] font-semibold text-content">
              Assistant connections
            </h3>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              Let an AI assistant read and act on this workspace through the
              ClientTurn MCP server. Each connection gets only the permissions
              you choose, and acts with your own access — never more.
            </p>
          </div>
        </div>

        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            New connection
          </Button>
        )}
      </div>

      {approvals.length > 0 && (
        <PendingApprovals approvals={approvals} canManage={canManage} />
      )}

      <div className="mt-4 space-y-2">
        {connections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-content-muted">
            No assistant is connected to this workspace.
          </p>
        ) : (
          connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              canManage={canManage}
              onIssued={setIssued}
            />
          ))
        )}
      </div>

      {creating && (
        <CreateConnectionDialog
          scopeOptions={scopeOptions}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setIssued(result);
          }}
        />
      )}

      {issued && <SecretDialog issued={issued} onClose={() => setIssued(null)} />}
    </section>
  );
}

/* ------------------------------------------------------------------- rows */

function ConnectionRow({
  connection,
  canManage,
  onIssued,
}: {
  connection: McpConnection;
  canManage: boolean;
  onIssued: (value: { name: string; oauthClientId: string; clientSecret: string }) => void;
}) {
  const [pending, setPending] = React.useState<null | "token" | "revoke">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);

  const revoked = connection.status === "REVOKED";

  async function issueToken() {
    setPending("token");
    setError(null);
    const result = await issueMcpTokenAction({ clientId: connection.id });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onIssued({
      name: connection.name,
      oauthClientId: connection.oauthClientId,
      clientSecret: result.data.accessToken,
    });
  }

  async function revoke() {
    setPending("revoke");
    setError(null);
    const result = await revokeMcpClientAction({ clientId: connection.id });
    setPending(null);
    setConfirmRevoke(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-content">
              {connection.name}
            </span>
            {revoked ? (
              <Badge tone="danger" dense>
                Revoked
              </Badge>
            ) : connection.activeTokens === 0 ? (
              // A connection with no live token exists but cannot call. Saying
              // "Active" would be a claim the customer could disprove.
              <Badge tone="warning" dense>
                No key issued
              </Badge>
            ) : (
              <Badge tone="success" dense dot>
                Connected
              </Badge>
            )}
          </div>

          {connection.description && (
            <p className="mt-0.5 text-[12px] text-content-muted">
              {connection.description}
            </p>
          )}

          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-content-subtle">
            <span>
              {connection.scopes.length} permission
              {connection.scopes.length === 1 ? "" : "s"}
            </span>
            <span>
              {connection.lastUsedAt
                ? `Last used ${new Date(connection.lastUsedAt).toLocaleDateString("en-GB")}`
                : "Never used"}
            </span>
            {connection.recentCalls > 0 && (
              <span>{connection.recentCalls} calls in 7 days</span>
            )}
          </p>

          {connection.recentDenials > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-warning-700">
              <ShieldAlert aria-hidden className="size-3.5 shrink-0" />
              {connection.recentDenials} request
              {connection.recentDenials === 1 ? " was" : "s were"} refused in the
              last 7 days.
            </p>
          )}

          <ul className="mt-1.5 flex flex-wrap gap-1">
            {connection.scopes.map((scope) => (
              <li key={scope.scope}>
                <Badge tone="neutral" dense>
                  {scope.label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        {canManage && !revoked && (
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="xs"
              variant="secondary"
              loading={pending === "token"}
              onClick={issueToken}
            >
              <KeyRound aria-hidden className="size-3.5" />
              New key
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setConfirmRevoke(true)}
              aria-label={`Revoke ${connection.name}`}
            >
              <Trash2 aria-hidden className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-[12px] text-danger-700">{error}</p>}

      <Modal
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        title={`Revoke ${connection.name}?`}
        description="Every key this connection holds stops working immediately. The assistant using it will lose access straight away, and this cannot be undone — you would need to create a new connection and reconfigure it."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRevoke(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={pending === "revoke"} onClick={revoke}>
              Revoke
            </Button>
          </>
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------- approvals */

function PendingApprovals({
  approvals,
  canManage,
}: {
  approvals: McpPendingApproval[];
  canManage: boolean;
}) {
  return (
    <div className="mt-4 rounded-lg border border-warning-100 bg-warning-50/60 p-3">
      <h4 className="text-[12.5px] font-semibold text-warning-800">
        Waiting for your decision
      </h4>
      <p className="mt-0.5 text-[12px] text-content-secondary">
        An assistant asked to do something that needs a person to agree. Nothing
        has happened yet.
      </p>
      <ul className="mt-2 space-y-1.5">
        {approvals.map((approval) => (
          <ApprovalRow key={approval.id} approval={approval} canManage={canManage} />
        ))}
      </ul>
    </div>
  );
}

function ApprovalRow({
  approval,
  canManage,
}: {
  approval: McpPendingApproval;
  canManage: boolean;
}) {
  const [pending, setPending] = React.useState<null | "approve" | "reject">(null);
  const [error, setError] = React.useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setPending(decision);
    setError(null);
    const result =
      decision === "approve"
        ? await approveMcpRequestAction({ approvalId: approval.id })
        : await rejectMcpRequestAction({ approvalId: approval.id });
    setPending(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <li className="rounded-md border border-line bg-surface px-2.5 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-content">{approval.summary}</p>
          <p className="mt-0.5 text-[11.5px] text-content-subtle">
            {approval.connectionName ?? "An assistant"} · expires{" "}
            {new Date(approval.expiresAt).toLocaleString("en-GB")}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="xs"
              variant="secondary"
              loading={pending === "reject"}
              onClick={() => decide("reject")}
            >
              Refuse
            </Button>
            <Button
              size="xs"
              loading={pending === "approve"}
              onClick={() => decide("approve")}
            >
              Approve
            </Button>
          </div>
        )}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-danger-700">{error}</p>}
    </li>
  );
}

/* ----------------------------------------------------------------- create */

function CreateConnectionDialog({
  scopeOptions,
  onClose,
  onCreated,
}: {
  scopeOptions: ScopeOption[];
  onClose: () => void;
  onCreated: (value: {
    name: string;
    oauthClientId: string;
    clientSecret: string;
  }) => void;
}) {
  const [name, setName] = React.useState("");
  // Nothing is pre-selected. A default set of permissions is a decision made on
  // the customer's behalf about what an outside assistant may read.
  const [selected, setSelected] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function toggle(scope: string) {
    setSelected((current) =>
      current.includes(scope)
        ? current.filter((value) => value !== scope)
        : [...current, scope],
    );
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await createMcpClientAction({ name, scopes: selected });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated({
      name,
      oauthClientId: result.data.oauthClientId,
      clientSecret: result.data.clientSecret,
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New assistant connection"
      description="Choose what this assistant may do. It will act with your access, and can never do more than you can."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!name.trim() || selected.length === 0}
            onClick={submit}
          >
            Create connection
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
            placeholder="Claude on my laptop"
            className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-content outline-none focus:border-accent-400"
          />
          <span className="mt-1 block text-[11.5px] text-content-subtle">
            So you can tell your connections apart later.
          </span>
        </label>

        <fieldset>
          <legend className="text-[12.5px] font-medium text-content">
            Permissions
          </legend>
          <ul className="mt-1.5 space-y-1">
            {scopeOptions.map((option) => (
              <li key={option.scope}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={selected.includes(option.scope)}
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

        {error && <p className="text-[12px] text-danger-700">{error}</p>}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- secret */

function SecretDialog({
  issued,
  onClose,
}: {
  issued: { name: string; oauthClientId: string; clientSecret: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.clientSecret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused by the browser. The value is on screen
      // and selectable, so there is nothing to recover from.
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Copy this key now"
      description="This is the only time it will be shown. ClientTurn stores only a fingerprint of it, so it cannot be shown again — if you lose it, issue a new one."
      footer={<Button onClick={onClose}>I have copied it</Button>}
    >
      <div className="space-y-3">
        <div>
          <span className="text-[12px] font-medium text-content-secondary">
            Client ID
          </span>
          <code className="mt-1 block overflow-x-auto rounded-md border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11.5px] text-content">
            {issued.oauthClientId}
          </code>
        </div>

        <div>
          <span className="text-[12px] font-medium text-content-secondary">Key</span>
          <div className="mt-1 flex items-start gap-1.5">
            <code className="block flex-1 overflow-x-auto rounded-md border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11.5px] text-content">
              {issued.clientSecret}
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
          Treat this like a password. Anyone holding it can act on this workspace
          with the permissions you granted, until you revoke the connection.
        </p>
      </div>
    </Modal>
  );
}
