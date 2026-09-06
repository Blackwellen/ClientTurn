"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Mail,
  Send,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/app/page-header";
import { FormField, Input, Select, Switch } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/dates";
import {
  INBOUND_PROTOCOLS,
  INBOUND_PROTOCOL_LABELS,
  MAILBOX_PRESETS,
  toFormValues,
  type EmailAccountView,
  type InboundProtocol,
  type MailboxPresetId,
} from "@/lib/email/account";
import {
  disconnectEmail,
  saveEmailConnection,
  sendEmailConnectionTest,
  testEmailAccount,
} from "@/lib/email/actions";

/**
 * Connecting the workspace's own mailbox.
 *
 * Campaign email is sent through the customer's own SMTP server rather than a
 * shared platform sender: it costs the business nothing per message, replies
 * land in the inbox they already use, and deliverability rides on a domain
 * they already own. The price of that is that we hold their mail password, so
 * this form never displays a stored one, only replaces it.
 */

type FormState = {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  inboundProtocol: InboundProtocol;
  inboundHost: string;
  inboundPort: number;
  inboundSecure: boolean;
  inboundUsername: string;
  inboundPassword: string;
  inboundMailbox: string;
};

function blankForm(): FormState {
  return {
    fromName: "",
    fromEmail: "",
    replyTo: "",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: "",
    smtpPassword: "",
    inboundProtocol: "imap",
    inboundHost: "",
    inboundPort: 993,
    inboundSecure: true,
    inboundUsername: "",
    inboundPassword: "",
    inboundMailbox: "INBOX",
  };
}

function fromAccount(account: EmailAccountView): FormState {
  const values = toFormValues(account.config);
  return {
    ...blankForm(),
    ...values,
    replyTo: values.replyTo ?? "",
    inboundHost: values.inboundHost ?? "",
    inboundPort: values.inboundPort ?? 993,
    inboundUsername: values.inboundUsername ?? "",
    // Never populated from the server. Blank means "keep what is stored".
    smtpPassword: "",
    inboundPassword: "",
  };
}

const STATUS_TONE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> =
  {
    HEALTHY: { label: "Connected", tone: "success" },
    DEGRADED: { label: "Having trouble", tone: "warning" },
    ACTION_REQUIRED: { label: "Action required", tone: "danger" },
    DISCONNECTED: { label: "Not connected", tone: "neutral" },
    TESTING: { label: "Testing", tone: "neutral" },
  };

export function EmailMailboxPanel({
  account,
  canManage,
  secretsAvailable,
}: {
  account: EmailAccountView | null;
  canManage: boolean;
  /** False when the deployment has no credential encryption key configured. */
  secretsAvailable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = React.useState<FormState>(() =>
    account ? fromAccount(account) : blankForm(),
  );
  const [preset, setPreset] = React.useState<MailboxPresetId>("custom");
  const [busy, setBusy] = React.useState<null | "test" | "save" | "send" | "disconnect">(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [tested, setTested] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);

  const connected = account !== null && account.status !== "DISCONNECTED";
  const status = STATUS_TONE[account?.status ?? "DISCONNECTED"];
  const readsReplies = form.inboundProtocol !== "none";

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setTested(false);
    setError(null);
  }

  function applyPreset(id: MailboxPresetId) {
    setPreset(id);
    const definition = MAILBOX_PRESETS.find((entry) => entry.id === id);
    if (!definition) return;

    const inbound =
      form.inboundProtocol === "pop3" ? definition.pop3 : definition.imap;

    setForm((current) => ({
      ...current,
      smtpHost: definition.smtp.host,
      smtpPort: definition.smtp.port,
      smtpSecure: definition.smtp.secure,
      inboundHost: inbound.host,
      inboundPort: inbound.port,
      inboundSecure: inbound.secure,
    }));
    setTested(false);
  }

  /** Blank password fields mean "keep the stored one", so they are omitted. */
  function payload() {
    return {
      fromName: form.fromName,
      fromEmail: form.fromEmail,
      replyTo: form.replyTo,
      smtpHost: form.smtpHost,
      smtpPort: form.smtpPort,
      smtpSecure: form.smtpSecure,
      smtpUsername: form.smtpUsername || form.fromEmail,
      smtpPassword: form.smtpPassword || undefined,
      inboundProtocol: form.inboundProtocol,
      inboundHost: form.inboundHost,
      inboundPort: form.inboundPort,
      inboundSecure: form.inboundSecure,
      inboundUsername: form.inboundUsername || form.smtpUsername || form.fromEmail,
      inboundPassword: form.inboundPassword || undefined,
      inboundMailbox: form.inboundMailbox,
    };
  }

  async function onTest() {
    setBusy("test");
    setError(null);
    const result = await testEmailAccount(payload());
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      setTested(false);
      return;
    }
    setTested(true);
    toast({
      variant: "success",
      title: "Connection works",
      description: readsReplies
        ? "Both outgoing and incoming mail authenticated."
        : "Outgoing mail authenticated.",
    });
  }

  async function onSave() {
    setBusy("save");
    setError(null);
    const result = await saveEmailConnection(payload());
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setForm((current) => ({ ...current, smtpPassword: "", inboundPassword: "" }));
    toast({
      variant: "success",
      title: "Mailbox connected",
      description: "Reactivation campaigns can now send email from this address.",
    });
    router.refresh();
  }

  async function onSendTest() {
    setBusy("send");
    const result = await sendEmailConnectionTest();
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast({
      variant: "success",
      title: "Test email sent",
      description: `Check ${result.data.to} — it should arrive within a minute.`,
    });
  }

  async function onDisconnect() {
    setBusy("disconnect");
    const result = await disconnectEmail();
    setBusy(null);
    setConfirmDisconnect(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setForm(blankForm());
    toast({
      variant: "success",
      title: "Mailbox disconnected",
      description: "The stored password has been deleted.",
    });
    router.refresh();
  }

  const presetNote = MAILBOX_PRESETS.find((entry) => entry.id === preset)?.note;

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Mail}
          tone="accent"
          title="Your sending mailbox"
          description="Send campaign email from your own address, through your own mail server. Replies come back to your inbox."
          action={
            <Badge tone={status.tone === "neutral" ? undefined : status.tone}>
              {status.label}
            </Badge>
          }
        />
      </CardHeader>

      <CardContent className="space-y-4">
        {!secretsAvailable && (
          <div
            role="alert"
            className="border-warning-100 bg-warning-50 text-warning-700 rounded-lg border px-3.5 py-3 text-[13px]"
          >
            This environment has no credential encryption key configured, so a
            mailbox password cannot be stored securely yet. Ask your
            administrator to set <code>CREDENTIAL_ENCRYPTION_KEY</code> before
            connecting.
          </div>
        )}

        {connected && account?.lastErrorMessage && account.status !== "HEALTHY" && (
          <div
            role="alert"
            className="border-danger-100 bg-danger-50 rounded-lg border px-3.5 py-3"
          >
            <p className="text-danger-700 flex items-center gap-2 text-[13px] font-medium">
              <AlertTriangle className="size-4" aria-hidden />
              This mailbox stopped working
            </p>
            <p className="text-content-secondary mt-1 text-[12px]">
              {account.lastErrorMessage}
            </p>
          </div>
        )}

        {connected && account?.status === "HEALTHY" && (
          <div className="border-success-100 bg-success-50 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3.5 py-2.5 text-[12px]">
            <span className="text-content flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="text-success-600 size-4" aria-hidden />
              Sending as {account.config.fromEmail}
            </span>
            {account.lastSuccessAt && (
              <span className="text-content-muted">
                Last successful use {formatRelative(account.lastSuccessAt)}
              </span>
            )}
            <span className="text-content-muted">
              {account.config.inbound.protocol === "none"
                ? "Replies are not read"
                : `Reading replies over ${INBOUND_PROTOCOL_LABELS[account.config.inbound.protocol]}`}
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="border-danger-100 bg-danger-50 text-danger-700 rounded-lg border px-3.5 py-3 text-[13px]"
          >
            {error}
          </div>
        )}

        <fieldset disabled={!canManage || busy !== null} className="space-y-4">
          {/* ------------------------------------------------- identity --- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="From name" htmlFor="mail-from-name" required>
              <Input
                id="mail-from-name"
                value={form.fromName}
                maxLength={120}
                placeholder="Blackwellen Roofing"
                onChange={(event) => set("fromName", event.target.value)}
              />
            </FormField>
            <FormField
              label="From address"
              htmlFor="mail-from-email"
              required
              hint="Leads see and reply to this address."
            >
              <Input
                id="mail-from-email"
                type="email"
                value={form.fromEmail}
                onChange={(event) => set("fromEmail", event.target.value)}
                placeholder="hello@yourdomain.co.uk"
              />
            </FormField>
          </div>

          <FormField
            label="Reply-to address"
            htmlFor="mail-reply-to"
            hint="Optional. Leave blank to receive replies at the from address."
          >
            <Input
              id="mail-reply-to"
              type="email"
              value={form.replyTo}
              onChange={(event) => set("replyTo", event.target.value)}
            />
          </FormField>

          {/* --------------------------------------------------- preset --- */}
          <FormField
            label="Mail provider"
            htmlFor="mail-preset"
            hint="Fills in the usual server settings. Every field stays editable."
          >
            <Select
              id="mail-preset"
              value={preset}
              onChange={(event) =>
                applyPreset(event.target.value as MailboxPresetId)
              }
            >
              {MAILBOX_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </FormField>

          {presetNote && (
            <p className="text-content-muted -mt-2 text-[12px]">{presetNote}</p>
          )}

          {/* ------------------------------------------------- outgoing --- */}
          <div className="border-line rounded-lg border p-3.5">
            <p className="text-content flex items-center gap-2 text-[13px] font-semibold">
              <Send className="text-content-muted size-4" aria-hidden />
              Outgoing mail (SMTP)
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FormField label="Server" htmlFor="smtp-host" required>
                <Input
                  id="smtp-host"
                  value={form.smtpHost}
                  placeholder="smtp.yourdomain.co.uk"
                  onChange={(event) => set("smtpHost", event.target.value)}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Port" htmlFor="smtp-port" required>
                  <Input
                    id="smtp-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.smtpPort}
                    onChange={(event) =>
                      set("smtpPort", Number(event.target.value))
                    }
                  />
                </FormField>
                <FormField label="TLS" htmlFor="smtp-secure">
                  <div className="flex h-9 items-center gap-2">
                    <Switch
                      checked={form.smtpSecure}
                      onCheckedChange={(value) => set("smtpSecure", value)}
                      label="Use implicit TLS on the outgoing server"
                    />
                    <span className="text-content-muted text-[12px]">
                      {form.smtpSecure ? "SSL (465)" : "STARTTLS"}
                    </span>
                  </div>
                </FormField>
              </div>

              <FormField
                label="Username"
                htmlFor="smtp-username"
                hint="Usually your full email address."
              >
                <Input
                  id="smtp-username"
                  value={form.smtpUsername}
                  autoComplete="off"
                  placeholder={form.fromEmail || "hello@yourdomain.co.uk"}
                  onChange={(event) => set("smtpUsername", event.target.value)}
                />
              </FormField>

              <FormField
                label="Password"
                htmlFor="smtp-password"
                required={!account?.hasSmtpPassword}
                hint={
                  account?.hasSmtpPassword
                    ? "A password is stored. Leave blank to keep it."
                    : "Many providers need an app password rather than your normal one."
                }
              >
                <Input
                  id="smtp-password"
                  type="password"
                  value={form.smtpPassword}
                  autoComplete="new-password"
                  placeholder={account?.hasSmtpPassword ? "••••••••••••" : ""}
                  onChange={(event) => set("smtpPassword", event.target.value)}
                />
              </FormField>
            </div>
          </div>

          {/* ------------------------------------------------- incoming --- */}
          <div className="border-line rounded-lg border p-3.5">
            <p className="text-content flex items-center gap-2 text-[13px] font-semibold">
              <Inbox className="text-content-muted size-4" aria-hidden />
              Incoming mail (replies)
            </p>
            <p className="text-content-muted mt-1 text-[12px]">
              Reading replies is what lets a reply stop the follow-up and move
              the lead forward. Without it, campaigns still send but replies stay
              only in your inbox.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FormField label="Protocol" htmlFor="inbound-protocol">
                <Select
                  id="inbound-protocol"
                  value={form.inboundProtocol}
                  onChange={(event) => {
                    const next = event.target.value as InboundProtocol;
                    set("inboundProtocol", next);
                    const definition = MAILBOX_PRESETS.find(
                      (entry) => entry.id === preset,
                    );
                    if (definition && next !== "none") {
                      const target =
                        next === "pop3" ? definition.pop3 : definition.imap;
                      setForm((current) => ({
                        ...current,
                        inboundHost: target.host,
                        inboundPort: target.port,
                        inboundSecure: target.secure,
                      }));
                    }
                  }}
                >
                  {INBOUND_PROTOCOLS.map((entry) => (
                    <option key={entry} value={entry}>
                      {INBOUND_PROTOCOL_LABELS[entry]}
                    </option>
                  ))}
                </Select>
              </FormField>

              {readsReplies && (
                <>
                  <FormField label="Server" htmlFor="inbound-host" required>
                    <Input
                      id="inbound-host"
                      value={form.inboundHost}
                      placeholder="imap.yourdomain.co.uk"
                      onChange={(event) => set("inboundHost", event.target.value)}
                    />
                  </FormField>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Port" htmlFor="inbound-port" required>
                      <Input
                        id="inbound-port"
                        type="number"
                        min={1}
                        max={65535}
                        value={form.inboundPort}
                        onChange={(event) =>
                          set("inboundPort", Number(event.target.value))
                        }
                      />
                    </FormField>
                    <FormField label="TLS" htmlFor="inbound-secure">
                      <div className="flex h-9 items-center gap-2">
                        <Switch
                          checked={form.inboundSecure}
                          onCheckedChange={(value) => set("inboundSecure", value)}
                          label="Use TLS on the incoming server"
                        />
                        <span className="text-content-muted text-[12px]">
                          {form.inboundSecure ? "On" : "Off"}
                        </span>
                      </div>
                    </FormField>
                  </div>

                  <FormField
                    label="Username"
                    htmlFor="inbound-username"
                    hint="Leave blank to reuse the outgoing username."
                  >
                    <Input
                      id="inbound-username"
                      value={form.inboundUsername}
                      autoComplete="off"
                      onChange={(event) =>
                        set("inboundUsername", event.target.value)
                      }
                    />
                  </FormField>

                  <FormField
                    label="Password"
                    htmlFor="inbound-password"
                    hint={
                      account?.hasInboundPassword
                        ? "A password is stored. Leave blank to keep it."
                        : "Leave blank if it is the same as the outgoing password."
                    }
                  >
                    <Input
                      id="inbound-password"
                      type="password"
                      value={form.inboundPassword}
                      autoComplete="new-password"
                      placeholder={
                        account?.hasInboundPassword ? "••••••••••••" : ""
                      }
                      onChange={(event) =>
                        set("inboundPassword", event.target.value)
                      }
                    />
                  </FormField>

                  {form.inboundProtocol === "imap" && (
                    <FormField label="Folder" htmlFor="inbound-mailbox">
                      <Input
                        id="inbound-mailbox"
                        value={form.inboundMailbox}
                        onChange={(event) =>
                          set("inboundMailbox", event.target.value)
                        }
                      />
                    </FormField>
                  )}
                </>
              )}
            </div>

            {form.inboundProtocol === "pop3" && (
              <p className="text-content-muted mt-3 text-[12px]">
                POP3 has no folders and no stable message numbering, so replies
                are matched on the server&rsquo;s unique ids. We never delete
                anything from your mailbox. IMAP is more reliable if your
                provider offers it.
              </p>
            )}
          </div>

          {/* --------------------------------------------------- actions --- */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              loading={busy === "test"}
              onClick={onTest}
              type="button"
            >
              <ShieldCheck className="size-3.5" aria-hidden />
              Test connection
            </Button>

            <Button
              loading={busy === "save"}
              onClick={onSave}
              type="button"
              disabled={!secretsAvailable}
            >
              {connected ? "Save changes" : "Connect mailbox"}
            </Button>

            {connected && (
              <>
                <Button
                  variant="ghost"
                  loading={busy === "send"}
                  onClick={onSendTest}
                  type="button"
                >
                  Send a test email
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger-600 ml-auto"
                  onClick={() => setConfirmDisconnect(true)}
                  type="button"
                >
                  Disconnect
                </Button>
              </>
            )}
          </div>

          <p
            className={cn(
              "text-[12px]",
              tested ? "text-success-700" : "text-content-subtle",
            )}
          >
            {tested
              ? "Tested successfully. Save to start using this mailbox."
              : "Your password is encrypted before it is stored and is never shown again, not even to you."}
          </p>
        </fieldset>
      </CardContent>

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect this mailbox?"
        scope="Campaign email for this workspace. SMS and WhatsApp are unaffected."
        consequence="The stored mail password is deleted, email campaigns stop sending, and replies stop being read into ClientTurn."
        confirmLabel="Disconnect"
        cancelLabel="Keep connected"
        variant="danger"
        loading={busy === "disconnect"}
        onConfirm={onDisconnect}
        onClose={() => setConfirmDisconnect(false)}
      />
    </Card>
  );
}
