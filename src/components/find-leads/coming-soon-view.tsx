import * as React from "react";
import { EmptyState } from "@/components/ui/feedback";

/**
 * Placeholder for a Find Leads view whose engine is not built yet.
 *
 * It says plainly that the surface is not finished rather than rendering an
 * empty state that implies "you have no data" — a customer who reads "no
 * campaigns yet" and then cannot create one has been misled. `no-stub-release`
 * means this must not ship to a paying workspace; it exists so the four-view
 * navigation is real while the engines land behind it.
 */
export function ComingSoonView({
  icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface-sunken/40">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}
