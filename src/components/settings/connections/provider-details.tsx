"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/dates";
import {
  metaTokenRenewal,
  type ProviderExtras,
  type ProviderType,
} from "@/lib/integrations/catalog";
import { HUBSPOT_REQUIRED_SCOPES } from "@/lib/integrations/connector-copy";
import {
  loadMetaPagesAction,
  selectGoogleAdsCustomerAction,
  selectLinkedInOrganizationAction,
  selectMetaPageAction,
} from "@/lib/integrations/connection-actions";

/**
 * Provider-specific facts and choices in the setup drawer (tracker 8.23).
 *
 * Everything here was either missing (the Google Ads webhook key existed and
 * was never shown; the Meta Page was picked for you with no way to change it)
 * or said nowhere (LinkedIn needs LinkedIn's approval; TikTok's endpoint is
 * unverified). Credentials arrive from the server only for admins.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning";
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        tone === "warning"
          ? "flex items-start gap-1.5 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[12.5px] leading-[1.5] text-warning-700"
          : "rounded-lg border border-line bg-surface-sunken/60 px-3 py-2 text-[12.5px] leading-[1.5] text-content-secondary"
      }
    >
      {tone === "warning" && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [shown, setShown] = React.useState(!secret);
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The value can be revealed and selected by hand.
    }
  }

  return (
    <div>
      <span className="text-[12px] font-medium text-content-secondary">{label}</span>
      <div className="mt-1 flex items-start gap-1.5">
        <code className="block min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11.5px] text-content">
          {shown ? value : "•".repeat(Math.min(24, value.length))}
        </code>
        {secret && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShown((open) => !open)}
            aria-label={shown ? `Hide ${label}` : `Reveal ${label}`}
          >
            {shown ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Google Ads */

function GoogleAdsDetails({
  details,
  canManage,
}: {
  details: NonNullable<ProviderExtras["googleAds"]>;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [customer, setCustomer] = React.useState(details.customerId ?? "");
  const [saving, setSaving] = React.useState(false);

  async function saveCustomer() {
    setSaving(true);
    const result = await selectGoogleAdsCustomerAction({ customerId: customer });
    setSaving(false);
    if (result.ok) {
      toast({ variant: "success", title: `Reading leads from account ${customer}` });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Account not changed", description: result.error });
    }
  }

  return (
    <>
      <Section title="Google Ads account">
        {details.accessibleCustomerIds.length > 1 && canManage ? (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Select
                id="google-ads-customer"
                aria-label="Google Ads account"
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
              >
                {details.accessibleCustomerIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={saving}
              disabled={customer === details.customerId}
              onClick={saveCustomer}
            >
              Use this account
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-content">
            {details.customerId ? `Account ${details.customerId}` : "No account found"}
          </p>
        )}
        <Note>
          {details.accessibleCustomerIds.length > 1
            ? `This Google sign-in can reach ${details.accessibleCustomerIds.length} accounts. Leads are read from the one chosen here.`
            : "Leads are read from this account. To use a different one, reconnect with the Google sign-in that owns it."}{" "}
          Accounts reached only through a manager (MCC) account are not supported yet: sign in with a user added directly to the advertiser account.
        </Note>
      </Section>

      <Section title="Instant delivery (webhook)">
        <p className="text-[12.5px] text-content-muted">
          Without this, Google Ads leads are collected every few minutes. With it,
          Google sends each lead the moment the form is submitted.
        </p>
        {details.webhookUrl && <CopyField label="Webhook URL" value={details.webhookUrl} />}
        {canManage ? (
          details.webhookKey ? (
            <CopyField label="Key" value={details.webhookKey} secret />
          ) : (
            <Note tone="warning">
              No webhook key is stored for this connection. Disconnect and reconnect
              Google Ads to generate one.
            </Note>
          )
        ) : (
          <Note>Only an owner or admin can see the webhook key.</Note>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-[1.5] text-content-secondary">
          <li>In Google Ads, open the campaign, then Assets, then your lead form.</li>
          <li>Under Lead delivery, choose Webhook integration.</li>
          <li>Paste the webhook URL and the key above, then save.</li>
          <li>Press Send test data. The test lead arrives here marked as a test.</li>
        </ol>
        <p className="text-[12px] text-content-subtle">
          Repeat for each lead form. Polling keeps running as a safety net, and a
          lead delivered both ways is recorded once.
        </p>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------- Meta */

function MetaDetails({
  details,
  canManage,
}: {
  details: NonNullable<ProviderExtras["meta"]>;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pages, setPages] = React.useState(details.pages);
  const [page, setPage] = React.useState(details.selectedPageId ?? details.pages[0]?.id ?? "");
  const [pending, setPending] = React.useState<null | "load" | "save">(null);
  const [now] = React.useState(() => new Date());
  const renewal = metaTokenRenewal(details.tokenExpiresAt, now);

  async function load() {
    setPending("load");
    const result = await loadMetaPagesAction();
    setPending(null);
    if (result.ok && result.data) {
      setPages(result.data.map(({ id, name }) => ({ id, name })));
      if (!page && result.data[0]) setPage(result.data[0].id);
    } else if (!result.ok) {
      toast({ variant: "error", title: "Pages not loaded", description: result.error });
    }
  }

  async function save() {
    setPending("save");
    const result = await selectMetaPageAction({ pageId: page });
    setPending(null);
    if (result.ok) {
      toast({ variant: "success", title: `Receiving leads for ${result.data?.name ?? "that Page"}` });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Page not switched", description: result.error });
    }
  }

  return (
    <>
      {renewal && (renewal.warn || renewal.expired) && (
        <Note tone="warning">
          {renewal.expired
            ? "Meta's access has expired, so new leads are not arriving. Reconnect Meta to renew it."
            : `Meta's access expires in ${renewal.daysLeft} day${renewal.daysLeft === 1 ? "" : "s"}. Meta does not renew it automatically: reconnect Meta before then to keep leads arriving.`}
        </Note>
      )}
      {renewal && !renewal.warn && !renewal.expired && (
        <p className="text-[12px] text-content-subtle">
          Meta access renews when you reconnect; it lasts about 60 days. It expires{" "}
          {formatRelative(details.tokenExpiresAt!)}, and you will be warned 10 days before.
        </p>
      )}

      <Section title="Facebook Page">
        <p className="text-[12.5px] text-content-muted">
          Leads and messages are received for one Page. Its lead forms are found
          automatically and their fields mapped for you.
        </p>
        {pages.length > 0 ? (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Select
                id="meta-page"
                aria-label="Facebook Page"
                value={page}
                disabled={!canManage}
                onChange={(event) => setPage(event.target.value)}
              >
                {pages.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </div>
            {canManage && (
              <Button
                size="sm"
                variant="secondary"
                loading={pending === "save"}
                disabled={!page || page === details.selectedPageId}
                onClick={save}
              >
                Use this Page
              </Button>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-content">
            {details.selectedPageId ? `Page ${details.selectedPageId}` : "No Page selected yet"}
          </p>
        )}
        {canManage && (
          <Button size="xs" variant="ghost" loading={pending === "load"} onClick={load}>
            {pages.length > 0 ? "Refresh Page list" : "Load my Pages"}
          </Button>
        )}
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- LinkedIn */

function LinkedInDetails({
  details,
  canManage,
}: {
  details: NonNullable<ProviderExtras["linkedin"]>;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [org, setOrg] = React.useState(details.selectedId ?? details.organizations[0]?.id ?? "");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    const result = await selectLinkedInOrganizationAction({ organizationId: org });
    setSaving(false);
    if (result.ok) {
      toast({ variant: "success", title: "LinkedIn organisation changed" });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Not changed", description: result.error });
    }
  }

  return (
    <Section title="LinkedIn organisation">
      {details.organizations.length > 1 && canManage ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Select
              id="linkedin-org"
              aria-label="LinkedIn organisation"
              value={org}
              onChange={(event) => setOrg(event.target.value)}
            >
              {details.organizations.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={saving}
            disabled={!org || org === details.selectedId}
            onClick={save}
          >
            Use this organisation
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-content">
          {details.organizations.find((option) => option.id === details.selectedId)?.name ??
            (details.selectedId ? `Organisation ${details.selectedId}` : "No organisation found")}
        </p>
      )}
      <Note>
        ClientTurn reads Lead Gen Form submissions only. People who engage with your company
        page are not turned into prospects: LinkedIn&rsquo;s terms forbid using member data to
        identify sales prospects.
      </Note>
    </Section>
  );
}

/* -------------------------------------------------------------------- CRM */

function CrmDetails({ details }: { details: NonNullable<ProviderExtras["crm"]> }) {
  return (
    <Section title="Push status">
      <dl className="space-y-1.5 rounded-lg border border-line px-3.5 py-3 text-[13px]">
        <div className="flex items-baseline gap-3">
          <dt className="w-36 shrink-0 text-content-subtle">Last push</dt>
          <dd className="text-content">
            {details.lastPushAt ? formatRelative(details.lastPushAt) : "Nothing pushed yet"}
          </dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="w-36 shrink-0 text-content-subtle">Pushed, last 30 days</dt>
          <dd className="text-content">{details.pushedLast30Days}</dd>
        </div>
      </dl>
      {details.failures.length > 0 ? (
        <ul className="space-y-1.5">
          {details.failures.map((failure) => (
            <li
              key={failure.leadId}
              className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[12.5px] text-danger-700"
            >
              <Link href={`/app/leads/${failure.leadId}`} className="font-medium underline-offset-4 hover:underline">
                {failure.leadName}
              </Link>{" "}
              {failure.status === "partial"
                ? "was partly pushed: the record exists in your CRM, but not everything was written."
                : "was not pushed."}{" "}
              <span className="text-danger-700/80">{failure.error}</span>
              <span className="ml-1 text-[11.5px] text-danger-700/70">{formatRelative(failure.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-content-subtle">No failed pushes.</p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------- entry */

export function ProviderDetails({
  provider,
  extras,
  connected,
  canManage,
}: {
  provider: ProviderType;
  extras: ProviderExtras | undefined;
  connected: boolean;
  canManage: boolean;
}) {
  return (
    <>
      {provider === "linkedin_ads" && (
        <Section title="Before you connect">
          <Note tone="warning">
            LinkedIn only releases lead form responses to apps it has approved for
            its Lead Sync API. Until ClientTurn&apos;s approval covers your account,
            connecting succeeds but LinkedIn refuses to hand over leads (a 403),
            and the card will show that error.
          </Note>
          <Note>
            New LinkedIn leads are collected every few minutes. LinkedIn&apos;s
            instant lead notifications need a further approval, so they are not
            used.
          </Note>
        </Section>
      )}

      {provider === "tiktok_ads" && (
        <Section title="Beta">
          <Note>
            TikTok lead retrieval is in beta: the endpoint it reads has not yet been
            confirmed against a live TikTok ad account. Check your first TikTok lead
            arrives, and tell us if it does not.
          </Note>
        </Section>
      )}

      {provider === "hubspot" && (
        <Section title="Token permissions">
          <p className="text-[12.5px] text-content-muted">
            Create a service key (or private app) in HubSpot with these scopes:
          </p>
          <ul className="flex flex-wrap gap-1">
            {HUBSPOT_REQUIRED_SCOPES.map((scope) => (
              <li key={scope}>
                <code className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-content">
                  {scope}
                </code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {provider === "email" && (
        <Note>
          This is ClientTurn&apos;s own system email: team invitations, handover
          alerts and failure warnings. Your campaigns and replies to leads go out
          from the mailbox you connect at the top of this page, not from here.
        </Note>
      )}

      {connected && extras?.googleAds && (
        <GoogleAdsDetails details={extras.googleAds} canManage={canManage} />
      )}
      {connected && extras?.meta && <MetaDetails details={extras.meta} canManage={canManage} />}
      {connected && extras?.crm && <CrmDetails details={extras.crm} />}
      {connected && extras?.linkedin && (
        <LinkedInDetails details={extras.linkedin} canManage={canManage} />
      )}

      {connected && provider === "slack" && (
        <Section title="Alert channel">
          <p className="text-[13px] text-content">
            {extras?.slack?.channelId ? (
              <>
                Posting to <code className="font-mono text-[12px]">{extras.slack.channelId}</code>
              </>
            ) : (
              "No channel chosen yet, so nothing is posted."
            )}
          </p>
          <Link
            href="/app/settings?section=workspace#slack-alerts"
            className="inline-block text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            {extras?.slack?.channelId ? "Change the channel" : "Choose the channel"} in
            Workspace settings
          </Link>
        </Section>
      )}
    </>
  );
}
