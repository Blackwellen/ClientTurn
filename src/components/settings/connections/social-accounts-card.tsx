"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Handshake, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import {
  saveSocialAccountAction,
  setSocialAccountStatusAction,
} from "@/lib/outreach/social-actions";
import {
  SOCIAL_ACCOUNT_TIER_OPTIONS,
  tiersForPlatform,
  type SocialAccountTier,
  type SocialPlatform,
} from "@/lib/outreach/social-limits";

/**
 * Social sending accounts (tracker 8.23 #7).
 *
 * Find Leads sent people here to "connect an account" and there was nothing
 * to connect: `saveSocialAccountAction` existed and nothing called it. These
 * are ASSISTED accounts -- ClientTurn drafts, counts and times the invites and
 * messages, and a person sends them from their own LinkedIn, Facebook,
 * Instagram or TikTok. Nothing here logs in to a platform or automates one,
 * which is the only arrangement inside every platform's terms.
 *
 * The tier matters: it sets the allowances (LinkedIn Free has a handful of
 * invitation notes a month and no InMail; Sales Navigator has 50 InMails).
 */

export type SocialAccountRow = {
  id: string;
  platform: SocialPlatform;
  tier: SocialAccountTier;
  displayName: string;
  handle: string | null;
  status: string;
};

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
};

export function SocialAccountsCard({
  accounts,
  canManage,
}: {
  accounts: SocialAccountRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [adding, setAdding] = React.useState(false);
  const [platform, setPlatform] = React.useState<SocialPlatform>("LINKEDIN");
  const [tier, setTier] = React.useState<SocialAccountTier>("FREE");
  const [name, setName] = React.useState("");
  const [profileUrl, setProfileUrl] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function choosePlatform(next: SocialPlatform) {
    setPlatform(next);
    setTier(tiersForPlatform(next)[0]);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await saveSocialAccountAction({
      platform,
      tier,
      displayName: name,
      handle: profileUrl.trim() || undefined,
      sendMode: "ASSISTED",
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast({ variant: "success", title: `${PLATFORM_LABEL[platform]} account added` });
    setAdding(false);
    setName("");
    setProfileUrl("");
    router.refresh();
  }

  async function remove(account: SocialAccountRow) {
    const result = await setSocialAccountStatusAction(account.id, "DISCONNECTED");
    if (result.ok) {
      toast({ variant: "success", title: `${account.displayName} removed` });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Not removed", description: result.error });
    }
  }

  async function togglePause(account: SocialAccountRow) {
    const next = account.status === "PAUSED" ? "ACTIVE" : "PAUSED";
    const result = await setSocialAccountStatusAction(account.id, next);
    if (result.ok) router.refresh();
    else toast({ variant: "error", title: "Not changed", description: result.error });
  }

  return (
    <Card id="social-accounts">
      <CardHeader>
        <SectionHeader
          icon={Handshake}
          title="Social sending accounts"
          description="The LinkedIn, Facebook, Instagram or TikTok accounts your team sends from. ClientTurn drafts and times each invite and message; a person sends it from the account. Nothing is posted or sent automatically."
          action={
            canManage && !adding ? (
              <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" aria-hidden />
                Add account
              </Button>
            ) : undefined
          }
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.length === 0 && !adding && (
          <p className="text-[12.5px] text-content-muted">
            No sending account yet. Add the account a person on your team will send
            from, with its subscription, so Find Leads uses the right allowances.
          </p>
        )}

        {accounts.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-content">
                    {account.displayName}{" "}
                    <span className="text-content-subtle">· {PLATFORM_LABEL[account.platform]}</span>
                  </p>
                  <p className="truncate text-[12px] text-content-muted">
                    {SOCIAL_ACCOUNT_TIER_OPTIONS.find((option) => option.value === account.tier)?.label ??
                      account.tier}
                    {account.handle ? ` · ${account.handle}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={account.status === "ACTIVE" ? "success" : "warning"} dense dot>
                    {account.status === "ACTIVE" ? "Active" : "Paused"}
                  </Badge>
                  {canManage && (
                    <>
                      <Button size="xs" variant="ghost" onClick={() => togglePause(account)}>
                        {account.status === "PAUSED" ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-danger-600 hover:bg-danger-50"
                        onClick={() => remove(account)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding && canManage && (
          <form onSubmit={save} className="space-y-3 rounded-lg border border-line p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Platform" htmlFor="social-platform" required>
                <Select
                  id="social-platform"
                  value={platform}
                  onChange={(event) => choosePlatform(event.target.value as SocialPlatform)}
                >
                  {(Object.keys(PLATFORM_LABEL) as SocialPlatform[]).map((value) => (
                    <option key={value} value={value}>
                      {PLATFORM_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                label="Subscription"
                htmlFor="social-tier"
                required
                hint={SOCIAL_ACCOUNT_TIER_OPTIONS.find((option) => option.value === tier)?.hint}
              >
                <Select
                  id="social-tier"
                  value={tier}
                  onChange={(event) => setTier(event.target.value as SocialAccountTier)}
                >
                  {tiersForPlatform(platform).map((value) => (
                    <option key={value} value={value}>
                      {SOCIAL_ACCOUNT_TIER_OPTIONS.find((option) => option.value === value)?.label ?? value}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField label="Name on the account" htmlFor="social-name" required>
              <Input
                id="social-name"
                required
                maxLength={120}
                value={name}
                placeholder="Sam Taylor"
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField
              label="Profile URL"
              htmlFor="social-url"
              hint="So your team can see which account a draft is for. Optional."
            >
              <Input
                id="social-url"
                type="url"
                maxLength={200}
                value={profileUrl}
                placeholder="https://www.linkedin.com/in/…"
                onChange={(event) => setProfileUrl(event.target.value)}
              />
            </FormField>
            {error && (
              <p role="alert" className="text-[12.5px] text-danger-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={pending} disabled={!name.trim()}>
                Add account
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
