import * as React from "react";
import { cn } from "@/lib/cn";

export function Container({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1180px] px-5 sm:px-8", className)}
      {...props}
    />
  );
}

export function Section({
  id,
  className,
  tone = "default",
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  id?: string;
  tone?: "default" | "sunken";
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20 border-t border-line-subtle py-20 sm:py-28",
        tone === "sunken" ? "bg-surface-sunken/60" : "bg-bg",
        className,
      )}
      {...props}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-[12px] font-semibold uppercase tracking-[0.14em] text-content-accent",
        className,
      )}
      {...props}
    />
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      <h2 className="text-balance text-[26px] font-semibold leading-tight tracking-tight text-content sm:text-[34px]">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-[15px] leading-relaxed text-content-secondary sm:text-base">
          {description}
        </p>
      )}
    </div>
  );
}

/** Wide content (tables, wide diagrams) scrolls here, never the page body. */
export function ScrollArea({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("w-full overflow-x-auto overscroll-x-contain", className)}
      {...props}
    />
  );
}
