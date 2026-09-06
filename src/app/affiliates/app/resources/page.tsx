import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download, ExternalLink, FileText } from "lucide-react";
import { getAffiliate, listResources } from "@/lib/affiliates/queries";
import {
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABEL,
  type ResourceRow,
} from "@/lib/affiliates/types";
import { Section, SectionEmpty } from "@/components/affiliates/ui";
import { CopyBlock } from "@/components/affiliates/copy-block";

export const metadata: Metadata = {
  title: "Resources | ClientTurn partners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AffiliateResourcesPage() {
  const affiliate = await getAffiliate();
  if (!affiliate) redirect("/affiliates");
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const resources = await listResources();

  const byCategory = new Map<string, ResourceRow[]>();
  for (const resource of resources) {
    const bucket = byCategory.get(resource.category) ?? [];
    bucket.push(resource);
    byCategory.set(resource.category, bucket);
  }

  if (resources.length === 0) {
    return (
      <Section
        title="Resources"
        description="Brand assets, screenshots and copy you can use."
      >
        <SectionEmpty>
          Nothing published yet. Assets appear here as we release them.
        </SectionEmpty>
      </Section>
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-[12.5px] text-content-muted">
        You may use these assets to promote ClientTurn as they are. Please do not
        alter the logo, imply you are ClientTurn, or make claims about results
        that are not in the copy we supply.
      </p>

      {RESOURCE_CATEGORIES.filter((category) => byCategory.has(category)).map(
        (category) => (
          <Section key={category} title={RESOURCE_CATEGORY_LABEL[category]}>
            <ul className="divide-y divide-line-subtle">
              {(byCategory.get(category) ?? []).map((resource) => (
                <li key={resource.id} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-content">
                        {resource.title}
                        <span className="ml-2 text-[11px] font-normal text-content-subtle">
                          {resource.version}
                        </span>
                      </p>
                      {resource.description && (
                        <p className="mt-0.5 text-[12.5px] text-content-muted">
                          {resource.description}
                        </p>
                      )}
                      {(resource.dimensions || resource.fileSizeBytes) && (
                        <p className="mt-0.5 text-[11.5px] text-content-subtle">
                          {[
                            resource.dimensions,
                            resource.fileSizeBytes
                              ? formatBytes(resource.fileSizeBytes)
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0">
                      {resource.hasFile && (
                        <a
                          href={`/affiliates/app/resources/${resource.id}/download`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] text-content shadow-xs hover:bg-surface-hover"
                        >
                          <Download className="size-3.5" aria-hidden />
                          Download
                        </a>
                      )}
                      {!resource.hasFile && resource.externalUrl && (
                        <a
                          href={resource.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] text-content shadow-xs hover:bg-surface-hover"
                        >
                          <ExternalLink className="size-3.5" aria-hidden />
                          Open
                        </a>
                      )}
                    </div>
                  </div>

                  {resource.textContent && (
                    <CopyBlock text={resource.textContent} />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ),
      )}

      <p className="flex items-start gap-2 px-1 text-[11.5px] text-content-subtle">
        <FileText className="mt-px size-3.5 shrink-0" aria-hidden />
        Downloads are logged so we can tell which assets are worth updating.
      </p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
