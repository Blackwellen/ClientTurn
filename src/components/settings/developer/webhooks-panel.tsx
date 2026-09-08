"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Pause,
  Play,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  createWebhookEndpointAction,
  deleteWebhookEndpointAction,
  rotateWebhookSecretAction,
  sendTestWebhookAction,
  updateWebhookEndpointAction,
} from "@/lib/webhooks/actions";
import {
  DELIVERY_STATUS_LABELS,
  ENDPOINT_STATUS_LABELS,
  ENDPOINT_STATUS_TONES,
  WEBHOOK_EVENTS,
  type WebhookDeliveryStatus,
} from "@/lib/webhooks/events";
import type {
  WebhookDeliveryView,
  WebhookEndpointView,
} from "@/lib/webhooks/queries";

/**
 * Webhooks (Settings → Developer).
 *
 * The panel is built around the two questions a developer actually has, in the
 * order they have them: *did it arrive*, and *why not*. So the delivery log sits
 * next to the endpoints rather than behind a tab, failures show the status the
 * customer's own server returned, and a retrying delivery says when it will be
 * tried again instead of just looking broken.
 *
 * The signing secret is shown once at creation and once at rotation. After that
 * only its last six characters, which is enough to check against your own
 * configuration and useless to anyone else.
 */

export function WebhooksPanel({
  endpoints,
  deliveries,
  canManage,
}: {
  endpoints: WebhookEndpointView[];
  deliveries: WebhookDeliveryView[];
  canManage: boolean;
}) {
  const [creating, setCreating] = React.useState(false);
  const [secret, setSecret] = React.useState<null | { url: string; secret: string }>(
    null,
  );

  return (
    <section
      aria-labelledby="webhooks-heading"
      className="rounded-xl border border-line bg-surface p-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-content-secondary"
          >
            <Webhook className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 id="webhooks-heading" className="text-[14px] font-semibold text-content">
              Webhooks
            </h3>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              We POST an event to your own server the moment something happens —
              a lead arrives, a booking is made, someone needs a person. Every
              request is signed so you can prove it came from us.
            </p>
          </div>
        </div>

        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            Add endpoint
          </Button>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {endpoints.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-content-muted">
            No endpoints yet. Add one to have ClientTurn tell your systems what is
            happening as it happens.
          </p>
        ) : (
          endpoints.map((endpoint) => (
            <EndpointRow
              key={endpoint.id}
              endpoint={endpoint}
              canManage={canManage}
              onSecret={setSecret}
            />
          ))
        )}
      </div>

      {deliveries.length > 0 && <DeliveryLog deliveries={deliveries} />}

      {creating && (
        <EndpointDialog
          onClose={() => setCreating(false)}
          onCreated={(value) => {
            setCreating(false);
            setSecret(value);
          }}
        />
      )}

      {secret && <SecretDialog issued={secret} onClose={() => setSecret(null)} />}
    </section>
  );
}

/* -------------------------------------------------------------------- row */

function EndpointRow({
  endpoint,
  canManage,
  onSecret,
}: {
  endpoint: WebhookEndpointView;
  canManage: boolean;
  onSecret: (value: { url: string; secret: string }) => void;
}) {
  const [pending, setPending] = React.useState<
    null | "test" | "pause" | "rotate" | "delete"
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmRotate, setConfirmRotate] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  async function run(
    action: "test" | "pause" | "rotate" | "delete",
    work: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setPending(action);
    setError(null);
    setNotice(null);
    const result = await work();
    setPending(null);
    setConfirmDelete(false);
    setConfirmRotate(false);
    if (!result.ok) setError(result.error ?? "That did not work.");
  }

  const paused = endpoint.status === "PAUSED";
  const disabled = endpoint.status === "DISABLED";

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate font-mono text-[12.5px] text-content">
              {endpoint.url}
            </code>
            <Badge
              tone={ENDPOINT_STATUS_TONES[endpoint.status]}
              dense
              dot={endpoint.status === "ACTIVE"}
            >
              {ENDPOINT_STATUS_LABELS[endpoint.status]}
            </Badge>
          </div>

          {endpoint.description && (
            <p className="mt-0.5 text-[12px] text-content-muted">
              {endpoint.description}
            </p>
          )}

          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-content-subtle">
            <span>Secret ends …{endpoint.secretHint}</span>
            <span>
              {endpoint.events.length} event
              {endpoint.events.length === 1 ? "" : "s"}
            </span>
            {endpoint.recentDelivered > 0 && (
              <span>{endpoint.recentDelivered} delivered in 7 days</span>
            )}
            {endpoint.lastSuccessAt && (
              <span>
                Last delivered{" "}
                {new Date(endpoint.lastSuccessAt).toLocaleString("en-GB")}
              </span>
            )}
          </p>

          {disabled && endpoint.disabledReason && (
            <p className="mt-1.5 rounded-md border border-danger-100 bg-danger-50/60 px-2 py-1.5 text-[11.5px] text-danger-700">
              {endpoint.disabledReason}
            </p>
          )}

          {!disabled && endpoint.consecutiveFailures > 0 && (
            <p className="mt-1.5 text-[11.5px] text-warning-700">
              {endpoint.consecutiveFailures} failed{" "}
              {endpoint.consecutiveFailures === 1 ? "delivery" : "deliveries"} in a
              row
              {endpoint.lastError ? ` — ${endpoint.lastError}` : "."}
            </p>
          )}

          <ul className="mt-1.5 flex flex-wrap gap-1">
            {endpoint.events.map((event) => (
              <li key={event}>
                <Badge tone="neutral" dense>
                  {event}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <Button
              size="xs"
              variant="secondary"
              loading={pending === "test"}
              disabled={endpoint.status !== "ACTIVE"}
              onClick={() =>
                run("test", async () => {
                  const result = await sendTestWebhookAction({
                    endpointId: endpoint.id,
                  });
                  if (result.ok) {
                    setNotice(
                      "Test event queued. It will appear in the delivery log below within a few seconds.",
                    );
                  }
                  return result;
                })
              }
            >
              <Send aria-hidden className="size-3.5" />
              Test
            </Button>

            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>

            <Button
              size="xs"
              variant="ghost"
              loading={pending === "pause"}
              aria-label={paused || disabled ? "Switch on" : "Pause"}
              onClick={() =>
                run("pause", () =>
                  updateWebhookEndpointAction({
                    endpointId: endpoint.id,
                    status: paused || disabled ? "ACTIVE" : "PAUSED",
                  }),
                )
              }
            >
              {paused || disabled ? (
                <Play aria-hidden className="size-3.5" />
              ) : (
                <Pause aria-hidden className="size-3.5" />
              )}
            </Button>

            <Button
              size="xs"
              variant="ghost"
              aria-label="Rotate signing secret"
              onClick={() => setConfirmRotate(true)}
            >
              <RefreshCw aria-hidden className="size-3.5" />
            </Button>

            <Button
              size="xs"
              variant="ghost"
              aria-label={`Delete ${endpoint.url}`}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {notice && <p className="mt-2 text-[12px] text-content-secondary">{notice}</p>}
      {error && <p className="mt-2 text-[12px] text-danger-700">{error}</p>}

      {editing && (
        <EndpointDialog
          endpoint={endpoint}
          onClose={() => setEditing(false)}
          onCreated={() => setEditing(false)}
        />
      )}

      <Modal
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        title="Issue a new signing secret?"
        description="The current secret stops working immediately — there is no overlap. Events signed with it will fail your verification until you update your server with the new one."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRotate(false)}>
              Cancel
            </Button>
            <Button
              loading={pending === "rotate"}
              onClick={() =>
                run("rotate", async () => {
                  const result = await rotateWebhookSecretAction({
                    endpointId: endpoint.id,
                  });
                  if (result.ok) {
                    onSecret({ url: endpoint.url, secret: result.data.secret });
                  }
                  return result;
                })
              }
            >
              Issue new secret
            </Button>
          </>
        }
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this endpoint?"
        description="Events stop being sent to this address immediately, and anything queued for it is cancelled. This cannot be undone."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={pending === "delete"}
              onClick={() =>
                run("delete", () =>
                  deleteWebhookEndpointAction({ endpointId: endpoint.id }),
                )
              }
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------ delivery log */

const DELIVERY_TONES: Record<
  WebhookDeliveryStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  SUCCEEDED: "success",
  PENDING: "neutral",
  FAILED: "warning",
  EXHAUSTED: "danger",
  CANCELLED: "neutral",
};

function DeliveryLog({ deliveries }: { deliveries: WebhookDeliveryView[] }) {
  return (
    <div className="mt-4">
      <h4 className="text-[12.5px] font-semibold text-content">Recent deliveries</h4>
      <p className="mt-0.5 text-[11.5px] text-content-muted">
        What we sent, and what your server said back.
      </p>

      <div className="mt-2 overflow-x-auto">
        <ul className="min-w-[520px] divide-y divide-line rounded-lg border border-line">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="flex items-start gap-3 px-2.5 py-2">
              <Badge tone={DELIVERY_TONES[delivery.status]} dense>
                {DELIVERY_STATUS_LABELS[delivery.status]}
              </Badge>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-content">
                  <span className="font-mono">{delivery.eventType}</span>
                  <span className="text-content-subtle"> → {delivery.endpointUrl}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-content-subtle">
                  {new Date(delivery.createdAt).toLocaleString("en-GB")}
                  {delivery.responseStatus !== null &&
                    ` · answered ${delivery.responseStatus}`}
                  {delivery.attempts > 1 && ` · attempt ${delivery.attempts}`}
                  {delivery.status === "PENDING" && delivery.nextAttemptAt && (
                    <>
                      {" "}
                      · next try{" "}
                      {new Date(delivery.nextAttemptAt).toLocaleTimeString("en-GB")}
                    </>
                  )}
                </p>
                {delivery.error && (
                  <p className="mt-0.5 text-[11px] text-danger-700">{delivery.error}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- create / edit */

function EndpointDialog({
  endpoint,
  onClose,
  onCreated,
}: {
  endpoint?: WebhookEndpointView;
  onClose: () => void;
  onCreated: (value: { url: string; secret: string }) => void;
}) {
  const editing = Boolean(endpoint);
  const [url, setUrl] = React.useState(endpoint?.url ?? "");
  const [description, setDescription] = React.useState(endpoint?.description ?? "");
  const [events, setEvents] = React.useState<string[]>(endpoint?.events ?? []);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function toggle(type: string) {
    setEvents((current) =>
      current.includes(type)
        ? current.filter((value) => value !== type)
        : [...current, type],
    );
  }

  async function submit() {
    setPending(true);
    setError(null);

    const result = editing
      ? await updateWebhookEndpointAction({
          endpointId: endpoint!.id,
          description: description.trim() || null,
          events,
        })
      : await createWebhookEndpointAction({
          url,
          description: description.trim() || undefined,
          events,
        });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (editing) {
      onClose();
      return;
    }

    const created = result.data as { url: string; secret: string };
    onCreated({ url: created.url, secret: created.secret });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit endpoint" : "Add a webhook endpoint"}
      description={
        editing
          ? "Change which events go to this address."
          : "We will POST a signed JSON body to this address whenever one of the events you pick happens."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={(!editing && !url.trim()) || events.length === 0}
            onClick={submit}
          >
            {editing ? "Save" : "Add endpoint"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!editing && (
          <label className="block">
            <span className="text-[12.5px] font-medium text-content">
              Endpoint URL
            </span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={500}
              placeholder="https://example.com/hooks/clientturn"
              className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-[12.5px] text-content outline-none focus:border-accent-400"
            />
            <span className="mt-1 block text-[11.5px] text-content-subtle">
              Must be https. Events carry lead details, so they are never sent
              unencrypted.
            </span>
          </label>
        )}

        <label className="block">
          <span className="text-[12.5px] font-medium text-content">
            Description{" "}
            <span className="font-normal text-content-subtle">(optional)</span>
          </span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={240}
            placeholder="Pushes new leads into our CRM"
            className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-content outline-none focus:border-accent-400"
          />
        </label>

        <fieldset>
          <legend className="text-[12.5px] font-medium text-content">Events</legend>
          <ul className="mt-1.5 space-y-1">
            {WEBHOOK_EVENTS.map((event) => (
              <li key={event.type}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={events.includes(event.type)}
                    onChange={() => toggle(event.type)}
                    className="mt-0.5 size-3.5 shrink-0 accent-accent-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-content">
                      {event.label}
                    </span>
                    <span className="block text-[11.5px] text-content-subtle">
                      {event.description}
                    </span>
                    <span className="block font-mono text-[11px] text-content-subtle">
                      {event.type}
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
  issued: { url: string; secret: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused. The value is on screen and selectable.
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Copy this signing secret now"
      description="This is the only time it will be shown. Use it to verify that a request really came from ClientTurn."
      footer={<Button onClick={onClose}>I have copied it</Button>}
    >
      <div className="space-y-3">
        <code className="block truncate rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 font-mono text-[11.5px] text-content-subtle">
          {issued.url}
        </code>

        <div className="flex items-start gap-1.5">
          <code className="block flex-1 overflow-x-auto rounded-md border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11.5px] text-content">
            {issued.secret}
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

        <div className="rounded-md border border-line bg-surface-sunken px-2.5 py-2">
          <p className="text-[11.5px] font-medium text-content-secondary">
            Verifying a request
          </p>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-content-muted">
{`const header = req.headers["clientturn-signature"];
// "t=1717171717,v1=<hex>"
const [t, v1] = header.split(",").map(p => p.split("=")[1]);
const expected = crypto
  .createHmac("sha256", secret)
  .update(\`\${t}.\${rawBody}\`)
  .digest("hex");
// compare with crypto.timingSafeEqual, and
// reject anything older than 5 minutes`}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
