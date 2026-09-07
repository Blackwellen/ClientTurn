"use client";

import * as React from "react";
import { Check, Copy, KeyRound, RotateCw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  connectorActivityAction,
  dismissConnectorEventAction,
  replayConnectorEventAction,
  rotateConnectorSecretAction,
  testConnectorAction,
} from "@/lib/integrations/app-actions";
import type { ConnectorActivity } from "@/lib/integrations/connector-ops";

/**
 * Operating a connector after it is installed (Programme §5).
 *
 * The section this sits in already answered "what is my URL". Everything here
 * answers the questions that come after it, in the order people ask them:
 *
 *   1. **Does it work?** A signed test event through the real endpoint, not a
 *      simulation of one.
 *   2. **What has it delivered?** A count and a date. A connection's health is
 *      what arrived, not whether a secret was saved.
 *   3. **What did I lose?** Failed events, with the reason, and a replay for
 *      the ones whose contents were kept.
 *   4. **How do I reproduce a call?** A cURL that can be pasted and run.
 *   5. **How do I change the secret** without changing the URL somebody else's
 *      product is already configured with?
 *
 * Loaded on demand rather than with the connector list: this is per-connection
 * detail behind a disclosure, and counting events for every connector on every
 * render would slow down the common case of glancing at a status chip.
 */

type Loaded = {
  activity: ConnectorActivity;
  endpoint: string;
  curl: string;
};

const FAILURE_REASONS: Record<string, string> = {
  invalid_payload:
    "The sender authenticated but the fields did not match what ClientTurn accepts.",
  queue_failed: "ClientTurn accepted the event but could not queue it.",
  invalid_signature: "The signature did not match. The secret is probably out of step.",
  stale_timestamp: "The sender's clock is more than five minutes out.",
  bad_timestamp: "The sender did not send a valid timestamp header.",
  invalid_token: "The bearer token did not match.",
  invalid_api_key: "The API key did not match.",
  invalid_basic_auth: "The username or password did not match.",
  bad_content_type: "The sender did not send JSON.",
  payload_too_large: "The event was larger than ClientTurn accepts.",
  invalid_json: "The body was not valid JSON.",
  misconfigured: "This connection is missing part of its credential.",
};

export function ConnectorOperations({
  installId,
  authMethod,
  canManage,
}: {
  installId: string;
  authMethod: string;
  canManage: boolean;
}) {
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rotated, setRotated] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Mirrors how this section already loads installs: the promise is started in
  // the effect and the setter is handed to it, rather than the effect itself
  // setting state.
  React.useEffect(() => {
    connectorActivityAction({ installId, authMethod })
      .then((result) => ("error" in result ? null : result))
      .then(setLoaded)
      .catch(() => setError("This connection's activity could not be loaded."));
  }, [installId, authMethod]);

  async function refresh() {
    const result = await connectorActivityAction({ installId, authMethod });
    if (!("error" in result)) setLoaded(result);
  }

  async function run(key: string, action: () => Promise<{ ok?: boolean; error?: string; message?: string }>) {
    setBusy(key);
    setNotice(null);
    setError(null);
    const result = await action();
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.message) setNotice(result.message);
    await refresh();
  }

  if (!loaded) {
    return (
      <p className="rounded-lg border border-line bg-surface p-3 text-xs text-content-muted">
        Loading this connection&rsquo;s activity…
      </p>
    );
  }

  const { activity, curl } = loaded;

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------ delivered */}
      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Delivered</p>
            <p className="text-xs text-content-muted">
              {activity.importedCount === 0
                ? "Nothing has arrived through this connection yet."
                : `${activity.importedCount.toLocaleString("en-GB")} event${
                    activity.importedCount === 1 ? "" : "s"
                  } accepted${
                    activity.lastImportAt
                      ? `, most recently ${new Date(activity.lastImportAt).toLocaleString("en-GB")}`
                      : ""
                  }.`}
            </p>
          </div>

          {canManage && authMethod === "hmac_sha256" && (
            <Button
              size="xs"
              variant="secondary"
              loading={busy === "test"}
              onClick={() => run("test", () => testConnectorAction(installId))}
            >
              <Send aria-hidden className="size-3.5" />
              Send test event
            </Button>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- failures */}
      {activity.openFailures > 0 && (
        <div className="rounded-lg border border-warning-100 bg-warning-50/60 p-3">
          <p className="text-sm font-medium text-warning-800">
            {activity.openFailures} event
            {activity.openFailures === 1 ? "" : "s"} did not get through
          </p>
          <ul className="mt-2 space-y-1.5">
            {activity.recentFailures.map((failure) => (
              <li
                key={failure.id}
                className="rounded-md border border-line bg-surface px-2.5 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-content">
                      {FAILURE_REASONS[failure.reason] ?? failure.reason}
                    </p>
                    <p className="mt-0.5 text-[11px] text-content-subtle">
                      {new Date(failure.createdAt).toLocaleString("en-GB")}
                      {failure.externalEventId ? ` · ${failure.externalEventId}` : ""}
                    </p>
                    {!failure.replayable && (
                      // Said plainly rather than by disabling a button with no
                      // explanation: the contents were not kept on purpose.
                      <p className="mt-0.5 text-[11px] text-content-subtle">
                        Refused before it was authenticated, so its contents were
                        not stored and it cannot be replayed.
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="xs"
                        variant="ghost"
                        loading={busy === `dismiss-${failure.id}`}
                        onClick={() =>
                          run(`dismiss-${failure.id}`, () =>
                            dismissConnectorEventAction(failure.id),
                          )
                        }
                      >
                        Dismiss
                      </Button>
                      {failure.replayable && (
                        <Button
                          size="xs"
                          variant="secondary"
                          loading={busy === `replay-${failure.id}`}
                          onClick={() =>
                            run(`replay-${failure.id}`, () =>
                              replayConnectorEventAction(failure.id),
                            )
                          }
                        >
                          <RotateCw aria-hidden className="size-3.5" />
                          Replay
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------------------ cURL */}
      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Example request</p>
            <p className="text-xs text-content-muted">
              Paste this to send one contact. Replace the placeholder with your
              own secret.
            </p>
          </div>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              navigator.clipboard
                ?.writeText(curl)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => setError("Could not copy. Select the text instead."));
            }}
          >
            {copied ? (
              <Check aria-hidden className="size-3.5" />
            ) : (
              <Copy aria-hidden className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-2.5 text-[11px] leading-relaxed">
          <code>{curl}</code>
        </pre>
      </div>

      {/* -------------------------------------------------------- rotation */}
      {canManage && authMethod === "hmac_sha256" && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Signing secret</p>
              <p className="text-xs text-content-muted">
                Rotating issues a new secret and keeps the same URL, so you only
                have to change one thing in the sending system.
              </p>
            </div>
            <Button
              size="xs"
              variant="secondary"
              loading={busy === "rotate"}
              onClick={() =>
                run("rotate", async () => {
                  const result = await rotateConnectorSecretAction(installId);
                  if ("secret" in result && result.secret) {
                    setRotated(result.secret);
                    return { ok: true };
                  }
                  return result;
                })
              }
            >
              <KeyRound aria-hidden className="size-3.5" />
              Rotate
            </Button>
          </div>

          {rotated && (
            <div className="mt-2 rounded-md border border-warning-100 bg-warning-50/70 p-2.5">
              <p className="text-xs font-medium text-warning-800">
                Copy this now — it will not be shown again
              </p>
              <p className="mt-0.5 text-[11px] text-content-secondary">
                The old secret stopped working the moment this was issued.
                Anything still sending with it will be refused.
              </p>
              <code className="mt-1.5 block overflow-x-auto rounded bg-bg p-2 font-mono text-[11px]">
                {rotated}
              </code>
              <Button
                size="xs"
                variant="ghost"
                className="mt-1.5"
                onClick={() => setRotated(null)}
              >
                I have copied it
              </Button>
            </div>
          )}
        </div>
      )}

      {notice && (
        <p className="flex items-center gap-1.5 text-xs text-success-700">
          <Badge tone="success" dense>
            Done
          </Badge>
          {notice}
        </p>
      )}
      {error && <p className="text-xs text-danger-700">{error}</p>}
    </div>
  );
}
