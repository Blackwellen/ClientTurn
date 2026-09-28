"use client";

import * as React from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/feedback";
import { errorReference } from "@/lib/errors/friendly";
import { reportClientError } from "@/lib/observability/report-client-error";

/**
 * The body of every route `error.tsx` in the signed-in app, onboarding and
 * admin. One component so every failure reads the same way:
 *
 *   - a plain sentence (never `error.message`, which in production is
 *     Next's generic text and in development can be a stack or SQL);
 *   - "Try again" (the boundary's `reset`) and a way back to the section,
 *     so the page is never a dead end;
 *   - the error digest as a support reference: the server log carries the
 *     same digest, so a ticket quoting it finds the real error;
 *   - the error itself reported to Sentry and the console.
 */
export function RouteError({
  error,
  reset,
  boundary,
  title = "This page could not be loaded",
  description = "The problem has been logged. Try again, and contact support if it keeps happening.",
  backHref,
  backLabel,
  framed = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Tag for the error report, e.g. "leads" or "admin". */
  boundary: string;
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  /** Wrap in a card, for boundaries that render inside a page body. */
  framed?: boolean;
}) {
  React.useEffect(() => {
    reportClientError(error, boundary);
  }, [error, boundary]);

  const reference = React.useMemo(() => errorReference(error.digest), [error.digest]);

  const state = (
    <ErrorState
      title={title}
      description={description}
      onRetry={reset}
      reference={reference}
      secondaryAction={
        backHref ? (
          <Link
            href={backHref}
            className="rounded-xs text-[13px] font-medium text-content-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
          >
            {backLabel ?? "Go back"}
          </Link>
        ) : null
      }
    />
  );

  return framed ? (
    <div className="rounded-xl border border-line bg-surface">{state}</div>
  ) : (
    state
  );
}
