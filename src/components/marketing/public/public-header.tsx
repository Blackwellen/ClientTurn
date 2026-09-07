"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/ui/logo";
import { trackEngagement } from "@/lib/marketing/track";
import { buttonClass } from "./ui";
import { PRIMARY_NAV, type MegaColumn, type NavItem } from "./nav-data";
import { PublicCta } from "./cta-link";

/**
 * The public site header.
 *
 * Mega menus open on click and on keyboard, never on hover alone — a
 * hover-only menu is unreachable by keyboard and unusable on touch. Exactly
 * one menu is open at a time, Escape closes it and returns focus to the
 * trigger that opened it, and a click anywhere outside the header closes it.
 *
 * The header keeps a constant height through the scroll transition so nothing
 * below it shifts; only the background, blur and border change.
 */

function isCurrent(pathname: string, href: string): boolean {
  if (href.startsWith("/#")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ---------------------------------------------------------- mega menu --- */

function MegaPanel({
  id,
  columns,
  onNavigate,
}: {
  id: string;
  columns: MegaColumn[];
  onNavigate: (label: string) => void;
}) {
  return (
    <div
      id={`mega-${id}`}
      className="pub-mega left-1/2 w-[min(920px,calc(100vw-2*var(--pub-gutter)))] -translate-x-1/2"
    >
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((column) => (
          <div key={column.heading}>
            <p className="pub-mega-heading">{column.heading}</p>
            <ul className="space-y-0.5">
              {column.links.map((link) => (
                <li key={`${column.heading}-${link.label}`}>
                  <Link
                    href={link.href}
                    className="pub-mega-link"
                    onClick={() => onNavigate(link.label)}
                  >
                    <strong>{link.label}</strong>
                    {link.description ? <span>{link.description}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- header --- */

export function PublicHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = React.useState(false);
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const headerRef = React.useRef<HTMLElement>(null);
  const triggerRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Close the open mega menu on outside interaction. Pointer-down rather than
     click so the menu is gone before the outside target reacts. */
  React.useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu]);

  /* Escape closes whichever layer is open, returning focus where it came
     from so a keyboard user is never dropped at the top of the document. */
  React.useEffect(() => {
    if (!openMenu && !drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openMenu) {
        const trigger = triggerRefs.current[openMenu];
        setOpenMenu(null);
        trigger?.focus();
      } else {
        setDrawerOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openMenu, drawerOpen]);

  /* The drawer is a modal layer: the page behind it must not scroll. */
  React.useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  /* Any route change closes everything. Adjusted during render rather than
     in an effect: the menus are derived from "which page are we on", so
     resetting them here avoids the extra commit an effect would cost. */
  const [lastPath, setLastPath] = React.useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpenMenu(null);
    setDrawerOpen(false);
  }

  const onNavigate = React.useCallback((label: string) => {
    trackEngagement("public_nav_click", label);
    setOpenMenu(null);
    setDrawerOpen(false);
  }, []);

  function renderItem(item: NavItem) {
    if (item.kind === "link") {
      return (
        <Link
          key={item.label}
          href={item.href}
          data-current={isCurrent(pathname, item.href) ? "true" : undefined}
          aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
          className="pub-nav-trigger"
          onClick={() => onNavigate(item.label)}
        >
          {item.label}
        </Link>
      );
    }

    const expanded = openMenu === item.id;
    return (
      <div key={item.id} className="static">
        <button
          type="button"
          ref={(node) => {
            triggerRefs.current[item.id] = node;
          }}
          aria-expanded={expanded}
          aria-controls={`mega-${item.id}`}
          aria-haspopup="true"
          className="pub-nav-trigger"
          onClick={() => setOpenMenu(expanded ? null : item.id)}
        >
          {item.label}
          <ChevronDown
            aria-hidden
            className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
          />
        </button>
        {expanded ? (
          <MegaPanel id={item.id} columns={item.columns} onNavigate={onNavigate} />
        ) : null}
      </div>
    );
  }

  return (
    <header ref={headerRef} data-scrolled={scrolled ? "true" : "false"} className="pub-header">
      <div className="pub-container">
        <div className="pub-header-bar relative">
          <Link href="/" aria-label="ClientTurn home" className="mr-2 inline-flex shrink-0 items-center">
            <Logo href={null} height={56} imgClassName="h-9 w-auto sm:h-12" />
          </Link>

          <nav
            aria-label="Primary"
            className="ml-4 hidden items-center gap-0.5 lg:flex xl:ml-8 xl:gap-1"
          >
            {PRIMARY_NAV.map(renderItem)}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/login"
              className={cn(buttonClass("quiet", "sm"), "hidden sm:inline-flex")}
              onClick={() => onNavigate("Log in")}
            >
              Log in
            </Link>
            <Link
              href="/contact-sales"
              className={cn(buttonClass("secondary", "sm"), "hidden md:inline-flex")}
              onClick={() => onNavigate("Contact Sales")}
            >
              Contact Sales
            </Link>
            <PublicCta placement="header" size="sm" className="hidden min-[420px]:inline-flex">
              Start Free
            </PublicCta>

            <button
              type="button"
              aria-expanded={drawerOpen}
              aria-controls="public-mobile-nav"
              aria-label={drawerOpen ? "Close menu" : "Open menu"}
              onClick={() => setDrawerOpen((open) => !open)}
              className={cn(buttonClass("secondary", "sm"), "!px-3 lg:hidden")}
            >
              {drawerOpen ? (
                <X aria-hidden className="size-5" />
              ) : (
                <Menu aria-hidden className="size-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {drawerOpen ? (
        <MobileDrawer pathname={pathname} onNavigate={onNavigate} onClose={() => setDrawerOpen(false)} />
      ) : null}
    </header>
  );
}

/* ------------------------------------------------------ mobile drawer --- */

function MobileDrawer({
  pathname,
  onNavigate,
  onClose,
}: {
  pathname: string;
  onNavigate: (label: string) => void;
  onClose: () => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  /* Focus moves into the drawer on open and is trapped inside it while open,
     so a keyboard or screen-reader user cannot tab out into the page behind. */
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--pub-header-h)] z-50 lg:hidden">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-[var(--lr-overlay)]" />
      <div
        id="public-mobile-nav"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        tabIndex={-1}
        className="absolute inset-x-0 top-0 max-h-full overflow-y-auto border-b border-[var(--pub-border)] bg-[var(--pub-bg-raised)] px-[var(--pub-gutter)] pb-8 pt-5 outline-none"
      >
        {/* The primary conversion action stays at the top of the drawer: it is
            never buried under an accordion the visitor has to open first. */}
        <PublicCta placement="header_mobile" size="lg" fullWidth arrow>
          Start Free
        </PublicCta>

        <nav aria-label="Mobile" className="mt-6 space-y-6">
          {PRIMARY_NAV.map((item) =>
            item.kind === "link" ? (
              <Link
                key={item.label}
                href={item.href}
                aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                onClick={() => onNavigate(item.label)}
                className="block min-h-11 py-2 text-[17px] font-semibold text-[var(--pub-text)]"
              >
                {item.label}
              </Link>
            ) : (
              <div key={item.id}>
                <p className="pub-footer-heading mb-2">{item.label}</p>
                <ul className="space-y-0.5">
                  {item.columns.flatMap((column) =>
                    column.links.map((link) => (
                      <li key={`${item.id}-${column.heading}-${link.label}`}>
                        <Link
                          href={link.href}
                          onClick={() => onNavigate(link.label)}
                          className="flex min-h-11 items-center text-[15px] text-[var(--pub-text-secondary)]"
                        >
                          {link.label}
                        </Link>
                      </li>
                    )),
                  )}
                </ul>
              </div>
            ),
          )}
        </nav>

        <div className="mt-7 grid gap-3 border-t border-[var(--pub-border)] pt-6">
          <Link
            href="/contact-sales"
            onClick={() => onNavigate("Contact Sales")}
            className={buttonClass("secondary", "lg")}
          >
            Contact Sales
          </Link>
          <Link
            href="/login"
            onClick={() => onNavigate("Log in")}
            className={buttonClass("quiet", "lg")}
          >
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
