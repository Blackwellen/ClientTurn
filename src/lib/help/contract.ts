/**
 * The help-article contract (Phase 8.1), as code.
 *
 * `content/help/README.md` describes this in prose for the people and agents
 * writing articles; this file is what enforces it. The loader runs it on every
 * file and `tests/help-center.test.ts` fails the build on any problem, so the
 * README and the renderer cannot drift apart.
 *
 * Pure: relative imports only, no I/O. File existence is passed in.
 */

import { isHelpCategory, type HelpCategorySlug } from "./categories.ts";
import type { FrontmatterValue } from "./frontmatter.ts";

export type HelpScreenshot = {
  src: string;
  alt: string;
  caption: string;
};

export type HelpImageSize = { width: number; height: number };

export type HelpArticle = {
  slug: string;
  title: string;
  summary: string;
  category: HelpCategorySlug;
  keywords: string[];
  order: number;
  /** ISO date (YYYY-MM-DD), or null for a database override without one. */
  updated: string | null;
  screenshots: HelpScreenshot[];
  /** GitHub-flavoured markdown. Raw HTML is never rendered. */
  body: string;
  /** Where the article came from. A published database row wins by slug. */
  source: "file" | "database";
  viewCount: number;
};

/** What a list, search result or card needs — no body. */
export type HelpArticleSummary = Pick<
  HelpArticle,
  "slug" | "title" | "summary" | "category" | "updated" | "order"
>;

export const SCREENSHOT_PREFIX = "/help/screenshots/";
export const SCREENSHOT_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
export const MAX_TITLE = 120;
export const MAX_SUMMARY = 220;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates one article's frontmatter and body.
 *
 * Returns the typed article (when the essentials are present) and every
 * problem found. An article with problems is still returned where possible, so
 * the caller decides whether a problem is fatal: the test suite treats all of
 * them as fatal; the runtime loader skips only articles it cannot render.
 */
export function validateArticle(input: {
  slug: string;
  folder: string;
  data: Record<string, FrontmatterValue>;
  body: string;
  screenshotExists?: (src: string) => boolean;
}): { article: HelpArticle | null; problems: string[] } {
  const { slug, folder, data, body } = input;
  const problems: string[] = [];

  if (!SLUG.test(slug)) problems.push(`slug "${slug}" must be lower-case kebab-case`);

  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) problems.push("title is required");
  else if (title.length > MAX_TITLE) problems.push(`title is longer than ${MAX_TITLE} characters`);

  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  if (!summary) problems.push("summary is required");
  else if (summary.length > MAX_SUMMARY) problems.push(`summary is longer than ${MAX_SUMMARY} characters`);

  const category = typeof data.category === "string" ? data.category.trim() : "";
  if (!category) problems.push("category is required");
  else if (!isHelpCategory(category)) problems.push(`category "${category}" is not a known category`);
  else if (category !== folder) problems.push(`category "${category}" does not match its folder "${folder}"`);

  let keywords: string[] = [];
  if (!Array.isArray(data.keywords)) problems.push("keywords is required and must be a list");
  else if (data.keywords.some((k) => typeof k !== "string")) problems.push("keywords must be a list of strings");
  else {
    keywords = (data.keywords as string[]).map((k) => k.trim()).filter(Boolean);
    if (keywords.length === 0) problems.push("keywords must contain at least one keyword");
  }

  let order = 0;
  if (typeof data.order !== "number" || !Number.isFinite(data.order)) {
    problems.push("order is required and must be a number");
  } else {
    order = data.order;
  }

  let updated: string | null = null;
  if (typeof data.updated !== "string" || !DATE.test(data.updated) || Number.isNaN(Date.parse(data.updated))) {
    problems.push("updated is required and must be a date written YYYY-MM-DD");
  } else {
    updated = data.updated;
  }

  const screenshots: HelpScreenshot[] = [];
  if (data.screenshots !== undefined) {
    if (!Array.isArray(data.screenshots)) {
      problems.push("screenshots must be a list");
    } else {
      data.screenshots.forEach((item, index) => {
        if (typeof item !== "object" || item === null) {
          problems.push(`screenshots[${index}] must have src, alt and caption`);
          return;
        }
        const shot = item as Record<string, string>;
        const src = (shot.src ?? "").trim();
        const alt = (shot.alt ?? "").trim();
        const caption = (shot.caption ?? "").trim();
        for (const problem of screenshotProblems(src, input.screenshotExists)) {
          problems.push(`screenshots[${index}]: ${problem}`);
        }
        if (!alt) problems.push(`screenshots[${index}]: alt text is required`);
        if (!caption) problems.push(`screenshots[${index}]: caption is required`);
        screenshots.push({ src, alt, caption });
      });
    }
  }

  const known = new Set(["title", "summary", "category", "keywords", "order", "updated", "screenshots"]);
  for (const key of Object.keys(data)) {
    if (!known.has(key)) problems.push(`unknown frontmatter field "${key}"`);
  }

  if (!body.trim()) problems.push("body is empty");
  for (const problem of bodyProblems(body, input.screenshotExists)) problems.push(problem);

  const article: HelpArticle | null =
    title && summary && isHelpCategory(category)
      ? {
          slug,
          title,
          summary,
          category,
          keywords,
          order,
          updated,
          screenshots,
          body,
          source: "file",
          viewCount: 0,
        }
      : null;

  return { article, problems };
}

function screenshotProblems(src: string, exists?: (src: string) => boolean): string[] {
  const problems: string[] = [];
  if (!src) return ["src is required"];
  if (!src.startsWith(SCREENSHOT_PREFIX)) {
    problems.push(`image "${src}" must live under ${SCREENSHOT_PREFIX}`);
  }
  if (!SCREENSHOT_EXTENSIONS.some((ext) => src.toLowerCase().endsWith(ext))) {
    problems.push(`image "${src}" must be .png, .jpg or .webp`);
  }
  if (src.includes("..")) problems.push(`image "${src}" must not contain ".."`);
  if (exists && problems.length === 0 && !exists(src)) {
    problems.push(`image "${src}" does not exist in public${SCREENSHOT_PREFIX}`);
  }
  return problems;
}

/** Everything in a body that is not inside a fenced or inline code span. */
export function stripCode(body: string): string {
  return body
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
}

/**
 * Raw HTML in a body. The renderer drops it anyway (`skipHtml`), so this
 * exists to tell an author their markup will silently disappear rather than
 * to protect the page. `<https://…>` autolinks are markdown, not HTML.
 */
export function findRawHtml(body: string): string[] {
  const prose = stripCode(body);
  const matches = prose.match(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/g) ?? [];
  return matches.filter((tag) => !/^<(https?:|mailto:)/i.test(tag));
}

/** `![alt](src "caption")` images in a body, outside code. */
export function bodyImages(body: string): { alt: string; src: string; caption: string }[] {
  const prose = stripCode(body);
  const images: { alt: string; src: string; caption: string }[] = [];
  const pattern = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prose)) !== null) {
    images.push({ alt: match[1].trim(), src: match[2].trim(), caption: (match[3] ?? "").trim() });
  }
  return images;
}

export function bodyProblems(body: string, exists?: (src: string) => boolean): string[] {
  const problems: string[] = [];
  for (const tag of findRawHtml(body)) {
    problems.push(`raw HTML is not allowed in the body: ${tag.slice(0, 60)}`);
  }
  for (const image of bodyImages(body)) {
    if (!image.alt) problems.push(`image "${image.src}" has no alt text`);
    if (!image.caption) problems.push(`image "${image.src}" has no "caption" title`);
    for (const problem of screenshotProblems(image.src, exists)) problems.push(problem);
  }
  if (/^#\s/m.test(stripCode(body))) {
    problems.push("the body must not contain a level-1 heading; the title is the page heading");
  }
  return problems;
}

/** Heading slug used for in-page anchors and the table of contents. */
export function headingId(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[`*_~[\]()]/g, "")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

/** Level-2 headings, for the "On this page" list. */
export function tableOfContents(body: string): { id: string; text: string }[] {
  return stripCode(body)
    .split("\n")
    .filter((line) => /^##\s+\S/.test(line))
    .map((line) => {
      const text = line.replace(/^##\s+/, "").replace(/\s+#+\s*$/, "").replace(/[*_`]/g, "").trim();
      return { id: headingId(text), text };
    });
}

/** Sort within a category: `order`, then title. */
export function compareArticles(a: HelpArticleSummary, b: HelpArticleSummary): number {
  return a.order - b.order || a.title.localeCompare(b.title);
}

/** A rough reading time for the article header. */
export function readingMinutes(body: string): number {
  const words = stripCode(body).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** Reads a PNG's pixel size from its IHDR chunk, or null. */
export function pngSize(bytes: Uint8Array): HelpImageSize | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
