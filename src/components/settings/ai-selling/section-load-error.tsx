import * as React from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/feedback";

/** One card's read failed. The rest of the section stays usable. */
export function SectionLoadError({
  title,
  href = "/app/settings?section=ai-selling",
}: {
  title: string;
  /** Where "Try again" reloads. */
  href?: string;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <ErrorState
        title={`${title} could not be loaded`}
        description="Nothing has been changed. This is usually temporary."
      />
      <p className="pb-6 text-center">
        <Link
          href={href}
          className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          Try again
        </Link>
      </p>
    </section>
  );
}
