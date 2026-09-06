"use client";

import * as React from "react";
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  CircleHelp,
  Mail,
  MessageSquare,
  Rocket,
  Search,
  Send,
  Settings,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  readHelpArticle,
  searchHelpArticles,
} from "@/lib/support/actions";
import { NewTicketForm } from "./new-ticket-form";
import type { Screen } from "./support-popout";

type Article = Awaited<ReturnType<typeof searchHelpArticles>>[number];
type FullArticle = NonNullable<Awaited<ReturnType<typeof readHelpArticle>>>;

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rocket: Rocket,
  users: Users,
  mail: Mail,
  calendar: Calendar,
  settings: Settings,
};

/**
 * The Help tab (V4 §23.4).
 *
 * Search runs against the platform's own article index only — never the open
 * web. An answer here has to be true of ClientTurn specifically, and a general
 * search cannot promise that.
 */
export function HelpView({
  screen,
  onOpenArticle,
  onNewTicket,
  onBack,
  onCreated,
  pathname,
}: {
  screen: Screen;
  onOpenArticle: (slug: string) => void;
  onNewTicket: () => void;
  onBack: () => void;
  onCreated: () => void;
  pathname: string;
}) {
  if (screen.kind === "new-ticket") {
    return (
      <NewTicketForm pathname={pathname} onBack={onBack} onCreated={onCreated} />
    );
  }

  if (screen.kind === "article") {
    return <ArticleView slug={screen.slug} onBack={onBack} />;
  }

  return <HelpIndex onOpenArticle={onOpenArticle} onNewTicket={onNewTicket} />;
}

/* ------------------------------------------------------------------ index */

function HelpIndex({
  onOpenArticle,
  onNewTicket,
}: {
  onOpenArticle: (slug: string) => void;
  onNewTicket: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [articles, setArticles] = React.useState<Article[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Debounced so typing does not fire a request per keystroke.
  React.useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        searchHelpArticles(query)
          .then((rows) => {
            if (active) setArticles(rows);
          })
          .catch(() => {
            if (active) setArticles([]);
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 250 : 0,
    );

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="space-y-4 p-5">
      <div>
        <h2 className="text-[24px] font-bold leading-tight text-content">
          How can we help?
        </h2>
        <p className="mt-1 text-[13.5px] text-content-muted">
          Search for help articles or get in touch with our support team.
        </p>
      </div>

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-muted"
        />
        <input
          type="search"
          aria-label="Search help articles"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search help articles..."
          className={cn(
            "h-11 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-[13.5px]",
            "placeholder:text-content-subtle",
            "focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-content-accent",
          )}
        />
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-content">
          {query ? "Results" : "Popular help articles"}
        </h3>
      </div>

      {/* Local skeletons, never a blanked panel. */}
      {loading ? (
        <ul className="space-y-2.5" aria-hidden>
          {[0, 1, 2, 3].map((row) => (
            <li
              key={row}
              className="h-[68px] animate-pulse rounded-xl border border-line bg-surface-sunken/60"
            />
          ))}
        </ul>
      ) : articles.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface-sunken/50 px-3.5 py-6 text-center text-[13px] text-content-muted">
          No articles matched that search. Send us a message and we will help
          directly.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {articles.map((article) => {
            const Icon = ICONS[article.icon ?? ""] ?? CircleHelp;
            return (
              <li key={article.slug}>
                <button
                  type="button"
                  onClick={() => onOpenArticle(article.slug)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left",
                    "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                  )}
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-content-secondary"
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-content">
                      {article.title}
                    </span>
                    {article.summary && (
                      <span className="block truncate text-[12.5px] text-content-muted">
                        {article.summary}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-content-subtle"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-xl border border-line bg-surface-sunken/60 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-content-secondary"
          >
            <MessageSquare className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-content">
              Still need help?
            </p>
            <p className="mt-0.5 text-[12.5px] leading-[1.45] text-content-muted">
              Can&rsquo;t find what you&rsquo;re looking for? Send us a message
              and our support team will get back to you.
            </p>
          </div>
        </div>

        <Button fullWidth className="mt-3.5" onClick={onNewTicket}>
          <Send className="size-4" aria-hidden />
          New support ticket
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- article */

function ArticleView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [article, setArticle] = React.useState<FullArticle | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let active = true;
    readHelpArticle(slug)
      .then((row) => {
        if (!active) return;
        setArticle(row);
        setState(row ? "ready" : "error");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <div className="space-y-3 p-5">
      <BackLink label="Support" onClick={onBack} />

      {state === "loading" && (
        <div aria-hidden className="space-y-2">
          <div className="h-6 w-2/3 animate-pulse rounded bg-surface-sunken" />
          <div className="h-4 w-full animate-pulse rounded bg-surface-sunken" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-surface-sunken" />
        </div>
      )}

      {state === "error" && (
        <p role="alert" className="text-[13px] text-content-muted">
          That article could not be loaded. Try again, or send us a message.
        </p>
      )}

      {state === "ready" && article && (
        <article>
          <h2 className="text-[19px] font-bold leading-snug text-content">
            {article.title}
          </h2>
          {/* Plain text, rendered as paragraphs. No HTML is interpreted, so an
              article can never inject markup into the shell. */}
          {article.body.split("\n\n").map((paragraph, index) => (
            <p
              key={index}
              className="mt-3 whitespace-pre-wrap text-[13.5px] leading-[1.65] text-content-secondary"
            >
              {paragraph}
            </p>
          ))}
        </article>
      )}
    </div>
  );
}

export function BackLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-content-accent",
        "hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
      )}
    >
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </button>
  );
}
