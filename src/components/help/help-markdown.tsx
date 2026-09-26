import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Info, Lightbulb, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  bodyImages,
  headingId,
  type HelpImageSize,
  type HelpScreenshot,
} from "@/lib/help/contract";

/**
 * Renders one help article body (Phase 8.1/8.2).
 *
 * Safety: GitHub-flavoured markdown only. `skipHtml` drops any raw HTML in
 * the source rather than escaping or interpreting it, and react-markdown's
 * default URL transform strips `javascript:` and other unsafe protocols. There
 * is no `dangerouslySetInnerHTML` anywhere in the path, so a published
 * `support_articles` row cannot inject markup into the page it renders on.
 *
 * No `"use client"`: it has no state or effects, so the public pages render it
 * on the server and the support popout renders it on the client from the same
 * code. It styles itself with the shared tokens, which `.ct-marketing` remaps
 * onto the dark public canvas, so one component serves both themes.
 */

type CalloutTone = "note" | "tip" | "important" | "warning";

const CALLOUTS: Record<
  CalloutTone,
  { icon: React.ComponentType<{ className?: string }>; box: string; chip: string }
> = {
  note: {
    icon: Info,
    box: "border-[rgb(56_189_248/0.35)] bg-[rgb(56_189_248/0.08)]",
    chip: "bg-[rgb(56_189_248)] text-[#0B1020]",
  },
  tip: {
    icon: Lightbulb,
    box: "border-[rgb(183_243_74/0.5)] bg-[rgb(183_243_74/0.10)]",
    chip: "bg-[var(--ct-lime)] text-[#0B1020]",
  },
  important: {
    icon: AlertTriangle,
    box: "border-[rgb(245_158_11/0.45)] bg-[rgb(245_158_11/0.10)]",
    chip: "bg-[rgb(245_158_11)] text-[#0B1020]",
  },
  warning: {
    icon: OctagonAlert,
    box: "border-[rgb(239_68_68/0.45)] bg-[rgb(239_68_68/0.09)]",
    chip: "bg-[rgb(239_68_68)] text-white",
  },
};

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
};

function meaningfulChildren(node: HastNode | undefined): HastNode[] {
  return (node?.children ?? []).filter(
    (child) => !(child.type === "text" && !(child.value ?? "").trim()),
  );
}

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** `> **Note:** …` → "note". Anything else is an ordinary quote. */
export function calloutTone(node: HastNode | undefined): CalloutTone | null {
  const paragraph = meaningfulChildren(node).find((child) => child.type === "element");
  if (paragraph?.tagName !== "p") return null;
  const first = meaningfulChildren(paragraph)[0];
  if (first?.type !== "element" || first.tagName !== "strong") return null;
  const label = textOf(first).trim().replace(/:$/, "").toLowerCase();
  return label in CALLOUTS ? (label as CalloutTone) : null;
}

export function HelpFigure({
  src,
  alt,
  caption,
  number,
  size,
}: {
  src: string;
  alt: string;
  caption: string;
  number: number;
  size?: HelpImageSize;
}) {
  return (
    <figure className="my-6">
      <div className="overflow-hidden rounded-xl border border-line bg-surface-sunken shadow-xs">
        {size ? (
          <Image
            src={src}
            alt={alt}
            width={size.width}
            height={size.height}
            loading="lazy"
            sizes="(min-width: 1024px) 760px, 100vw"
            className="block h-auto w-full"
          />
        ) : (
          // Size unknown (not a PNG, or missing): reserve a typical screenshot
          // ratio so the text below does not jump when it arrives.
          // eslint-disable-next-line @next/next/no-img-element -- dimensions are unknown, so next/image cannot be used without `fill`, and a fixed-ratio box is the layout-stable choice here.
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            className="block aspect-[16/10] h-auto w-full object-contain"
          />
        )}
      </div>
      {caption ? (
        <figcaption className="mt-2.5 flex items-start gap-2.5">
          <span className="mt-px inline-flex shrink-0 items-center rounded-md bg-[var(--ct-lime)] px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-[#0B1020]">
            Figure {number}
          </span>
          <span className="text-[13px] leading-relaxed text-content-secondary">{caption}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Rewrites `/help/...` links for the surface the article is shown on. */
function resolveHref(href: string, helpBase: string): string {
  if (href === "/help" || href.startsWith("/help/")) {
    return href.replace(/^\/help/, helpBase);
  }
  return href;
}

export function HelpMarkdown({
  body,
  imageSizes = {},
  screenshots = [],
  helpBase = "/help",
  compact = false,
}: {
  body: string;
  imageSizes?: Record<string, HelpImageSize>;
  /** Frontmatter screenshots, shown as a gallery after the body. */
  screenshots?: HelpScreenshot[];
  /** Where `/help/...` links should point: `/help` publicly, `/app/help` in the app. */
  helpBase?: string;
  /** Tighter type scale for the support popout. */
  compact?: boolean;
}) {
  // Figures are numbered in page order, from the source, so the numbering is
  // stable no matter how React schedules the render.
  const inline = bodyImages(body);
  const figureNumbers = new Map<string, number>();
  for (const image of inline) {
    if (!figureNumbers.has(image.src)) figureNumbers.set(image.src, figureNumbers.size + 1);
  }
  const gallery = screenshots.filter((shot) => !figureNumbers.has(shot.src));

  const text = compact ? "text-[13.5px] leading-[1.65]" : "text-[15px] leading-[1.75]";

  const components: Components = {
    h2: ({ children, node }) => {
      const id = headingId(textOf(node as HastNode));
      return (
        <h2
          id={id}
          className={cn(
            "scroll-mt-24 font-semibold tracking-tight text-content",
            compact ? "mt-6 text-[16px]" : "mt-10 text-[21px]",
          )}
        >
          {children}
        </h2>
      );
    },
    h3: ({ children, node }) => (
      <h3
        id={headingId(textOf(node as HastNode))}
        className={cn(
          "scroll-mt-24 font-semibold text-content",
          compact ? "mt-4 text-[14.5px]" : "mt-7 text-[17px]",
        )}
      >
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-5 text-[14.5px] font-semibold text-content">{children}</h4>
    ),
    p: ({ children, node }) => {
      // A paragraph that is only an image becomes a figure; a <figure> inside
      // a <p> is invalid HTML and breaks hydration.
      const kids = meaningfulChildren(node as HastNode);
      if (kids.length === 1 && kids[0].tagName === "img") return <>{children}</>;
      return <p className={cn("mt-4 text-content-secondary", text)}>{children}</p>;
    },
    a: ({ href = "", children }) => {
      const resolved = resolveHref(href, helpBase);
      const external = /^https?:\/\//i.test(resolved);
      const className =
        "font-medium text-content underline decoration-[var(--ct-lime)] decoration-2 underline-offset-4 hover:decoration-content";
      if (external) {
        return (
          <a href={resolved} target="_blank" rel="noopener noreferrer" className={className}>
            {children}
          </a>
        );
      }
      if (resolved.startsWith("#") || resolved.startsWith("mailto:")) {
        return (
          <a href={resolved} className={className}>
            {children}
          </a>
        );
      }
      return (
        <Link href={resolved} className={className}>
          {children}
        </Link>
      );
    },
    strong: ({ children }) => <strong className="font-semibold text-content">{children}</strong>,
    ul: ({ children }) => (
      <ul className={cn("mt-4 list-disc space-y-2 pl-5 marker:text-content-subtle text-content-secondary", text)}>
        {children}
      </ul>
    ),
    ol: ({ children, start }) => {
      let step = typeof start === "number" ? start : 1;
      const numbered = React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ "data-step"?: number }>, {
              "data-step": step++,
            })
          : child,
      );
      return <ol className={cn("mt-5 space-y-3", text)}>{numbered}</ol>;
    },
    li: (props) => {
      const { children } = props;
      const step = (props as { "data-step"?: number })["data-step"];
      if (step === undefined) return <li className="pl-1">{children}</li>;
      return (
        <li className="flex gap-3 text-content-secondary">
          <span
            aria-hidden
            className="mt-[3px] flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ct-lime)] text-[12px] font-bold text-[#0B1020]"
          >
            {step}
          </span>
          <span className="min-w-0 flex-1">
            <span className="sr-only">Step {step}: </span>
            {children}
          </span>
        </li>
      );
    },
    blockquote: ({ children, node }) => {
      const tone = calloutTone(node as HastNode);
      if (!tone) {
        return (
          <blockquote className="mt-5 border-l-2 border-line-strong pl-4 italic text-content-secondary">
            {children}
          </blockquote>
        );
      }
      const { icon: Icon, box, chip } = CALLOUTS[tone];
      return (
        <aside
          role="note"
          className={cn(
            "mt-5 flex gap-3 rounded-xl border px-4 py-3.5 [&>div>p:first-child]:mt-0",
            box,
          )}
        >
          <span
            aria-hidden
            className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md", chip)}
          >
            <Icon className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1 [&_p]:mt-2">{children}</div>
        </aside>
      );
    },
    code: ({ children, className }) => {
      const block = /language-/.test(className ?? "");
      if (block) return <code className={className}>{children}</code>;
      return (
        <code className="rounded-md border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.86em] text-content">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface-sunken p-4 font-mono text-[12.5px] leading-relaxed text-content [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="mt-5 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[480px] border-collapse text-left text-[13.5px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-surface-sunken">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-line px-3.5 py-2.5 font-semibold text-content">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border-b border-line px-3.5 py-2.5 align-top text-content-secondary">{children}</td>
    ),
    hr: () => <hr className="my-8 border-line" />,
    img: ({ src, alt, title }) => {
      const source = typeof src === "string" ? src : "";
      return (
        <HelpFigure
          src={source}
          alt={alt ?? ""}
          caption={title ?? ""}
          number={figureNumbers.get(source) ?? 0}
          size={imageSizes[source]}
        />
      );
    },
  };

  return (
    <div className="help-article min-w-0 [&>*:first-child]:mt-0">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {body}
      </Markdown>

      {gallery.length > 0 ? (
        <section aria-label="Screenshots" className="mt-10">
          <h2 className={cn("font-semibold tracking-tight text-content", compact ? "text-[16px]" : "text-[21px]")}>
            Screenshots
          </h2>
          {gallery.map((shot, index) => (
            <HelpFigure
              key={shot.src}
              src={shot.src}
              alt={shot.alt}
              caption={shot.caption}
              number={figureNumbers.size + index + 1}
              size={imageSizes[shot.src]}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
