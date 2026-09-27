import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session";
import { helpCategory, isHelpCategory } from "@/lib/help/categories";
import { articlesInCategory, toSummary } from "@/lib/help/service";
import {
  HelpArticleRow,
  HelpBreadcrumbs,
  HelpSearchForm,
} from "@/components/help/help-centre";

export const dynamic = "force-dynamic";

type Params = Promise<{ category: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { category } = await params;
  return { title: `${helpCategory(category)?.title ?? "Help"} · Help` };
}

export default async function AppHelpCategoryPage({ params }: { params: Params }) {
  await requireWorkspace();
  const { category: slug } = await params;
  if (!isHelpCategory(slug)) notFound();
  const category = helpCategory(slug)!;
  const articles = await articlesInCategory(slug);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-2">
      <HelpBreadcrumbs items={[{ label: "Help", href: "/app/help" }, { label: category.title }]} />
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-content">{category.title}</h1>
        <p className="mt-1 text-[14px] text-content-muted">{category.description}</p>
      </div>
      <HelpSearchForm base="/app/help" size="md" />
      {articles.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-sunken/60 px-5 py-8 text-center text-[13.5px] text-content-muted">
          There are no articles in this category yet.
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {articles.map((article) => (
            <li key={article.slug}>
              <HelpArticleRow base="/app/help" article={toSummary(article)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
