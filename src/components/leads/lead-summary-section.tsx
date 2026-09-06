"use client";

import * as React from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Home,
  Layers,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  ScrollText,
  User,
  UserCircle2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/form";
import { LEAD_STATUS } from "@/components/ui/badge";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { LEAD_STATUSES } from "@/lib/leads/filters";
import {
  attentionReasonLabel,
  type LeadCapabilities,
  type LeadDetail,
} from "@/lib/leads/types";
import { LeadSourceGlyph, sourceStyle } from "./lead-source-badge";
import { LeadManualActions } from "./lead-manual-actions";
import type { LeadDrawerActions, RunAction } from "./lead-drawer-actions";

/* ------------------------------------------------------------------ pieces */

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[12px] font-semibold text-content-secondary">
      {children}
    </p>
  );
}

function IconRow({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-px size-4 shrink-0 text-content-subtle" aria-hidden />
      <div className="min-w-0 text-[13px] text-content">{children}</div>
    </div>
  );
}

/** Source metadata row. Renders nothing at all when the value is absent —
 *  an empty "Campaign: —" would imply the data exists and is blank. */
function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-content-subtle" aria-hidden />
      <div className="min-w-0">
        <p className="text-[11px] text-content-subtle">{label}</p>
        <p className="truncate text-[13px] text-content-secondary" title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

function ControlField({
  id,
  icon: Icon,
  label,
  tone = "neutral",
  children,
}: {
  id?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: "neutral" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Icon
        className={cn(
          "size-5 shrink-0",
          tone === "warning" ? "text-warning-500" : "text-content-subtle",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="mb-1 block text-[11px] font-medium text-content-secondary"
        >
          {label}
        </label>
        {children}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  title,
  headline,
  detail,
  footnote,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  headline: string;
  detail?: React.ReactNode;
  footnote?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface p-3.5 shadow-xs">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-50"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h4 className="truncate text-[12px] font-semibold text-content-secondary">
            {title}
          </h4>
          <p className="truncate text-[13px] font-semibold text-content" title={headline}>
            {headline}
          </p>
        </div>
      </div>

      {detail && <div className="mt-2 min-w-0 text-[12px] text-content-muted">{detail}</div>}
      {footnote && (
        <p className="mt-2 text-[11px] text-content-subtle">{footnote}</p>
      )}
      {action && <div className="mt-auto pt-3">{action}</div>}
    </section>
  );
}

function CardAction({
  children,
  disabled,
  title,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "h-8 w-full rounded-lg border border-line-strong bg-surface text-[12px] font-medium text-content-secondary",
        "shadow-xs transition-colors duration-[var(--lr-duration-fast)]",
        "hover:bg-surface-hover hover:text-content",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-surface",
      )}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- section */

const QUALIFICATION_COPY: Record<string, { label: string; blurb: string }> = {
  PENDING: { label: "Pending", blurb: "Lead not yet qualified" },
  QUALIFIED: { label: "Qualified", blurb: "Meets your criteria" },
  REVIEW: { label: "Needs review", blurb: "A person must decide on this lead" },
  NOT_QUALIFIED: { label: "Not qualified", blurb: "Does not meet your criteria" },
};

/**
 * Booking state in the product's own words. Derived from the booking record
 * rather than stored, so it can never disagree with the calendar.
 */
function bookingStateLabel(booking: LeadDetail["bookings"][number] | null) {
  if (!booking) return "Not booked";
  if (booking.status === "cancelled") return "Cancelled";
  if (booking.status === "no_show") return "No show";
  if (booking.status === "completed") return "Completed";
  return booking.starts_at ? "Booked" : "Booking link sent";
}

export function LeadSummarySection({
  detail,
  actions,
  capabilities,
  canWrite,
  pending,
  run,
  onOpenComposer,
  focus,
}: {
  detail: LeadDetail;
  actions: LeadDrawerActions;
  capabilities: LeadCapabilities;
  canWrite: boolean;
  pending: string | null;
  run: RunAction;
  onOpenComposer: (channel: "sms" | "whatsapp") => void;
  focus?: string;
}) {
  const { lead, members, bookings } = detail;
  const source = lead.lead_sources;
  const provider = sourceStyle(source?.provider);
  const booking = bookings.find((row) => row.status === "scheduled") ?? bookings[0] ?? null;
  const qualification =
    QUALIFICATION_COPY[lead.qualification_state] ?? QUALIFICATION_COPY.PENDING;

  const assignRef = React.useRef<HTMLSelectElement>(null);
  const statusRef = React.useRef<HTMLSelectElement>(null);

  // The row menu can deep-link straight at a control; honour that on open.
  React.useEffect(() => {
    if (focus === "assign") assignRef.current?.focus();
    else if (focus === "status") statusRef.current?.focus();
    else if (focus === "takeover") {
      document
        .getElementById("lead-manual-actions")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focus]);

  const locality = [lead.postcode].filter(Boolean).join(", ");

  return (
    <div className="space-y-3">
      {/* ---------------------------------------------------- overview card */}
      <section className="rounded-xl border border-line bg-surface shadow-xs">
        <div className="grid grid-cols-1 divide-y divide-line-subtle lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <div className="min-w-0 p-4">
            <ColumnHeading>Contact details</ColumnHeading>
            <div className="space-y-2.5">
              <IconRow icon={User}>
                <span className="truncate">
                  {[lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
                    "Name not provided"}
                </span>
              </IconRow>
              <IconRow icon={Phone}>
                {lead.phone ? (
                  <a
                    href={`tel:${lead.phone}`}
                    className="rounded-xs hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
                  >
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-content-subtle">Not provided</span>
                )}
              </IconRow>
              <IconRow icon={Mail}>
                {lead.email ? (
                  <a
                    href={`mailto:${lead.email}`}
                    title={lead.email}
                    className="block truncate text-content-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
                  >
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-content-subtle">Not provided</span>
                )}
              </IconRow>
            </div>
          </div>

          <div className="min-w-0 p-4">
            <ColumnHeading>Service interested in</ColumnHeading>
            <div className="space-y-2.5">
              <IconRow icon={Home}>
                <span className="truncate">
                  {lead.services?.name ?? (
                    <span className="text-content-subtle">No service recorded</span>
                  )}
                </span>
              </IconRow>
              <IconRow icon={MapPin}>
                {locality || <span className="text-content-subtle">No location</span>}
              </IconRow>
            </div>
          </div>

          <div className="min-w-0 p-4">
            <ColumnHeading>Source</ColumnHeading>
            <div className="space-y-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <LeadSourceGlyph provider={source?.provider} size="sm" />
                <span className="truncate text-[13px] font-medium text-content">
                  {provider.label}
                </span>
              </div>
              <MetaRow icon={ScrollText} label="Meta form" value={source?.form_name} />
              <MetaRow
                icon={Megaphone}
                label="Campaign"
                value={source?.campaign_name}
              />
              <MetaRow icon={Layers} label="Ad set" value={source?.adset_name} />
              <MetaRow icon={ScrollText} label="Ad" value={source?.ad_name} />
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------- controls */}
        <div className="grid grid-cols-1 gap-4 border-t border-line-subtle px-4 pb-3 pt-4 sm:grid-cols-2">
          <ControlField id="lead-assign-control" icon={UserCircle2} label="Assigned to">
            <Select
              id="lead-assign-control"
              ref={assignRef}
              className="h-9 text-[13px]"
              disabled={!canWrite || pending === "assign"}
              value={lead.assigned_user_id ?? ""}
              onChange={(event) =>
                run(
                  "assign",
                  () =>
                    actions.assignLead({
                      leadId: lead.id,
                      userId: event.target.value || null,
                    }),
                  "Lead assigned.",
                )
              }
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </Select>
          </ControlField>

          <ControlField id="lead-status-control" icon={BarChart3} label="Status">
            <Select
              id="lead-status-control"
              ref={statusRef}
              className="h-9 text-[13px]"
              disabled={!canWrite || pending === "status"}
              value={lead.status}
              onChange={(event) =>
                run(
                  "status",
                  () =>
                    actions.updateLeadStatus({
                      leadId: lead.id,
                      status: event.target.value,
                    }),
                  "Status updated.",
                )
              }
            >
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {LEAD_STATUS[status].label}
                </option>
              ))}
            </Select>
          </ControlField>
        </div>

        <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          <ControlField
            id="lead-attention-control"
            icon={AlertTriangle}
            label="Needs attention"
            tone={lead.needs_attention ? "warning" : "neutral"}
          >
            <Select
              id="lead-attention-control"
              className="h-9 text-[13px]"
              disabled={!canWrite || pending === "attention"}
              value={lead.needs_attention ? "yes" : "no"}
              onChange={(event) =>
                run(
                  "attention",
                  () =>
                    actions.setNeedsAttention({
                      leadId: lead.id,
                      needsAttention: event.target.value === "yes",
                    }),
                  "Attention state updated.",
                )
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </ControlField>

          <ControlField
            id="lead-qualification-control"
            icon={BarChart3}
            label="Qualification result"
          >
            <Select
              id="lead-qualification-control"
              className="h-9 text-[13px]"
              disabled={!canWrite || pending === "qualification"}
              value={lead.qualification_state}
              onChange={(event) =>
                run(
                  "qualification",
                  () =>
                    actions.setQualificationResult({
                      leadId: lead.id,
                      result: event.target.value,
                    }),
                  "Qualification updated.",
                )
              }
            >
              <option value="PENDING">Pending</option>
              <option value="QUALIFIED">Qualified</option>
              <option value="REVIEW">Needs review</option>
              <option value="NOT_QUALIFIED">Not qualified</option>
            </Select>
          </ControlField>

          <ControlField icon={CalendarDays} label="Booking state">
            <p className="flex h-9 items-center rounded-md border border-line bg-surface-sunken/60 px-3 text-[13px] text-content-secondary">
              {bookingStateLabel(booking)}
            </p>
          </ControlField>
        </div>

        {lead.needs_attention && (
          <p className="flex items-start gap-2 border-t border-line-subtle bg-danger-50/60 px-4 py-2.5 text-[12px] font-medium text-danger-700">
            <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
            {attentionReasonLabel(lead.attention_reason)}
          </p>
        )}

        {lead.opted_out && (
          <p className="border-t border-line-subtle bg-danger-50/60 px-4 py-2.5 text-[12px] font-medium text-danger-700">
            This lead has opted out. No further messages can be sent to them.
          </p>
        )}
      </section>

      {/* ------------------------------------------------- three mini cards */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SummaryCard
          icon={<LeadSourceGlyph provider={source?.provider} size="sm" />}
          title="Lead source summary"
          headline={provider.label}
          detail={
            <div className="space-y-0.5">
              {source?.campaign_name && (
                <p className="truncate" title={source.campaign_name}>
                  {source.campaign_name}
                </p>
              )}
              {source?.ad_name && (
                <p className="truncate" title={source.ad_name}>
                  {source.ad_name}
                </p>
              )}
            </div>
          }
          footnote={`Submitted ${formatRelative(lead.created_at)}`}
        />

        <SummaryCard
          icon={<BarChart3 className="size-4 text-content-accent" />}
          title="Qualification summary"
          headline={qualification.label}
          detail={qualification.blurb}
          action={
            <CardAction
              disabled={!canWrite}
              title={canWrite ? undefined : "You do not have permission to act on leads."}
              onClick={() => {
                const control = document.getElementById("lead-qualification-control");
                control?.scrollIntoView({ block: "center", behavior: "smooth" });
                (control as HTMLSelectElement | null)?.focus();
              }}
            >
              Update qualification
            </CardAction>
          }
        />

        <SummaryCard
          icon={<CalendarDays className="size-4 text-content-accent" />}
          title="Booking summary"
          headline={booking ? "Booked" : "No booking"}
          detail={
            booking?.starts_at
              ? formatDateTime(booking.starts_at)
              : booking
                ? booking.status
                : "Not yet booked"
          }
          action={
            <CardAction
              disabled={
                !canWrite ||
                !capabilities.booking ||
                lead.opted_out ||
                !lead.phone ||
                pending === "booking"
              }
              title={
                !canWrite
                  ? "You do not have permission to act on leads."
                  : !capabilities.booking
                    ? "No booking destination is configured. Connect a calendar first."
                    : lead.opted_out
                      ? "This lead opted out and cannot be messaged."
                      : !lead.phone
                        ? "This lead has no phone number."
                        : undefined
              }
              onClick={() =>
                run(
                  "booking",
                  () => actions.sendBookingLink({ leadId: lead.id }),
                  "Booking link sent.",
                )
              }
            >
              Send booking link
            </CardAction>
          }
        />
      </div>

      <LeadManualActions
        detail={detail}
        actions={actions}
        capabilities={capabilities}
        canWrite={canWrite}
        pending={pending}
        run={run}
        onOpenComposer={onOpenComposer}
      />

      {lead.notes && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
          <h3 className="text-[12px] font-semibold text-content-secondary">Notes</h3>
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-content-secondary">
            {lead.notes}
          </p>
        </section>
      )}
    </div>
  );
}
