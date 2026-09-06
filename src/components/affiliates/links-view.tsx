"use client";

import * as React from "react";
import { Check, Copy, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Cell, DataGrid, Section, SectionEmpty } from "@/components/affiliates/ui";
import { createCampaign, createLink, setLinkArchived } from "@/lib/affiliates/actions";
import {
  ALLOWED_DESTINATIONS,
  conversionRate,
  formatRate,
  referralUrl,
  type LinkRow,
} from "@/lib/affiliates/types";

/**
 * Tracked referral links (V4 §32).
 *
 * The destination is a fixed list rather than a text box. An affiliate choosing
 * their own landing path would make a link that carries our brand into an open
 * redirect — the server refuses anything off the list, and the UI never offers
 * the chance to try.
 */
export function LinksView({
  links,
  campaigns,
  origin,
}: {
  links: LinkRow[];
  campaigns: { id: string; name: string }[];
  origin: string;
}) {
  const { toast } = useToast();
  const [creating, setCreating] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);

  const active = links.filter((link) => !link.archived);
  const archived = links.filter((link) => link.archived);

  const run = async (
    key: string,
    fn: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) => {
    setPending(key);
    try {
      const result = await fn();
      toast(
        result.ok
          ? { variant: "success", title: result.message ?? "Done." }
          : { variant: "error", title: result.error ?? "That did not work." },
      );
      return result.ok;
    } catch {
      toast({ variant: "error", title: "That did not work. Please try again." });
      return false;
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Referral links"
        description="Every link tracks its own clicks, sign-ups and paying customers."
        action={
          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus className="size-3.5" aria-hidden />
            New link
          </Button>
        }
      >
        {creating && (
          <NewLinkForm
            campaigns={campaigns}
            pending={pending === "create"}
            onCancel={() => setCreating(false)}
            onSubmit={async (values) => {
              const ok = await run("create", () => createLink(values));
              if (ok) setCreating(false);
            }}
            onCreateCampaign={async (name) => {
              await run("campaign", () => createCampaign({ name }));
            }}
          />
        )}

        {active.length === 0 ? (
          <SectionEmpty>
            You have no active links. Create one to start tracking referrals.
          </SectionEmpty>
        ) : (
          <DataGrid
            headers={["Link", "Destination", "Clicks", "Sign-ups", "Rate", ""]}
          >
            {active.map((link) => (
              <LinkRowView
                key={link.id}
                link={link}
                origin={origin}
                pending={pending === link.id}
                onArchive={() =>
                  run(link.id, () =>
                    setLinkArchived({ linkId: link.id, archived: true }),
                  )
                }
                onCopy={() => toast({ variant: "success", title: "Link copied." })}
              />
            ))}
          </DataGrid>
        )}
      </Section>

      {archived.length > 0 && (
        <Section
          title="Archived links"
          description="These no longer track. Anyone who follows one still reaches the home page."
        >
          <DataGrid headers={["Link", "Destination", "Clicks", "Sign-ups", "", ""]}>
            {archived.map((link) => (
              <tr key={link.id} className="text-content-muted">
                <Cell>
                  {link.label}
                  <span className="block text-[11.5px] text-content-subtle">
                    /r/{link.slug}
                  </span>
                </Cell>
                <Cell>{link.destinationPath}</Cell>
                <Cell numeric>{link.clickCount.toLocaleString("en-GB")}</Cell>
                <Cell numeric>{link.signupCount.toLocaleString("en-GB")}</Cell>
                <Cell />
                <Cell className="text-right">
                  <Button
                    size="xs"
                    variant="secondary"
                    loading={pending === link.id}
                    onClick={() =>
                      run(link.id, () =>
                        setLinkArchived({ linkId: link.id, archived: false }),
                      )
                    }
                  >
                    Restore
                  </Button>
                </Cell>
              </tr>
            ))}
          </DataGrid>
        </Section>
      )}
    </div>
  );
}

function LinkRowView({
  link,
  origin,
  pending,
  onArchive,
  onCopy,
}: {
  link: LinkRow;
  origin: string;
  pending: boolean;
  onArchive: () => void;
  onCopy: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const url = referralUrl(origin, link.slug);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopy();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused. The URL is on screen either way, so
      // there is nothing the person cannot still do by hand.
    }
  };

  return (
    <tr>
      <Cell>
        <span className="font-medium">{link.label}</span>
        <span className="block truncate text-[11.5px] text-content-subtle">
          {url}
        </span>
        {link.campaignName && (
          <Badge tone="neutral" dense>
            {link.campaignName}
          </Badge>
        )}
      </Cell>
      <Cell>{link.destinationPath}</Cell>
      <Cell numeric>{link.clickCount.toLocaleString("en-GB")}</Cell>
      <Cell numeric>{link.signupCount.toLocaleString("en-GB")}</Cell>
      <Cell numeric>
        {formatRate(conversionRate(link.signupCount, link.clickCount))}
      </Cell>
      <Cell className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Button size="xs" variant="secondary" onClick={copy}>
            {copied ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="xs" variant="ghost" loading={pending} onClick={onArchive}>
            Archive
          </Button>
        </div>
      </Cell>
    </tr>
  );
}

function NewLinkForm({
  campaigns,
  pending,
  onCancel,
  onSubmit,
  onCreateCampaign,
}: {
  campaigns: { id: string; name: string }[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    label: string;
    slug?: string;
    destinationPath: string;
    campaignId?: string;
  }) => void;
  onCreateCampaign: (name: string) => void;
}) {
  const [label, setLabel] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [destinationPath, setDestinationPath] = React.useState<string>(
    ALLOWED_DESTINATIONS[0].path,
  );
  const [campaignId, setCampaignId] = React.useState("");
  const [newCampaign, setNewCampaign] = React.useState("");

  return (
    <form
      className="space-y-3 border-b border-line-subtle bg-surface-sunken/50 px-4 py-4 sm:px-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          label: label.trim(),
          slug: slug.trim() || undefined,
          destinationPath,
          campaignId: campaignId || undefined,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="Only you see this.">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            minLength={2}
            maxLength={60}
            placeholder="Newsletter, October"
            className={INPUT}
          />
        </Field>

        <Field label="Where it lands">
          <select
            value={destinationPath}
            onChange={(event) => setDestinationPath(event.target.value)}
            className={INPUT}
          >
            {ALLOWED_DESTINATIONS.map((entry) => (
              <option key={entry.path} value={entry.path}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Link address"
          hint="Leave blank and we will generate one."
        >
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            maxLength={40}
            pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
            placeholder="autumn-newsletter"
            className={INPUT}
          />
        </Field>

        <Field label="Campaign" hint="Optional, for grouping your links.">
          <select
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
            className={INPUT}
          >
            <option value="">No campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <Field label="New campaign">
            <input
              value={newCampaign}
              onChange={(event) => setNewCampaign(event.target.value)}
              maxLength={60}
              placeholder="Spring push"
              className={INPUT}
            />
          </Field>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={newCampaign.trim().length < 2}
            onClick={() => {
              onCreateCampaign(newCampaign.trim());
              setNewCampaign("");
            }}
          >
            Add
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={pending}>
            Create link
          </Button>
        </div>
      </div>
    </form>
  );
}

const INPUT =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-[13px] text-content outline-none transition-colors placeholder:text-content-subtle focus:border-line-strong";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-content-secondary">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11.5px] text-content-subtle">{hint}</span>
      )}
    </label>
  );
}
