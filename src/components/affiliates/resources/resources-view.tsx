"use client";

import * as React from "react";
import {
  Bookmark,
  BookOpen,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Megaphone,
  Palette,
  Search,
  Check,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerBody } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { PanelEmpty } from "@/components/affiliates/portal-ui";
import { toggleResourceSave } from "@/lib/affiliates/link-actions";
import { RESOURCE_CATEGORY_LABEL, type ResourceCategory } from "@/lib/affiliates/types";
import type { PortalResource } from "@/lib/affiliates/portal";

/**
 * The resources hub (V4 §33).
 *
 * Categories, search and a preview drawer over a library of platform-owned
 * assets. Two things worth stating:
 *
 * - **A file's storage key never reaches the browser.** Cards carry a boolean;
 *   downloading goes through a route that re-checks the session and mints a
 *   five-minute signed URL. That is what stops an affiliate-only campaign pack
 *   becoming a public object the moment someone shares a screenshot of a page.
 * - **Copy assets are copied verbatim.** Nothing here rewrites approved
 *   marketing text — a partner pasting a claim we did not write is a
 *   compliance problem, not a feature.
 */

const CATEGORY_NAV: { key: ResourceCategory | "ALL"; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "ALL", label: "All resources", icon: LayoutGrid },
  { key: "BRAND", label: "Brand", icon: Palette },
  { key: "SCREENSHOT", label: "Product Screenshots", icon: ImageIcon },
  { key: "AD_CREATIVE", label: "Ad Creatives", icon: Megaphone },
  { key: "COPY", label: "Copy", icon: FileText },
  { key: "EDUCATION", label: "Education", icon: BookOpen },
  { key: "CAMPAIGN_PACK", label: "Campaign Packs", icon: Layers },
];

const CATEGORY_TONE: Record<string, "accent" | "info" | "warning" | "purple" | "success" | "neutral"> = {
  BRAND: "accent",
  SCREENSHOT: "info",
  AD_CREATIVE: "warning",
  COPY: "purple",
  EDUCATION: "success",
  VIDEO: "info",
  CAMPAIGN_PACK: "neutral",
};

export function ResourcesView({
  resources,
  initialResourceId,
}: {
  resources: PortalResource[];
  initialResourceId?: string;
}) {
  const [category, setCategory] = React.useState<ResourceCategory | "ALL">("ALL");
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [sort, setSort] = React.useState<"recent" | "name">("recent");
  const [openId, setOpenId] = React.useState<string | null>(
    initialResourceId ?? null,
  );

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = resources.filter((resource) => {
      if (category !== "ALL" && resource.category !== category) return false;
      if (typeFilter !== "all" && resource.resourceType !== typeFilter) return false;
      if (!needle) return true;
      return (
        resource.title.toLowerCase().includes(needle) ||
        (resource.description ?? "").toLowerCase().includes(needle) ||
        RESOURCE_CATEGORY_LABEL[resource.category].toLowerCase().includes(needle)
      );
    });

    return sort === "name"
      ? [...rows].sort((a, b) => a.title.localeCompare(b.title))
      : rows;
  }, [resources, category, search, typeFilter, sort]);

  const selected = resources.find((resource) => resource.id === openId) ?? null;
  const related = selected
    ? resources
        .filter(
          (resource) =>
            resource.id !== selected.id && resource.category === selected.category,
        )
        .slice(0, 3)
    : [];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[260px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search resources (e.g. logo, screenshot, ad creative...)"
            aria-label="Search resources"
            className="h-11 w-full rounded-[10px] border border-line bg-surface pl-10 pr-3 text-[13.5px] text-content placeholder:text-content-subtle"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          aria-label="Filter by asset type"
          className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-content"
        >
          <option value="all">All asset types</option>
          <option value="IMAGE">Images</option>
          <option value="FILE">Files</option>
          <option value="TEXT">Copy</option>
          <option value="VIDEO">Video</option>
          <option value="LINK">Links</option>
        </select>
      </div>

      <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Resource categories" className="min-w-0">
          <div className="rounded-[12px] border border-line bg-surface p-2 shadow-xs">
            <p className="px-2 py-1.5 text-[13px] font-semibold text-content">
              Categories
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {CATEGORY_NAV.map((entry) => {
                const Icon = entry.icon;
                const active = category === entry.key;
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      onClick={() => setCategory(entry.key)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                        active
                          ? "bg-accent-50 text-content-accent"
                          : "text-content-secondary hover:bg-surface-hover hover:text-content",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{entry.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        <section className="min-w-0 rounded-[12px] border border-line bg-surface shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
            <div>
              <h2 className="text-[15px] font-semibold text-content">
                {category === "ALL"
                  ? "All Resources"
                  : RESOURCE_CATEGORY_LABEL[category]}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-content-muted">
                Browse and download the latest marketing assets, copy and
                campaign materials.
              </p>
            </div>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as "recent" | "name")}
              aria-label="Sort resources"
              className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content"
            >
              <option value="recent">Most recent</option>
              <option value="name">Name</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <PanelEmpty
              title="No resources match your filters."
              description="Try a different search, or choose another category."
            />
          ) : (
            <ul className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  onOpen={() => setOpenId(resource.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <ResourceDrawer
        resource={selected}
        related={related}
        onClose={() => setOpenId(null)}
        onOpenRelated={(id) => setOpenId(id)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ card -- */

function ResourceCard({
  resource,
  onOpen,
}: {
  resource: PortalResource;
  onOpen: () => void;
}) {
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-[11px] border border-line bg-surface transition-colors hover:border-line-strong">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${resource.title}`}
        className="relative flex h-[104px] items-center justify-center bg-surface-sunken"
      >
        <ResourceGlyph category={resource.category} />
        <span className="absolute right-2 top-2 rounded-[5px] bg-info-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-info-700">
          {resource.version}
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col p-3">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left text-[13.5px] font-semibold text-content hover:underline"
        >
          {resource.title}
        </button>
        <div className="mt-1.5">
          <Badge tone={CATEGORY_TONE[resource.category] ?? "neutral"} dense>
            {RESOURCE_CATEGORY_LABEL[resource.category]}
          </Badge>
        </div>
        {resource.description && (
          <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-content-muted">
            {resource.description}
          </p>
        )}

        <div className="mt-auto flex items-center gap-1.5 pt-3">
          <ResourceAction resource={resource} />
          <button
            type="button"
            onClick={onOpen}
            aria-label={`More about ${resource.title}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-line text-content-muted hover:bg-surface-hover hover:text-content"
          >
            <span aria-hidden>⋮</span>
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * The primary action for a resource.
 *
 * A text asset is copied, a file is downloaded, a link opens. Rendering the
 * same "Download" button for all three would send someone to a route that has
 * no file behind it.
 */
function ResourceAction({ resource }: { resource: PortalResource }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (resource.resourceType === "TEXT" && resource.textContent) {
    return (
      <button
        type="button"
        onClick={async () => {
          try {
            // Copied verbatim. Approved marketing copy is never rewritten.
            await navigator.clipboard.writeText(resource.textContent ?? "");
            setCopied(true);
            toast({ variant: "success", title: "Copy text copied" });
          } catch {
            toast({ variant: "error", title: "Could not copy" });
          }
        }}
        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface text-[12.5px] font-medium text-content hover:bg-surface-hover"
      >
        {copied ? (
          <Check className="size-3.5 text-success-600" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        {copied ? "Copied" : "Copy text"}
      </button>
    );
  }

  if (resource.hasFile) {
    return (
      <a
        href={`/affiliates/app/resources/${resource.id}/download`}
        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface text-[12.5px] font-medium text-content hover:bg-surface-hover"
      >
        <Download className="size-3.5" aria-hidden />
        Download
      </a>
    );
  }

  if (resource.externalUrl) {
    return (
      <a
        href={resource.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface text-[12.5px] font-medium text-content hover:bg-surface-hover"
      >
        <ExternalLink className="size-3.5" aria-hidden />
        Open
      </a>
    );
  }

  return (
    <span className="inline-flex h-8 flex-1 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-[12.5px] text-content-muted">
      Coming soon
    </span>
  );
}

function ResourceGlyph({ category }: { category: ResourceCategory }) {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    BRAND: Palette,
    SCREENSHOT: ImageIcon,
    AD_CREATIVE: Megaphone,
    COPY: FileText,
    EDUCATION: BookOpen,
    VIDEO: ImageIcon,
    CAMPAIGN_PACK: Layers,
  };
  const Icon = map[category] ?? FileText;
  return <Icon className="size-8 text-content-subtle" aria-hidden />;
}

/* ---------------------------------------------------------------- drawer -- */

function ResourceDrawer({
  resource,
  related,
  onClose,
  onOpenRelated,
}: {
  resource: PortalResource | null;
  related: PortalResource[];
  onClose: () => void;
  onOpenRelated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the local toggle when a different resource opens is a deliberate response to the selection changing.
    setSaved(resource?.saved ?? false);
  }, [resource]);

  if (!resource) return null;

  function onToggleSave() {
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      const result = await toggleResourceSave({
        resourceId: resource!.id,
        saved: next,
      });
      if (!result.ok) {
        setSaved(!next);
        toast({ variant: "error", title: "Could not update", description: result.error });
      }
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={resource.title}
      anchor="content"
      footer={
        <div className="flex flex-wrap gap-2">
          <div className="flex-1">
            <ResourceAction resource={resource} />
          </div>
          <button
            type="button"
            onClick={onToggleSave}
            disabled={pending}
            aria-pressed={saved}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-[12.5px] font-medium",
              saved
                ? "border-accent-200 bg-accent-50 text-content-accent"
                : "border-line bg-surface text-content hover:bg-surface-hover",
            )}
          >
            <Bookmark className="size-3.5" aria-hidden />
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      }
    >
      <DrawerBody>
        <div className="flex h-[160px] items-center justify-center rounded-[11px] border border-line bg-surface-sunken">
          <ResourceGlyph category={resource.category} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={CATEGORY_TONE[resource.category] ?? "neutral"}>
            {RESOURCE_CATEGORY_LABEL[resource.category]}
          </Badge>
          <Badge tone="info" dense>
            {resource.version}
          </Badge>
        </div>

        {resource.description && (
          <p className="mt-3 text-[13.5px] leading-relaxed text-content-secondary">
            {resource.description}
          </p>
        )}

        <dl className="mt-5 divide-y divide-line-subtle border-y border-line-subtle">
          <DetailRow
            label="File type"
            value={
              resource.fileTypeLabel ??
              (resource.resourceType === "TEXT" ? "Text" : resource.resourceType)
            }
          />
          <DetailRow
            label="Last updated"
            value={new Date(resource.updatedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          />
          <DetailRow label="Version" value={resource.version} />
          {resource.dimensions && (
            <DetailRow label="Dimensions" value={resource.dimensions} />
          )}
          {resource.fileSizeBytes && (
            <DetailRow label="Size" value={formatBytes(resource.fileSizeBytes)} />
          )}
          <DetailRow label="Usage" value={resource.usageRights} />
        </dl>

        {resource.resourceType === "TEXT" && resource.textContent && (
          <section className="mt-5">
            <h3 className="mb-2 text-[13.5px] font-semibold text-content">
              Approved copy
            </h3>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[9px] border border-line bg-surface-sunken px-3.5 py-3 text-[12.5px] leading-relaxed text-content-secondary">
              {resource.textContent}
            </pre>
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-2 text-[13.5px] font-semibold text-content">
              Related resources
            </h3>
            <ul className="space-y-1.5">
              {related.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onOpenRelated(entry.id)}
                    className="flex w-full items-center gap-2.5 rounded-[9px] border border-line px-3 py-2 text-left hover:bg-surface-hover"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-surface-sunken">
                      <ResourceGlyph category={entry.category} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-content">
                      {entry.title}
                    </span>
                    <span className="shrink-0 rounded-[5px] bg-info-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-info-700">
                      {entry.version}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </DrawerBody>
    </Drawer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[13px] text-content-muted">{label}</dt>
      <dd className="text-[13px] font-medium text-content">{value}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
