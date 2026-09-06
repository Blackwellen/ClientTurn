"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Bell, Building2, ChevronDown, Menu } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { titleForAdminPath } from "@/lib/admin/nav";
import { AdminProfileMenu } from "./admin-profile-menu";
import { AdminSearch } from "./admin-search";

export function AdminTopBar({
  onOpenNav,
  operator,
  recentCustomers,
  alertCount,
}: {
  onOpenNav: () => void;
  operator: { name: string; email: string };
  recentCustomers: { id: string; name: string }[];
  alertCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();

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

      <div className="hidden min-w-0 flex-1 lg:flex">
        <AdminSearch />
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
        {/* Scope selector. Choosing a customer opens their support drawer —
            it is navigation, not a hidden global filter. */}
        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label="Customer scope"
              className={cn(
                "hidden h-9 items-center gap-2 rounded-full border border-line px-3 sm:inline-flex",
                "text-[12px] font-medium text-content-secondary",
                "transition-colors hover:bg-surface-hover hover:text-content",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
              )}
            >
              <Building2 className="size-3.5" aria-hidden />
              All customers
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          }
        >
          <DropdownItem onSelect={() => router.push("/admin/customers")}>
            All customers
          </DropdownItem>
          {recentCustomers.length > 0 && (
            <>
              <DropdownSeparator />
              <DropdownLabel>Recent</DropdownLabel>
              {recentCustomers.map((customer) => (
                <DropdownItem
                  key={customer.id}
                  onSelect={() =>
                    router.push(`/admin/customers?customer=${customer.id}`)
                  }
                >
                  {customer.name}
                </DropdownItem>
              ))}
            </>
          )}
        </DropdownMenu>

        {/* One environment exists, so this reports rather than switches. */}
        <Tooltip content="This deployment serves the live platform. There is no second environment to switch to.">
          <span
            className={cn(
              "hidden h-9 items-center gap-2 rounded-full border border-line px-3 sm:inline-flex",
              "text-[12px] font-medium text-content-secondary",
            )}
          >
            <span aria-hidden className="size-1.5 rounded-full bg-success-500" />
            Live Platform
          </span>
        </Tooltip>

        <Link
          href="/admin"
          aria-label={
            alertCount > 0
              ? `${alertCount} items need attention`
              : "Nothing needs attention"
          }
          className={cn(
            "relative inline-flex size-9 items-center justify-center rounded-full",
            "text-content-muted transition-colors hover:bg-surface-hover hover:text-content",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
          )}
        >
          <Bell className="size-4" aria-hidden />
          {alertCount > 0 && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-danger-500 ring-2 ring-surface"
            />
          )}
        </Link>

        <AdminProfileMenu name={operator.name} email={operator.email} />
      </div>
    </header>
  );
}
