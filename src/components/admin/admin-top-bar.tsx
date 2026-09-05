"use client";

import { usePathname } from "next/navigation";
import { Building2, Menu, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { titleForAdminPath } from "@/lib/admin/nav";
import { AdminProfileMenu } from "./admin-profile-menu";

export function AdminTopBar({
  onOpenNav,
  operator,
}: {
  onOpenNav: () => void;
  operator: { name: string; email: string };
}) {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-md sm:px-6"
      style={{ height: "var(--lr-topbar-height)" }}
    >
      <IconButton
        size="sm"
        label="Open navigation"
        className="lg:hidden"
        onClick={onOpenNav}
      >
        <Menu className="size-4" />
      </IconButton>

      <h1 className="min-w-0 shrink-0 truncate text-[15px] font-semibold text-content lg:hidden">
        {titleForAdminPath(pathname)}
      </h1>

      <div className="hidden min-w-0 flex-1 lg:flex lg:max-w-[690px]">
        <Tooltip content="Platform-wide search is not wired up yet">
          <div
            aria-disabled="true"
            className={cn(
              "flex h-11 w-full cursor-not-allowed items-center gap-2.5 rounded-[11px] border border-line-strong bg-surface px-3.5",
              "text-[14px] text-content-subtle opacity-70 shadow-xs",
            )}
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="truncate">Search customers, leads, jobs, settings…</span>
          </div>
        </Tooltip>
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
        <Tooltip content="Scoping admin views to a single customer is not wired up yet">
          <button
            type="button"
            disabled
            className={cn(
              "hidden sm:inline-flex items-center gap-2 rounded-full border border-line",
              "h-9 cursor-not-allowed px-3 text-[12px] font-medium text-content-secondary opacity-70",
            )}
          >
            <Building2 className="size-3.5" aria-hidden />
            All customers
          </button>
        </Tooltip>

        <span
          className={cn(
            "hidden sm:inline-flex items-center gap-2 rounded-full border border-line",
            "h-9 px-3 text-[12px] font-medium text-content-secondary",
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-success-500" />
          Live Platform
        </span>

        <AdminProfileMenu name={operator.name} email={operator.email} />
      </div>
    </header>
  );
}
