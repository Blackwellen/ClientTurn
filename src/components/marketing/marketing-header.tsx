"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { useBodyScrollLock, useEscape, useFocusTrap } from "@/components/ui/drawer";
import {
  PRIMARY_NAV,
  type MegaColumn,
  type NavItem,
} from "@/components/marketing/public/nav-data";
import { Logo } from "./logo";
import { CtaLink } from "./cta";

/**
 * Whether a nav item points at the page currently open.
 *
 * Only ever true for real routes: the landing-page anchors all resolve to "/",
 * and marking every one of them active on the home page would be noise.
 */
function isCurrent(pathname: string, href: string): boolean {
  if (href.startsWith("/#")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const TRIGGER_CLASS =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors";

/**
 * A mega menu. It opens on hover for pointer users and on click or Enter for
 * everyone else, and closes on Escape, outside pointer-down, or focus leaving
 * the group — so it is operable without a mouse and never traps focus.
 */
function MegaMenu({
  label,
  columns,
  pathname,
}: {
  label: string;
  columns: MegaColumn[];
  pathname: string;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useEscape(open, close);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const active = columns.some((column) =>
    column.links.some((link) => isCurrent(pathname, link.href)),
  );

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          TRIGGER_CLASS,
          active || open
            ? "text-content"
            : "text-content-secondary hover:bg-surface-hover hover:text-content",
        )}
      >
        {label}
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2">
          <div
            className={cn(
              "grid gap-6 rounded-2xl border border-line bg-surface p-5 shadow-lg",
              columns.length > 1 ? "sm:grid-cols-3" : "w-72",
            )}
          >
            {columns.map((column) => (
              <div key={column.heading} className="min-w-[13rem]">
                <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-muted">
                  {column.heading}
                </p>
                <ul>
                  {column.links.map((link) => (
                    <li key={`${column.heading}-${link.label}`}>
                      <Link
                        href={link.href}
                        onClick={close}
                        aria-current={
                          isCurrent(pathname, link.href) ? "page" : undefined
                        }
                        className="block rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover"
                      >
                        <span className="block text-[13px] font-medium text-content">
                          {link.label}
                        </span>
                        {link.description && (
                          <span className="mt-0.5 block text-[12px] leading-snug text-content-muted">
                            {link.description}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TopLink({ item, pathname }: { item: NavItem; pathname: string }) {
  if (item.kind !== "link") return null;
  const current = isCurrent(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative",
        TRIGGER_CLASS,
        current
          ? "text-content-accent"
          : "text-content-secondary hover:bg-surface-hover hover:text-content",
      )}
    >
      {item.label}
      {current && (
        <span
          aria-hidden
          className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-accent-500"
        />
      )}
    </Link>
  );
}

export function MarketingHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const close = React.useCallback(() => setOpen(false), []);
  useBodyScrollLock(open);
  useFocusTrap(panelRef, open);
  useEscape(open, close);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full transition-colors duration-[var(--lr-duration-base)]",
        scrolled
          ? "border-b border-line bg-surface/90 shadow-xs backdrop-blur-md"
          : "border-b border-transparent bg-bg",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1520px] items-center gap-2 px-4 sm:gap-4 sm:px-[max(5vw,28px)]">
        <Logo className="[&_img]:h-auto [&_img]:w-36 sm:[&_img]:w-[216px]" />

        <nav
          aria-label="Primary"
          className="ml-6 hidden flex-1 items-center gap-1 lg:flex"
        >
          {PRIMARY_NAV.map((item) =>
            item.kind === "mega" ? (
              <MegaMenu
                key={item.id}
                label={item.label}
                columns={item.columns}
                pathname={pathname}
              />
            ) : (
              <TopLink key={item.href} item={item} pathname={pathname} />
            ),
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/contact-sales"
            className="hidden h-10 items-center rounded-md border border-line-strong px-4 text-[13px] font-semibold text-content transition-colors hover:bg-surface-hover md:inline-flex"
          >
            Contact Sales
          </Link>
          {/* On the affiliate page the primary action is joining the
              programme, not starting a product trial — offering "Start Free"
              there sends a would-be partner into the wrong funnel. */}
          {isCurrent(pathname, "/affiliates") ? (
            <Link
              href="/affiliates/apply"
              className="inline-flex h-10 items-center rounded-md bg-accent-500 px-4 text-[13px] font-semibold text-brand-midnight transition-colors hover:bg-[#a6e238]"
            >
              Become an Affiliate
            </Link>
          ) : (
            <CtaLink placement="header" size="md" className="gap-2">
              Start Free <ArrowRight className="size-4" aria-hidden />
            </CtaLink>
          )}
          <IconButton
            label={open ? "Close menu" : "Open menu"}
            size="sm"
            variant="secondary"
            aria-expanded={open}
            aria-controls="marketing-mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </IconButton>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 top-16 z-40 lg:hidden">
          <div
            aria-hidden
            onClick={close}
            className="absolute inset-0 bg-[var(--lr-overlay)]"
          />
          <div
            id="marketing-mobile-nav"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            tabIndex={-1}
            className="absolute inset-x-0 top-0 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-surface px-5 py-4 shadow-lg outline-none"
          >
            <nav aria-label="Mobile" className="flex flex-col">
              {PRIMARY_NAV.map((item) =>
                item.kind === "mega" ? (
                  <div key={item.id} className="py-2">
                    <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-muted">
                      {item.label}
                    </p>
                    {item.columns.flatMap((column) =>
                      column.links.map((link) => (
                        <Link
                          key={`${column.heading}-${link.label}`}
                          href={link.href}
                          onClick={close}
                          className="block rounded-md px-3 py-2.5 text-[15px] font-medium text-content transition-colors hover:bg-surface-hover"
                        >
                          {link.label}
                        </Link>
                      )),
                    )}
                  </div>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className="rounded-md px-3 py-3 text-[15px] font-medium text-content transition-colors hover:bg-surface-hover"
                  >
                    {item.label}
                  </Link>
                ),
              )}
              <div className="my-3 h-px bg-line-subtle" />
              <Link
                href="/login"
                onClick={close}
                className="rounded-md px-3 py-3 text-[15px] font-medium text-content-secondary transition-colors hover:bg-surface-hover"
              >
                Log in
              </Link>
              <Link
                href="/contact-sales"
                onClick={close}
                className="rounded-md px-3 py-3 text-[15px] font-medium text-content-secondary transition-colors hover:bg-surface-hover"
              >
                Contact Sales
              </Link>
              <CtaLink
                placement="header_mobile"
                size="lg"
                fullWidth
                className="mt-2"
              >
                Start Free
              </CtaLink>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
