"use client";

import * as React from "react";
import { Copy, Megaphone, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { Drawer } from "@/components/ui/drawer";
import { StatusBadge, BANNER_TONE } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { PlatformBanner } from "@/components/site/platform-banner";
import { deleteBanner, endBannerNow, saveBanner } from "@/lib/maintenance/actions";
import { formatLondon, utcToLondonLocal } from "@/lib/maintenance/schedule";
import { safeBannerLink } from "@/lib/banners/select";
import {
  BANNER_AUDIENCES,
  BANNER_AUDIENCE_LABEL,
  BANNER_PLACEMENTS,
  BANNER_PLACEMENT_LABEL,
  BANNER_PLANS,
  BANNER_TONES,
  BODY_MAX,
  LINK_LABEL_MAX,
  TITLE_MAX,
  type BannerAudience,
  type BannerPlacement,
  type BannerTone,
} from "@/lib/banners/types";
import type { AdminBanner, BannerFormInput } from "@/lib/maintenance/admin-types";
import { useSiteAction } from "./use-site-action";

/**
 * Platform banners: create, edit, duplicate, end now and delete, with a live
 * preview drawn by the very component customers see.
 */
export function BannerManager({ banners }: { banners: AdminBanner[] }) {
  const [editor, setEditor] = React.useState<{ key: string; initial: Partial<AdminBanner> & { id?: string } } | null>(null);
  const [ending, setEnding] = React.useState<AdminBanner | null>(null);
  const [deleting, setDeleting] = React.useState<AdminBanner | null>(null);
  const { run, pending, stepUpDialog } = useSiteAction();

  const openNew = () => setEditor({ key: `new-${Date.now()}`, initial: {} });

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <p className="text-[12.5px] text-content-muted">
          One banner shows per placement: the highest priority. Critical banners sit above account notices.
        </p>
        <Button size="sm" onClick={openNew}>
          <Plus className="size-3.5" aria-hidden />
          New banner
        </Button>
      </div>

      {banners.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No banners yet"
          description="Announce a feature, a price change or planned work in the app, on the website or on the dashboard."
          action={
            <Button size="sm" onClick={openNew}>
              <Plus className="size-3.5" aria-hidden />
              Create a banner
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {banners.map((banner) => (
            <li key={banner.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge kind="banner_state" value={banner.phase} dense />
                  <StatusBadge kind="banner_tone" value={banner.tone} dense dot={false} />
                  <span className="lr-tabular text-[11.5px] text-content-muted">Priority {banner.priority}</span>
                </div>
                <p className="truncate text-[13.5px] font-medium text-content">{banner.title}</p>
                <p className="text-[12px] text-content-muted">
                  {BANNER_AUDIENCE_LABEL[banner.audience]}
                  {banner.audience === "PLANS" ? ` (${banner.plans.join(", ")})` : ""}
                  {banner.audience === "WORKSPACES" ? ` (${banner.businessIds.length})` : ""}
                  {" · "}
                  {banner.placements.map((p) => BANNER_PLACEMENT_LABEL[p]).join(", ")}
                </p>
                <p className="text-[11.5px] text-content-subtle">
                  {formatLondon(banner.startsAt)}
                  {" → "}
                  {banner.endedAt ? `ended ${formatLondon(banner.endedAt)}` : banner.endsAt ? formatLondon(banner.endsAt) : "no end"}
                  {banner.dismissible ? " · dismissible" : " · not dismissible"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Button size="xs" variant="secondary" onClick={() => setEditor({ key: banner.id, initial: banner })}>
                  <Pencil className="size-3" aria-hidden />
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    setEditor({
                      key: `dup-${banner.id}`,
                      initial: { ...banner, id: undefined, title: `${banner.title} (copy)`.slice(0, TITLE_MAX), startsAt: undefined, endsAt: null, endedAt: null },
                    })
                  }
                >
                  <Copy className="size-3" aria-hidden />
                  Duplicate
                </Button>
                {banner.phase !== "ENDED" ? (
                  <Button size="xs" variant="secondary" onClick={() => setEnding(banner)}>
                    <Power className="size-3" aria-hidden />
                    End now
                  </Button>
                ) : null}
                <Button size="xs" variant="ghost" onClick={() => setDeleting(banner)} aria-label={`Delete ${banner.title}`}>
                  <Trash2 className="size-3" aria-hidden />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor?.initial.id ? "Edit banner" : "New banner"}
        description="Plain text and one optional link. Times are UK time (Europe/London)."
        size="xl"
      >
        {editor ? <BannerEditor key={editor.key} initial={editor.initial} onDone={() => setEditor(null)} /> : null}
      </Drawer>

      <ConfirmDialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title="End this banner now?"
        scope={ending ? `"${ending.title}" stops showing everywhere.` : ""}
        consequence="It stays in the list as ended; edit it to show it again."
        confirmLabel="End banner"
        loading={pending === "end"}
        onConfirm={async () => {
          if (ending && (await run("end", () => endBannerNow({ id: ending.id })))) setEnding(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this banner?"
        scope={deleting ? `"${deleting.title}" and everyone's dismissals of it are deleted.` : ""}
        consequence="This cannot be undone. The history below keeps a record that it existed."
        confirmLabel="Delete banner"
        variant="danger"
        loading={pending === "delete"}
        onConfirm={async () => {
          if (deleting && (await run("delete", () => deleteBanner({ id: deleting.id })))) setDeleting(null);
        }}
      />
      {stepUpDialog}
    </>
  );
}

function BannerEditor({
  initial,
  onDone,
}: {
  initial: Partial<AdminBanner> & { id?: string };
  onDone: () => void;
}) {
  const ids = React.useId();
  const [title, setTitle] = React.useState(initial.title ?? "");
  const [body, setBody] = React.useState(initial.body ?? "");
  const [linkUrl, setLinkUrl] = React.useState(initial.linkUrl ?? "");
  const [linkLabel, setLinkLabel] = React.useState(initial.linkLabel ?? "");
  const [tone, setTone] = React.useState<BannerTone>(initial.tone ?? "info");
  const [audience, setAudience] = React.useState<BannerAudience>(initial.audience ?? "ALL");
  const [plans, setPlans] = React.useState<string[]>(initial.plans ?? []);
  const [workspaces, setWorkspaces] = React.useState((initial.businessIds ?? []).join("\n"));
  const [placements, setPlacements] = React.useState<BannerPlacement[]>(initial.placements ?? ["APP_TOP"]);
  const [startsAt, setStartsAt] = React.useState(utcToLondonLocal(initial.startsAt));
  const [endsAt, setEndsAt] = React.useState(utcToLondonLocal(initial.endsAt));
  const [dismissible, setDismissible] = React.useState(initial.dismissible ?? true);
  const [priority, setPriority] = React.useState(String(initial.priority ?? 50));
  const [error, setError] = React.useState<string | null>(null);
  const { run, pending, stepUpDialog } = useSiteAction();

  const websiteAllowed = audience === "ALL" || audience === "MARKETING_VISITORS";
  const appAllowed = audience !== "MARKETING_VISITORS";
  const link = linkUrl.trim() ? safeBannerLink(linkUrl) : null;
  const linkInvalid = linkUrl.trim().length > 0 && !link;

  function togglePlacement(placement: BannerPlacement, on: boolean) {
    setPlacements((current) => (on ? [...new Set([...current, placement])] : current.filter((p) => p !== placement)));
  }

  async function save() {
    const businessIds = workspaces
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    const effectivePlacements = placements.filter((p) =>
      p === "MARKETING_TOP" ? websiteAllowed : appAllowed,
    );
    const input: BannerFormInput = {
      id: initial.id,
      title: title.trim(),
      body: body.trim() || undefined,
      linkUrl: linkUrl.trim() || undefined,
      linkLabel: linkLabel.trim() || undefined,
      tone,
      audience,
      plans: audience === "PLANS" ? plans : [],
      businessIds: audience === "WORKSPACES" ? businessIds : [],
      placements: effectivePlacements,
      startsAtLocal: startsAt || undefined,
      endsAtLocal: endsAt || undefined,
      dismissible,
      priority: Math.max(0, Math.min(100, Number.parseInt(priority, 10) || 0)),
    };
    if (!input.title) return setError("Give the banner a title.");
    if (linkInvalid) return setError("The link must be a page on this site (/pricing) or an https:// address.");
    if (effectivePlacements.length === 0) return setError("Choose at least one placement this audience can see.");
    setError(null);
    if (await run("save", () => saveBanner(input))) onDone();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FormField label="Title" htmlFor={`${ids}-title`} required hint={`${title.length}/${TITLE_MAX}`}>
          <Input id={`${ids}-title`} value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <FormField label="Body" htmlFor={`${ids}-body`} hint={`Plain text, no HTML. ${body.length}/${BODY_MAX}`}>
          <Textarea id={`${ids}-body`} value={body} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
          <FormField
            label="Link (optional)"
            htmlFor={`${ids}-link`}
            error={linkInvalid ? "Use /path or https://…" : undefined}
            hint="A page on this site, or an https:// address."
          >
            <Input id={`${ids}-link`} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/pricing" />
          </FormField>
          <FormField label="Link label" htmlFor={`${ids}-label`}>
            <Input
              id={`${ids}-label`}
              value={linkLabel}
              maxLength={LINK_LABEL_MAX}
              onChange={(e) => setLinkLabel(e.target.value)}
              placeholder="Read more"
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Tone" htmlFor={`${ids}-tone`}>
            <Select id={`${ids}-tone`} value={tone} onChange={(e) => setTone(e.target.value as BannerTone)}>
              {BANNER_TONES.map((value) => (
                <option key={value} value={value}>
                  {BANNER_TONE[value].label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Priority (0-100)" htmlFor={`${ids}-priority`} hint="Highest wins its placement.">
            <Input
              id={`${ids}-priority`}
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Audience" htmlFor={`${ids}-audience`}>
          <Select id={`${ids}-audience`} value={audience} onChange={(e) => setAudience(e.target.value as BannerAudience)}>
            {BANNER_AUDIENCES.map((value) => (
              <option key={value} value={value}>
                {BANNER_AUDIENCE_LABEL[value]}
              </option>
            ))}
          </Select>
        </FormField>

        {audience === "PLANS" ? (
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium text-content">Plans</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {BANNER_PLANS.map((plan) => (
                <label key={plan} className="inline-flex items-center gap-2 text-[13px] text-content">
                  <Checkbox
                    checked={plans.includes(plan)}
                    onChange={(e) =>
                      setPlans((current) => (e.target.checked ? [...current, plan] : current.filter((p) => p !== plan)))
                    }
                  />
                  {plan[0].toUpperCase() + plan.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {audience === "WORKSPACES" ? (
          <FormField label="Workspace ids" htmlFor={`${ids}-ws`} hint="One per line, from Admin → Customers.">
            <Textarea id={`${ids}-ws`} value={workspaces} onChange={(e) => setWorkspaces(e.target.value)} className="font-mono text-[12px]" />
          </FormField>
        ) : null}

        <fieldset className="space-y-1.5">
          <legend className="text-[13px] font-medium text-content">Placement</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {BANNER_PLACEMENTS.map((placement) => {
              const allowed = placement === "MARKETING_TOP" ? websiteAllowed : appAllowed;
              return (
                <label key={placement} className="inline-flex items-center gap-2 text-[13px] text-content aria-disabled:opacity-50" aria-disabled={!allowed}>
                  <Checkbox
                    checked={allowed && placements.includes(placement)}
                    disabled={!allowed}
                    onChange={(e) => togglePlacement(placement, e.target.checked)}
                  />
                  {BANNER_PLACEMENT_LABEL[placement]}
                </label>
              );
            })}
          </div>
          <p className="text-[12px] text-content-muted">
            The website only shows Everyone or Website visitors banners; the app never shows Website-visitor banners.
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Starts (UK time)" htmlFor={`${ids}-start`} hint="Empty: now.">
            <Input id={`${ids}-start`} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </FormField>
          <FormField label="Ends (UK time)" htmlFor={`${ids}-end`} hint="Empty: until ended.">
            <Input id={`${ids}-end`} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </FormField>
        </div>

        <label className="flex items-center gap-2 text-[13px] text-content">
          <Checkbox checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
          People can dismiss it
        </label>

        {error ? (
          <p role="alert" className="text-[12.5px] font-medium text-danger-600">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending === "save"}>
            {initial.id ? "Save banner" : "Create banner"}
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>

      <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-content-subtle">Live preview</p>
        <div className="space-y-1.5">
          <p className="text-[12px] text-content-muted">App top bar</p>
          <div className="rounded-lg border border-line bg-bg p-3">
            <PlatformBanner
              dismissKey="preview"
              title={title.trim() || "Banner title"}
              body={body.trim() || null}
              linkUrl={link}
              linkLabel={link ? linkLabel.trim() || "Read more" : null}
              tone={tone}
              dismissible={dismissible}
              dismissMode="none"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-[12px] text-content-muted">Website top bar</p>
          <div className="ct-marketing overflow-hidden rounded-lg border border-line">
            <PlatformBanner
              dismissKey="preview-marketing"
              title={title.trim() || "Banner title"}
              body={body.trim() || null}
              linkUrl={link}
              linkLabel={link ? linkLabel.trim() || "Read more" : null}
              tone={tone}
              dismissible={dismissible}
              dismissMode="none"
              variant="marketing"
            />
            <div className="h-10 bg-[#050814]" aria-hidden />
          </div>
        </div>
        <p className="text-[12px] text-content-muted">
          The preview uses the same component and colours customers see. The close button is shown but inactive here.
        </p>
      </div>
      {stepUpDialog}
    </div>
  );
}
