import type { MetadataRoute } from "next";
import { serverEnv } from "@/lib/env";
import { loadHelpIndex } from "@/lib/help/disk";

/**
 * Public marketing routes only. Authenticated app, admin and affiliate
 * portal routes are not indexable pages and have no place in a sitemap.
 */
const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "how-it-works", priority: 0.9, changeFrequency: "monthly" },
  { path: "product/find-leads", priority: 0.9, changeFrequency: "monthly" },
  { path: "product/lead-conversion", priority: 0.9, changeFrequency: "monthly" },
  { path: "pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "results", priority: 0.7, changeFrequency: "monthly" },
  { path: "enterprise", priority: 0.7, changeFrequency: "monthly" },
  { path: "developers", priority: 0.6, changeFrequency: "monthly" },
  { path: "help", priority: 0.6, changeFrequency: "weekly" },
  { path: "affiliates", priority: 0.5, changeFrequency: "monthly" },
  { path: "contact-sales", priority: 0.6, changeFrequency: "yearly" },
  { path: "compliance", priority: 0.6, changeFrequency: "monthly" },
  { path: "sub-processors", priority: 0.3, changeFrequency: "monthly" },
  { path: "status", priority: 0.3, changeFrequency: "daily" },
  { path: "privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "cookies", priority: 0.2, changeFrequency: "yearly" },
  // "data-deletion" is deliberately excluded: every URL there is a
  // per-request confirmation-code lookup with robots noindex, not a page
  // with canonical content to surface in search.
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const pages = routes.map(({ path, priority, changeFrequency }) => ({
    url: `${serverEnv.siteUrl}/${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));

  // Help articles and their categories, read from the bundled markdown. Each
  // article carries its own `updated` date, which is the honest lastModified.
  const articles = loadHelpIndex().articles;
  const categories = [...new Set(articles.map((article) => article.category))];
  const help = [
    ...categories.map((category) => ({
      url: `${serverEnv.siteUrl}/help/${category}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...articles.map((article) => ({
      url: `${serverEnv.siteUrl}/help/${article.category}/${article.slug}`,
      lastModified: article.updated ? new Date(`${article.updated}T00:00:00Z`) : lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];

  return [...pages, ...help];
}
