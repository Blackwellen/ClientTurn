import type { MetadataRoute } from "next";
import { serverEnv } from "@/lib/env";

/**
 * Standard search crawlers get the full public site, minus authenticated
 * app surfaces, admin, auth and internal API/dev routes. Named AI crawlers
 * are granted the same public-marketing access explicitly — several
 * (GPTBot, ClaudeBot, PerplexityBot) default to being blocked by some
 * generators, which is the opposite of what an "AI SEO" strategy needs when
 * every page here is public marketing copy already indexed by Google.
 */
const disallow = [
  "/app/",
  "/admin/",
  "/affiliates/app/",
  "/api/",
  "/dev/",
  "/auth/",
  "/onboarding",
  "/r/",
  "/unsubscribe/",
];

const aiCrawlers = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent",
  "Amazonbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...aiCrawlers.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${serverEnv.siteUrl}/sitemap.xml`,
    host: serverEnv.siteUrl,
  };
}
