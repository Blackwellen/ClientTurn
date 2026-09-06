"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { useBodyScrollLock, useEscape, useFocusTrap } from "@/components/ui/drawer";
import { Logo } from "./logo";
import { CtaLink } from "./cta";

const NAV = [
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Results", href: "/#results" },
  { label: "Industries", href: "/#industries" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
] as const;

export function MarketingHeader() {
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
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-[13px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content sm:inline-flex"
          >
            Log in
          </Link>
          <CtaLink placement="header" size="md">
            Start Free
          </CtaLink>
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
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className="rounded-md px-3 py-3 text-[15px] font-medium text-content transition-colors hover:bg-surface-hover"
                >
                  {item.label}
                </Link>
              ))}
              <div className="my-3 h-px bg-line-subtle" />
              <Link
                href="/login"
                onClick={close}
                className="rounded-md px-3 py-3 text-[15px] font-medium text-content-secondary transition-colors hover:bg-surface-hover"
              >
                Log in
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
