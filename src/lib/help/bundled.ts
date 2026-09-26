import content from "./content.generated.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { validateArticle, type HelpArticle } from "./contract.ts";

/** Statically imported content survives serverless deployment without a filesystem. */
export function readBundledHelpIndex() {
  const articles: HelpArticle[] = [];
  const problems: Record<string, string[]> = {};
  for (const [key, markdown] of Object.entries(content)) {
    const [folder, filename] = key.split("/");
    const parsed = parseFrontmatter(markdown);
    const result = validateArticle({
      slug: filename.replace(/\.md$/, ""),
      folder,
      data: parsed.data,
      body: parsed.body,
    });
    const found = [...parsed.problems, ...result.problems];
    if (found.length) problems[key] = found;
    if (result.article) articles.push(result.article);
  }
  return { articles, problems };
}
