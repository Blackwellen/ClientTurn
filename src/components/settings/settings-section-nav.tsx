import * as React from "react";
import Link from "next/link";
import { Building2, CreditCard, Link2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings/types";

const ICONS: Record<
  SettingsSection,
  React.ComponentType<{ className?: string }>
> = {
  workspace: Building2,
  connections: Link2,
  team: Users,
  billing: CreditCard,
};

/**
 * The four Settings sections. Deliberately substantial cards rather than a tab
 * strip: they are the only navigation inside Settings, and each one is a
 * destination a customer looks for by name.
 *
 * The active section is passed down from the page rather than read from
 * `useSearchParams`, which keeps this a server component and avoids needing a
 * Suspense boundary purely to read the query string.
 */
export function SettingsSectionNav({ active }: { active: SettingsSection }) {
  return (
    <nav aria-label="Settings sections">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = ICONS[section.id];
          const isActive = section.id === active;

          return (
            <li key={section.id}>
              <Link
                href={`/app/settings?section=${section.id}`}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-4 py-3.5 shadow-xs",
                  "transition-colors duration-[var(--lr-duration-fast)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                  isActive
                    ? "border-accent-500 bg-accent-50/40"
                    : "border-line bg-surface hover:bg-surface-hover",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-[10px] border",
                    isActive
                      ? "border-accent-200/70 bg-accent-50 text-content-accent"
                      : "border-line bg-surface-sunken text-info-600",
                  )}
                >
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-content">
                    {section.label}
                  </span>
                  <span className="block truncate text-[12.5px] text-content-muted">
                    {section.description}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
