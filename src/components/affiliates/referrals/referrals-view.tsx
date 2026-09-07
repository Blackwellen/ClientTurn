"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CreditCard,
  Download,
  Info,
  MousePointerClick,
  RefreshCw,
  Search,
  TestTube,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import {
  Panel,
  PanelEmpty,
  PanelLink,
  Table,
  Td,
} from "@/components/affiliates/portal-ui";
import { formatMinor } from "@/lib/affiliates/types";
import {
  COMMISSION_STATUS_LABEL,
  COMMISSION_STATUS_TONE,
} from "@/lib/affiliates/types";
import {
  attributionRemaining,
  PAID_STATE_LABEL,
  PAID_STATE_TONE,
  TRIAL_STATE_LABEL,
  TRIAL_STATE_TONE,
} from "@/lib/affiliates/programme";
import type { PortalReferral, ReferralPage } from "@/lib/affiliates/portal";

/**
 * The referrals table (V4 §32).
 *
 * Three independent status columns, because a referral genuinely has three
 * independent states: its trial, its payment and its commission. A single
 * rolled-up "status" cannot express "converted trial, paid, commission still
 * in review", which is exactly the row a partner writes in about.
 *
 * What is deliberately absent: the customer's name, email, workspace or usage.
 * An affiliate introduced this business; they have no relationship with it and
 * no right to its identity. See `referralLabel` in `types.ts`.
 */
export function ReferralsView({
  page,
  currency,
}: {
  page: ReferralPage;
  currency: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = React.useState(params.get("q") ?? "");
  const [status, setStatus] = React.useState(params.get("status") ?? "all");

  // The table is server-paginated, so filters go back through the URL rather
  // than filtering a page of ten rows in the browser and calling it a search.
  function apply(next: { q?: string; status?: string; page?: number }) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === "" || value === "all") query.delete(key);
      else query.set(key, String(value));
    }
    router.push(`/affiliates/app/referrals?${query.toString()}`);
  }

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));

  return (
    <Panel
      icon={Users}
      title="All Referrals"
      description="View and manage all your referred accounts."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-content-subtle"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") apply({ q: search, page: 1 });
              }}
              placeholder="Search referrals…"
              aria-label="Search referrals"
              className="h-9 w-[180px] rounded-[9px] border border-line bg-surface pl-8 pr-3 text-[13px] text-content placeholder:text-content-subtle"
            />
          </div>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              apply({ status: event.target.value, page: 1 });
            }}
            aria-label="Filter by status"
            className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content"
          >
            <option value="all">All statuses</option>
            <option value="SIGNED_UP">Signed up</option>
            <option value="TRIALING">On trial</option>
            <option value="PAID">Paying</option>
            <option value="CHURNED">Churned</option>
            <option value="REFUNDED">Refunded</option>
          </select>
          <a
            href="/affiliates/app/referrals/export"
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[12.5px] font-medium text-content hover:bg-surface-hover"
          >
            <Download className="size-3.5" aria-hidden />
            Export
          </a>
        </div>
      }
    >
      {page.rows.length === 0 ? (
        <PanelEmpty
          title="No referrals yet."
          description="Share a referral link and the accounts you introduce will appear here as they progress."
        />
      ) : (
        <>
          <Table
            minWidth={1080}
            headers={[
              { label: "Referral" },
              { label: "Source link / Campaign" },
              { label: "Signup date" },
              { label: "Trial status" },
              { label: "Plan" },
              { label: "Paid state" },
              { label: "Commission state" },
              { label: "Attribution expiry" },
              { label: "Commission", numeric: true },
            ]}
          >
            {page.rows.map((row) => (
              <ReferralRow key={row.id} row={row} currency={currency} />
            ))}
          </Table>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-[12.5px] text-content-muted">
              Showing {(page.page - 1) * page.pageSize + 1}–
              {Math.min(page.page * page.pageSize, page.total)} of {page.total}{" "}
              referrals
            </p>

            {totalPages > 1 && (
              <nav aria-label="Referral pages" className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => index + 1).map(
                  (number) => (
                    <button
                      key={number}
                      type="button"
                      onClick={() => apply({ page: number })}
                      aria-current={number === page.page ? "page" : undefined}
                      className={cn(
                        "size-8 rounded-[7px] text-[12.5px] font-medium",
                        number === page.page
                          ? "bg-accent-500 text-brand-midnight"
                          : "border border-line text-content-secondary hover:bg-surface-hover",
                      )}
                    >
                      {number}
                    </button>
                  ),
                )}
              </nav>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function ReferralRow({
  row,
  currency,
}: {
  row: PortalReferral;
  currency: string;
}) {
  const expiry = attributionRemaining(row.attributionExpiresAt);

  return (
    <tr className="hover:bg-surface-hover">
      <Td>
        <p className="font-medium text-content">{row.label}</p>
        {/* No email, by design. The affiliate has no relationship with this
            customer and no right to their contact details. */}
        <p className="text-[11.5px] text-content-subtle">
          Introduced {new Date(row.createdAt).toLocaleDateString("en-GB")}
        </p>
      </Td>
      <Td className="text-content-secondary">{row.sourceLabel ?? "Direct"}</Td>
      <Td className="whitespace-nowrap text-content-secondary">
        {row.signupAt
          ? new Date(row.signupAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "—"}
      </Td>
      <Td>
        <Badge tone={TRIAL_STATE_TONE[row.trialState]} dense>
          {TRIAL_STATE_LABEL[row.trialState]}
        </Badge>
      </Td>
      <Td>
        {row.planKey ? (
          <span className="rounded-[6px] bg-purple-50 px-2 py-0.5 text-[11.5px] font-medium capitalize text-purple-700">
            {row.planKey}
          </span>
        ) : (
          <span className="text-content-subtle">—</span>
        )}
      </Td>
      <Td>
        <Badge tone={PAID_STATE_TONE[row.paidState]} dense>
          {PAID_STATE_LABEL[row.paidState]}
        </Badge>
      </Td>
      <Td>
        {row.commissionState ? (
          <Badge tone={COMMISSION_STATUS_TONE[row.commissionState]} dense>
            {COMMISSION_STATUS_LABEL[row.commissionState]}
          </Badge>
        ) : (
          <span className="text-content-subtle">—</span>
        )}
      </Td>
      <Td>
        <span
          className={cn(
            "rounded-[6px] px-2 py-0.5 text-[11.5px] font-medium",
            expiry.expired
              ? "bg-surface-sunken text-content-muted"
              : expiry.urgent
                ? "bg-warning-50 text-warning-700"
                : "bg-surface-sunken text-content-secondary",
          )}
        >
          {expiry.label}
        </span>
      </Td>
      <Td numeric className="font-semibold">
        {formatMinor(row.commissionMinor, currency)}
      </Td>
    </tr>
  );
}

/* ------------------------------------------------------------- lifecycle -- */

const STAGE_ICON = {
  click: MousePointerClick,
  signup: Users,
  trial: TestTube,
  paid: CreditCard,
  renewal: RefreshCw,
  commission: Banknote,
  payout: BadgeCheck,
} as const;

/**
 * The seven-stage lifecycle strip.
 *
 * Each stage carries its own conversion caption against the previous stage,
 * which is what makes the strip diagnostic rather than decorative: an affiliate
 * can see at a glance that their problem is clicks-to-signup, not
 * trial-to-paid.
 */
export function ReferralLifecycle({
  stages,
  currency,
}: {
  stages: readonly {
    key: string;
    label: string;
    value: number;
    caption: string;
    money?: boolean;
  }[];
  currency: string;
}) {
  return (
    <Panel
      icon={Users}
      title="Referral Lifecycle"
      description="From first click to payout — see how your referrals progress through each stage."
      action={<PanelLink href="/affiliates/app/performance">View lifecycle insights</PanelLink>}
    >
      <ol className="flex flex-wrap items-start gap-y-4 overflow-x-auto px-4 pb-4">
        {stages.map((stage, index) => {
          const Icon = STAGE_ICON[stage.key as keyof typeof STAGE_ICON] ?? Users;
          return (
            <li key={stage.key} className="flex min-w-0 items-start">
              <div className="min-w-[86px]">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-accent-50">
                    <Icon className="size-3.5 text-content-accent" aria-hidden />
                  </span>
                  <span className="text-[13px] font-medium text-content">
                    {stage.label}
                  </span>
                </div>
                <p className="mt-2 text-[20px] font-bold leading-none tabular-nums text-content">
                  {stage.money
                    ? formatMinor(stage.value, currency)
                    : stage.value.toLocaleString("en-GB")}
                </p>
                <p className="mt-1 text-[11.5px] text-content-muted">
                  {stage.caption}
                </p>
              </div>
              {index < stages.length - 1 && (
                <ArrowRight
                  className="mx-3 mt-1.5 size-4 shrink-0 text-content-subtle"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* -------------------------------------------------------- about attribution */

export function AboutAttribution({
  windowDays,
  model,
}: {
  windowDays: number;
  model: string;
}) {
  const points = [
    {
      title: `Attribution window: ${windowDays} days`,
      body: `You'll earn commission on purchases made within ${windowDays} days of the first click.`,
    },
    {
      title: model === "LAST_TOUCH" ? "Last click attribution" : "First click attribution",
      body:
        model === "LAST_TOUCH"
          ? "The last link they clicked is credited for the referral."
          : "The first link they clicked is credited for the referral.",
    },
    {
      title: "Tracks across all pages",
      body: "We automatically track signups, trials, payments and renewals.",
    },
  ];

  return (
    <Panel
      icon={Info}
      title="About Attribution"
      description="How referral tracking works."
    >
      <ul className="space-y-3 px-4 pb-4">
        {points.map((point) => (
          <li key={point.title} className="flex gap-2.5">
            <BadgeCheck
              className="mt-0.5 size-4 shrink-0 text-success-600"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-content">
                {point.title}
              </p>
              <p className="text-[12px] leading-relaxed text-content-muted">
                {point.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
