import { cn } from "@/lib/cn";

/**
 * The "skip to content" bypass (WCAG 2.2 SC 2.4.1).
 *
 * Every authenticated shell puts a nine-item rail and a top bar ahead of the
 * page, so without this a keyboard or switch user tabs through the entire
 * navigation again on every single route. The marketing layout already had
 * one; the app, admin and affiliate shells did not, which is where it matters
 * most because those are the surfaces people use all day.
 *
 * Visually hidden until focused rather than removed from the tab order: a
 * `display: none` skip link is not reachable, and one that is permanently
 * visible is a design cost nobody accepts, so it gets reinstated as a real
 * element the moment it takes focus.
 *
 * The target must be a `<main id="...">` that can hold focus — see `MainRegion`.
 */
export function SkipLink({
  href = "#main",
  children = "Skip to content",
  className,
}: {
  href?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={cn(
        "sr-only focus:not-sr-only",
        "focus:absolute focus:left-4 focus:top-4 focus:z-[60]",
        "focus:rounded-md focus:bg-accent-600 focus:px-4 focus:py-2",
        "focus:text-sm focus:font-medium focus:text-white",
        "focus:outline-2 focus:outline-offset-2 focus:outline-[var(--ct-lime)]",
        className,
      )}
    >
      {children}
    </a>
  );
}

/**
 * The landing point for `SkipLink`.
 *
 * `tabIndex={-1}` is the load-bearing part: following a fragment link moves
 * the *document* position but not focus unless the target is focusable, so
 * without it the next Tab press drops the user straight back into the
 * navigation they just skipped. -1 keeps it out of the tab order while still
 * allowing it to be focused programmatically.
 */
export function MainRegion({
  id = "main",
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main id={id} tabIndex={-1} className={cn("focus:outline-none", className)}>
      {children}
    </main>
  );
}
