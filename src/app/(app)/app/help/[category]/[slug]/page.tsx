import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session";
import { helpCategory, isHelpCategory } from "@/lib/help/categories";
import { getHelpArticleForRender, recordHelpView, relatedArticles } from "@/lib/help/service";
import { HelpArticleView } from "@/components/help/help-centre";
import { ContactSupportButton } from "@/components/help/contact-support-button";

export const dynamic = "force-dynamic";

type Params = Promise<{ category: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const found = await getHelpArticleForRender(slug);
  return { title: found ? `${found.article.title} · Help · Client Turn` : "Help · Client Turn" };
}

/**
 * An in-app help article: the same article, renderer and source as the public
 * `/help/<category>/<slug>` page, inside the app shell so a customer reading it
 * keeps their navigation, Copilot and the support popout.
 */
export default async function AppHelpArticlePage({ params }: { params: Params }) {
  await requireWorkspace();
  const { category, slug } = await params;
  if (!isHelpCategory(category)) notFound();

  const found = await getHelpArticleForRender(slug);
  if (!found) notFound();
  const { article, imageSizes } = found;
  if (article.category !== category) redirect(`/app/help/${article.category}/${article.slug}`);

  // Rendered per request, so the view is counted here rather than by a beacon.
  const [related] = await Promise.all([relatedArticles(article), recordHelpView(article.slug)]);
  const categoryMeta = helpCategory(article.category)!;

  return (
    <div className="mx-auto w-full max-w-[1100px] py-2">
      <HelpArticleView
        base="/app/help"
        article={article}
        imageSizes={imageSizes}
        related={related}
        breadcrumbs={[
          { label: "Help", href: "/app/help" },
          { label: categoryMeta.title, href: `/app/help/${categoryMeta.slug}` },
          { label: article.title },
        ]}
        footer={
          <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[14px] font-semibold text-content">Still stuck?</p>
              <p className="mt-0.5 text-[13px] text-content-muted">
                Raise a ticket and the page you were on is attached for us.
              </p>
            </div>
            <ContactSupportButton />
          </div>
        }
      />
    </div>
  );
}
