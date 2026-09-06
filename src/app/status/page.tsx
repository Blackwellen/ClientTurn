import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { ArrowLeft, CircleAlert, CircleCheck, Mail } from "lucide-react";
import { getStatusSnapshot, STATUS_META } from "@/lib/status/service";
import {
  BackgroundJobs,
  LastSync,
  RecentFailures,
  StatusGroup,
  StatusLegend,
  formatShort,
} from "@/components/status/status-parts";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "System Status",
  description:
    "Real-time status and performance information for ClientTurn services and integrations.",
  robots: { index: true, follow: true },
};

// Revalidated rather than cached indefinitely: a status page that is a minute
// stale is useful, one that is an hour stale is worse than nothing.
export const revalidate = 60;

/**
 * `/status` — the public status page (V4 §22).
 *
 * Intended to be served at `status.clientturn.com` via a host rewrite. The
 * route is built and ready for that mapping; until the DNS and rewrite are
 * configured it is reachable at `/status` on the main domain, and nothing on
 * this page claims otherwise.
 *
 * No authentication, no workspace, no customer data. Everything shown comes
 * from `StatusService`, which is the same source the support popout reads, so
 * the two can never contradict each other.
 */
export default async function StatusPage() {
  const snapshot = await getStatusSnapshot();
  const meta = STATUS_META[snapshot.overall];

  const headline =
    snapshot.overall === "OPERATIONAL"
      ? "operational"
      : snapshot.overall === "DEGRADED"
        ? "partially degraded"
        : snapshot.overall === "OUTAGE"
          ? "experiencing an outage"
          : "under maintenance";

  const subline =
    snapshot.overall === "OPERATIONAL"
      ? "All systems are running smoothly. We'll keep you updated if anything changes."
      : snapshot.overall === "MAINTENANCE"
        ? "Planned maintenance is in progress. Some features may be briefly unavailable."
        : "We are aware of the issue and are working on it. This page updates automatically.";

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image
              src="/white_background_logo.png"
              alt="ClientTurn"
              width={150}
              height={40}
              priority
              className="h-8 w-auto"
            />
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Back to ClientTurn
            </Link>
            <Link
              href="/contact-sales?topic=status-updates"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <Mail className="size-3.5" aria-hidden />
              Subscribe to updates
            </Link>
          </div>
        </div>
      </header>

      <main id="status-main" className="flex-1">
        {/* ------------------------------------------------------------ hero */}
        <section
          className={cn(
            "border-b border-slate-200",
            snapshot.overall === "OPERATIONAL"
              ? "bg-gradient-to-b from-emerald-50/70 to-slate-50"
              : snapshot.overall === "OUTAGE"
                ? "bg-gradient-to-b from-red-50/70 to-slate-50"
                : "bg-gradient-to-b from-amber-50/70 to-slate-50",
          )}
        >
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-start justify-between gap-6 px-5 py-9">
            <div className="min-w-[18rem] flex-1">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                System status
              </p>
              <h1 className="mt-2 text-[34px] font-bold leading-[1.15] text-slate-900">
                ClientTurn is{" "}
                <span
                  className={cn(
                    snapshot.overall === "OPERATIONAL"
                      ? "text-emerald-600"
                      : snapshot.overall === "OUTAGE"
                        ? "text-red-600"
                        : "text-amber-600",
                  )}
                >
                  {headline}
                </span>
              </h1>
              <p className="mt-2 max-w-[46rem] text-[15px] text-slate-600">
                {subline}
              </p>

              <p className="mt-4 inline-flex items-center gap-2 text-[13px] text-slate-600">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-white",
                    snapshot.stale ? "bg-amber-500" : "bg-emerald-500",
                  )}
                >
                  {snapshot.stale ? (
                    <CircleAlert className="size-3.5" />
                  ) : (
                    <CircleCheck className="size-3.5" />
                  )}
                </span>
                Last updated: {formatShort(snapshot.generatedAt)} UTC
              </p>

              {/* Said plainly rather than dressed as health. */}
              {snapshot.stale && (
                <p className="mt-2 max-w-[46rem] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  These readings are older than expected, so they may not reflect
                  the current state of the platform.
                </p>
              )}
            </div>

            <div
              className={cn(
                "w-full max-w-[22rem] rounded-xl border p-4 shadow-sm",
                snapshot.overall === "OPERATIONAL"
                  ? "border-emerald-200 bg-emerald-50"
                  : snapshot.overall === "OUTAGE"
                    ? "border-red-200 bg-red-50"
                    : "border-amber-200 bg-amber-50",
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-white",
                    snapshot.overall === "OPERATIONAL"
                      ? "bg-emerald-500"
                      : snapshot.overall === "OUTAGE"
                        ? "bg-red-500"
                        : "bg-amber-500",
                  )}
                >
                  {snapshot.overall === "OPERATIONAL" ? (
                    <CircleCheck className="size-5" />
                  ) : (
                    <CircleAlert className="size-5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-slate-900">
                    {snapshot.overall === "OPERATIONAL"
                      ? "All systems operational"
                      : `${meta.label} — some services affected`}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-slate-600">
                    {snapshot.overall === "OPERATIONAL"
                      ? "ClientTurn is running normally. No ongoing incidents."
                      : "One or more services are not fully healthy."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- services */}
        <div className="mx-auto max-w-[1180px] px-5 py-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[20px] font-bold text-slate-900">Services</h2>
              <p className="mt-0.5 text-[13.5px] text-slate-600">
                Status of all ClientTurn services and integrations.
              </p>
            </div>
            <StatusLegend />
          </div>

          <div className="space-y-4">
            {snapshot.groups.map((group) => (
              <StatusGroup key={group.key} group={group} />
            ))}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <RecentFailures failures={snapshot.failures} />
            <BackgroundJobs jobs={snapshot.jobs} />
            <LastSync rows={snapshot.lastSync} />
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-6">
          <div className="flex items-center gap-3">
            <Image
              src="/white_background_logo.png"
              alt=""
              width={130}
              height={34}
              className="h-7 w-auto"
            />
            <div>
              <p className="text-[13px] font-semibold text-slate-900">
                System Status
              </p>
              <p className="text-[12px] text-slate-500">
                Status and performance information for ClientTurn.
              </p>
            </div>
          </div>

          <p className="text-[13px] text-slate-600">
            Need help?{" "}
            <Link
              href="/contact-sales"
              className="font-medium text-blue-600 hover:underline"
            >
              Contact support
            </Link>
          </p>
        </div>
      </footer>
    </>
  );
}
