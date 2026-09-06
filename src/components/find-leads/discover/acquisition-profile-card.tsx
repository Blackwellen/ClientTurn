"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Globe, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type {
  AcquisitionProfileView,
  AnalysisProgressView,
} from "@/lib/find-leads/types";
import { analyseBusinessAction } from "@/lib/find-leads/actions";

/**
 * The acquisition profile card, and the website analysis that fills it.
 *
 * One card with three states rather than three cards, because they are three
 * moments in one job: you have no profile, a profile is being built, or you
 * have one. Showing an empty profile card next to a setup card would ask the
 * customer to work out which one applies.
 */

export function AcquisitionProfileCard({
  profile,
  analysis,
  defaultWebsite,
  canManage,
}: {
  profile: AcquisitionProfileView;
  analysis: AnalysisProgressView | null;
  defaultWebsite: string | null;
  canManage: boolean;
}) {
  const running =
    analysis?.status === "QUEUED" ||
    analysis?.status === "FETCHING" ||
    analysis?.status === "EXTRACTING";

  if (running && analysis) return <AnalysisProgressCard analysis={analysis} />;
  if (!profile.complete) {
    return (
      <SetupCard
        defaultWebsite={defaultWebsite ?? profile.websiteUrl}
        canManage={canManage}
        failed={analysis?.status === "FAILED"}
      />
    );
  }

  return <ProfileSummaryCard profile={profile} canManage={canManage} />;
}

/* ------------------------------------------------------------- set up */

function SetupCard({
  defaultWebsite,
  canManage,
  failed,
}: {
  defaultWebsite: string | null;
  canManage: boolean;
  failed: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [url, setUrl] = React.useState(defaultWebsite ?? "");
  const [pending, startTransition] = React.useTransition();

  const analyse = () => {
    startTransition(async () => {
      const result = await analyseBusinessAction(url);
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      toast({
        variant: "success",
        title: "Analysing your website",
        description: "This runs in the background — you can carry on searching.",
      });
      router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
        >
          <Globe className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold text-content">
            Set up your business profile
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-content-muted">
            Analyse your website to automatically generate your acquisition profile.
          </p>
        </div>
      </div>

      {failed && (
        <p role="status" className="mt-3 rounded-md bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
          The last analysis could not read your website. Check the address and try again,
          or fill the profile in yourself.
        </p>
      )}

      <div className="mt-3.5">
        <label
          htmlFor="business-url"
          className="mb-1.5 block text-[12px] font-medium text-content-secondary"
        >
          Business URL
        </label>
        <div className="relative">
          <Globe
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
            aria-hidden
          />
          <Input
            id="business-url"
            type="url"
            inputMode="url"
            value={url}
            disabled={!canManage || pending}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.example.co.uk"
            className="pl-9"
          />
        </div>
      </div>

      <Button
        fullWidth
        size="md"
        className="mt-3"
        onClick={analyse}
        loading={pending}
        disabled={!canManage || url.trim().length < 4}
        title={canManage ? undefined : "Only owners and admins can run an analysis."}
      >
        Analyse business
      </Button>

      <p className="mt-3 flex gap-2 rounded-lg bg-accent-50/60 px-3 py-2.5 text-[12px] leading-relaxed text-content-secondary">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-accent-600" aria-hidden />
        We read a few public pages from your own site to understand your services,
        locations and target customers, then suggest a search strategy. You confirm
        everything before it is used.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------- in progress */

function AnalysisProgressCard({ analysis }: { analysis: AnalysisProgressView }) {
  const router = useRouter();

  // Poll while the crawl runs. It stops the moment the job leaves a running
  // state, so a finished analysis costs nothing.
  React.useEffect(() => {
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <section
      aria-live="polite"
      className="rounded-xl border border-line bg-surface p-4 shadow-xs"
    >
      <div className="flex items-center gap-2.5">
        <Loader2 className="size-4 animate-spin text-content-accent" aria-hidden />
        <h2 className="text-[14.5px] font-semibold text-content">Analysis in progress</h2>
      </div>

      <div className="mt-3 flex items-baseline justify-between text-[12px]">
        <span className="text-content-muted">
          Pages analysed{" "}
          <span className="font-medium tabular-nums text-content">
            {analysis.pagesAnalysed} / {analysis.pagesTargeted}
          </span>
        </span>
        <span className="font-semibold tabular-nums text-content">{analysis.percent}%</span>
      </div>
      <Progress
        value={analysis.percent}
        label="Website analysis progress"
        className="mt-1.5"
      />

      <ul className="mt-3.5 space-y-1.5">
        {analysis.categories.map((category) => (
          <li
            key={category.label}
            className="flex items-center justify-between gap-3 text-[12.5px]"
          >
            <span className="text-content-secondary">{category.label}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-medium",
                category.state === "FOUND"
                  ? "text-success-700"
                  : category.state === "ANALYSING"
                    ? "text-content-accent"
                    : "text-content-subtle",
              )}
            >
              {category.state === "FOUND" && (
                <CheckCircle2 className="size-3.5" aria-hidden />
              )}
              {category.state === "FOUND"
                ? "Found"
                : category.state === "ANALYSING"
                  ? "Analysing"
                  : "Pending"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------- summary */

function ProfileSummaryCard({
  profile,
  canManage,
}: {
  profile: AcquisitionProfileView;
  canManage: boolean;
}) {
  const rows: [string, string][] = [
    ["Business type", profile.businessType ?? "—"],
    ["Services", profile.services.slice(0, 4).join(", ") || "—"],
    ["Locations", profile.locations.slice(0, 4).join(", ") || "—"],
    ["Target customers", profile.targetCustomers.slice(0, 4).join(", ") || "—"],
    ["Conversion goal", profile.conversionGoal ?? "—"],
  ];

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Building2 className="size-3.5" />
          </span>
          <h2 className="text-[14.5px] font-semibold text-content">
            Your acquisition profile
          </h2>
        </div>
        {canManage ? (
          <Link
            href="/app/settings?view=workspace"
            className="border-line-strong bg-surface text-content hover:bg-surface-hover focus-visible:outline-content-accent inline-flex h-7 shrink-0 items-center rounded-sm border px-2.5 text-xs font-medium shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Edit
          </Link>
        ) : (
          <Button
            variant="secondary"
            size="xs"
            disabled
            title="Only owners and admins can edit the profile."
          >
            Edit
          </Button>
        )}
      </div>

      <dl className="px-4 pb-1">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex gap-4 border-t border-line-subtle py-2 first:border-t-0"
          >
            <dt className="w-[112px] shrink-0 text-[12.5px] text-content-muted">{label}</dt>
            <dd className="min-w-0 flex-1 text-[12.5px] text-content">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="m-3 flex items-center gap-2.5 rounded-lg bg-success-50 px-3 py-2.5">
        <CheckCircle2 className="size-4 shrink-0 text-success-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-success-700">Profile complete</p>
          <p className="text-[11.5px] leading-snug text-content-secondary">
            Your business profile is set up and ready to use.
          </p>
        </div>
      </div>
    </section>
  );
}
