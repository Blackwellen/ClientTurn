/**
 * Reads the help articles from `content/help/<category>/<slug>.md`.
 *
 * Server-side only by construction (it uses `node:fs`); it carries no
 * `server-only` marker so `tests/help-center.test.ts` can run it under plain
 * Node. Nothing in a client component imports it — the pages and actions reach
 * it through `./service.ts`, which does carry the marker.
 *
 * In production the index is read once per server instance and memoised; in
 * development it is re-read on every call so an author sees an edit on reload.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { HELP_CATEGORY_SLUGS } from "./categories.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import {
  bodyImages,
  pngSize,
  validateArticle,
  type HelpArticle,
  type HelpImageSize,
} from "./contract.ts";

export const HELP_CONTENT_DIR = path.join(process.cwd(), "content", "help");
export const PUBLIC_DIR = path.join(process.cwd(), "public");

export type DiskIndex = {
  articles: HelpArticle[];
  /** Per-file problems, keyed by `category/slug.md`. */
  problems: Record<string, string[]>;
};

export function publicFileExists(src: string): boolean {
  if (!src.startsWith("/") || src.includes("..")) return false;
  return existsSync(path.join(PUBLIC_DIR, src));
}

/** Reads every article file. Files that cannot be rendered are skipped. */
export function readHelpDirectory(root = HELP_CONTENT_DIR, checkFiles = true): DiskIndex {
  const articles: HelpArticle[] = [];
  const problems: Record<string, string[]> = {};
  if (!existsSync(root)) return { articles, problems };

  for (const entry of readdirSync(root)) {
    const folder = path.join(root, entry);
    if (!statSync(folder).isDirectory()) continue;

    if (!(HELP_CATEGORY_SLUGS as readonly string[]).includes(entry)) {
      problems[`${entry}/`] = [`folder "${entry}" is not a known category`];
      continue;
    }

    for (const file of readdirSync(folder)) {
      if (!file.endsWith(".md")) continue;
      const key = `${entry}/${file}`;
      const slug = file.replace(/\.md$/, "");
      const parsed = parseFrontmatter(readFileSync(path.join(folder, file), "utf8"));
      const { article, problems: found } = validateArticle({
        slug,
        folder: entry,
        data: parsed.data,
        body: parsed.body,
        screenshotExists: checkFiles ? publicFileExists : undefined,
      });
      const all = [...parsed.problems, ...found];
      if (all.length > 0) problems[key] = all;
      if (article) articles.push(article);
    }
  }

  // A slug is the article's identity across the site; two files with the same
  // name in different folders would shadow each other.
  const seen = new Map<string, string>();
  for (const article of articles) {
    const other = seen.get(article.slug);
    if (other) {
      const key = `${article.category}/${article.slug}.md`;
      problems[key] = [...(problems[key] ?? []), `slug "${article.slug}" is also used in ${other}`];
    } else {
      seen.set(article.slug, `${article.category}/${article.slug}.md`);
    }
  }

  return { articles, problems };
}

let memo: DiskIndex | null = null;

export function loadHelpIndex(): DiskIndex {
  if (memo && process.env.NODE_ENV === "production") return memo;
  // Existence checks are for authors and tests; at runtime a missing image is
  // rendered as a broken figure rather than dropping the whole article.
  memo = readHelpDirectory(HELP_CONTENT_DIR, false);
  const count = Object.keys(memo.problems).length;
  if (count > 0 && process.env.NODE_ENV !== "production") {
    console.warn(`[help] ${count} article file(s) have contract problems; run the help-center tests.`);
  }
  return memo;
}

const sizeCache = new Map<string, HelpImageSize | null>();

/** Pixel size of a public image, read from its header (PNG only). */
export function imageSize(src: string): HelpImageSize | null {
  if (sizeCache.has(src)) return sizeCache.get(src) ?? null;
  let size: HelpImageSize | null = null;
  try {
    if (src.toLowerCase().endsWith(".png") && publicFileExists(src)) {
      const bytes = readFileSync(path.join(PUBLIC_DIR, src));
      size = pngSize(new Uint8Array(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 32)));
    }
  } catch {
    size = null;
  }
  sizeCache.set(src, size);
  return size;
}

/** Sizes for every image an article shows, so figures reserve their space. */
export function imageSizesFor(article: Pick<HelpArticle, "body" | "screenshots">): Record<string, HelpImageSize> {
  const sizes: Record<string, HelpImageSize> = {};
  const sources = [
    ...bodyImages(article.body).map((image) => image.src),
    ...article.screenshots.map((shot) => shot.src),
  ];
  for (const src of sources) {
    const size = imageSize(src);
    if (size) sizes[src] = size;
  }
  return sizes;
}
