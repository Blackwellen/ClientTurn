import type { MetadataRoute } from "next";
import { serverEnv } from "@/lib/env";

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
  { path: "affiliates", priority: 0.5, changeFrequency: "monthly" },
  { path: "contact-sales", priority: 0.6, changeFrequency: "yearly" },
  { path: "sub-processors", priority: 0.3, changeFrequency: "monthly" },
  { path: "status", priority: 0.3, changeFrequency: "daily" },
  { path: "privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "cookies", priority: 0.2, changeFrequency: "yearly" },
  { path: "data-deletion", priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${serverEnv.siteUrl}/${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
