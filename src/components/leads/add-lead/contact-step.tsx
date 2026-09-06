"use client";

import * as React from "react";
import {
  AlertTriangle,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  Smartphone,
  User,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import {
  duplicateConfidenceLabel,
  isBlockingDuplicate,
  type ContactState,
  type DuplicateMatch,
  type FieldErrors,
} from "@/lib/leads/add-lead/types";
import {
  CharCount,
  GuidanceList,
  RailCard,
  RailNote,
  SectionCard,
  StepHeading,
} from "./pieces";

export type DuplicateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "clear" }
  | { state: "found"; matches: DuplicateMatch[] }
  | { state: "error"; message: string };

const WHAT_HAPPENS = [
  {
    title: "Contact",
    detail: "Add the lead's identity and contact details.",
  },
  {
    title: "Enquiry",
    detail: "Tell us about their enquiry and requirements.",
  },
  {
    title: "Permission & contactability",
    detail: "Confirm we have permission to contact them.",
  },
  {
    title: "Route & Start",
    detail:
      "We'll check for duplicates, then create and route the lead into your follow-up or qualification flow.",
  },
];

/** The banner across the top of Step 1. Reflects the live check, never a guess. */
function DuplicateCheckBanner({
  status,
  onOpenExisting,
  onAcknowledge,
  acknowledged,
}: {
  status: DuplicateStatus;
  onOpenExisting: (match: DuplicateMatch) => void;
  onAcknowledge: () => void;
  acknowledged: boolean;
}) {
  const found = status.state === "found" ? status.matches : [];
  const blocking = found.filter(isBlockingDuplicate);
  const tone =
    blocking.length > 0 ? "danger" : found.length > 0 ? "warning" : "neutral";

  return (
    <div
      className={cn(
        "rounded-xl border shadow-xs",
        tone === "danger"
          ? "border-danger-100 bg-danger-50/60"
          : tone === "warning"
            ? "border-warning-100 bg-warning-50/60"
            : "border-line bg-surface",
      )}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              tone === "danger"
                ? "bg-danger-100 text-danger-600"
                : tone === "warning"
                  ? "bg-warning-100 text-warning-700"
                  : "bg-info-50 text-info-700",
            )}
          >
            {tone === "neutral" ? (
              <Search className="size-[17px]" />
            ) : (
              <AlertTriangle className="size-[17px]" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-content">
              Automatic duplicate check
            </p>
            <p className="mt-0.5 text-[12.5px] leading-[1.45] text-content-muted">
              ClientTurn searches existing leads and prospects by normalized
              email, phone, and company to help prevent duplicates.
            </p>
          </div>
        </div>

        <div
          aria-live="polite"
          className="flex shrink-0 items-center gap-2.5 border-line-subtle sm:border-l sm:pl-4"
        >
          {status.state === "checking" ? (
            <>
              <Loader2 className="size-4 animate-spin text-content-subtle" aria-hidden />
              <div>
                <p className="text-[13px] font-semibold text-content">Checking…</p>
                <p className="text-[11.5px] text-content-muted">
                  Searching your workspace.
                </p>
              </div>
            </>
          ) : status.state === "found" ? (
            <div>
              <p
                className={cn(
                  "text-[13px] font-semibold",
                  blocking.length > 0 ? "text-danger-700" : "text-warning-700",
                )}
              >
                {blocking.length > 0
                  ? `${blocking.length} duplicate${blocking.length === 1 ? "" : "s"} found`
                  : `${found.length} possible match${found.length === 1 ? "" : "es"}`}
              </p>
              <p className="text-[11.5px] text-content-muted">
                Review the records below.
              </p>
            </div>
          ) : status.state === "error" ? (
            <div>
              <p className="text-[13px] font-semibold text-warning-700">
                Check unavailable
              </p>
              <p className="text-[11.5px] text-content-muted">
                We&apos;ll try again when you create the lead.
              </p>
            </div>
          ) : (
            <>
              <span
                aria-hidden
                className={cn(
                  "size-4 rounded-full border-2",
                  status.state === "clear"
                    ? "border-success-500 bg-success-500"
                    : "border-info-500",
                )}
              />
              <div>
                <p className="text-[13px] font-semibold text-content">
                  No duplicate found yet
                </p>
                <p className="text-[11.5px] text-content-muted">
                  We&apos;ll check as you type.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {found.length > 0 && (
        <ul className="space-y-2 border-t border-line-subtle p-3">
          {found.map((match) => (
            <li
              key={`${match.kind}-${match.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-surface px-3 py-2"
            >
              <span className="text-[13px] font-semibold text-content">
                {match.name}
              </span>
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-content-secondary">
                {match.kind === "LEAD" ? "Lead" : "Prospect"}
              </span>
              <span className="text-[11.5px] text-content-muted">
                {duplicateConfidenceLabel(match.confidence)}
                {match.emailMasked ? ` · ${match.emailMasked}` : ""}
                {match.phoneMasked ? ` · ${match.phoneMasked}` : ""}
              </span>
              {match.kind === "LEAD" && (
                <Button
                  variant="link"
                  className="ml-auto text-[12px]"
                  onClick={() => onOpenExisting(match)}
                >
                  Open existing record
                </Button>
              )}
            </li>
          ))}

          {blocking.length > 0 ? (
            <li className="px-3 pb-1 pt-0.5 text-[12px] text-danger-700">
              An exact email or phone match is the same person. Open the existing
              record instead of creating a second one.
            </li>
          ) : (
            <li className="flex items-center justify-between gap-3 px-3 pb-1 pt-0.5">
              <span className="text-[12px] text-content-muted">
                These are softer matches. You can continue if this is a different
                person.
              </span>
              <Button
                size="xs"
                variant="secondary"
                onClick={onAcknowledge}
                disabled={acknowledged}
              >
                {acknowledged ? "Continuing anyway" : "Continue anyway"}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function ContactStep({
  value,
  errors,
  duplicate,
  acknowledged,
  onChange,
  onAcknowledge,
  onOpenExisting,
}: {
  value: ContactState;
  errors: FieldErrors;
  duplicate: DuplicateStatus;
  acknowledged: boolean;
  onChange: (patch: Partial<ContactState>) => void;
  onAcknowledge: () => void;
  onOpenExisting: (match: DuplicateMatch) => void;
}) {
  const id = React.useId();
  const field = (name: string) => `${id}-${name}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_268px]">
      <div className="min-w-0 space-y-4">
        <StepHeading
          step={1}
          title="Contact"
          description="Enter the lead's identity and contact details before creating the record."
        />

        <DuplicateCheckBanner
          status={duplicate}
          acknowledged={acknowledged}
          onAcknowledge={onAcknowledge}
          onOpenExisting={onOpenExisting}
        />

        <SectionCard
          icon={User}
          tone="neutral"
          title="Lead identity"
          description="Tell us who this lead is."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField
              label="First name"
              required
              htmlFor={field("first")}
              error={errors.firstName}
            >
              <Input
                id={field("first")}
                value={value.firstName}
                autoComplete="given-name"
                aria-invalid={Boolean(errors.firstName)}
                onChange={(event) => onChange({ firstName: event.target.value })}
              />
            </FormField>
            <FormField
              label="Last name"
              required
              htmlFor={field("last")}
              error={errors.lastName}
            >
              <Input
                id={field("last")}
                value={value.lastName}
                autoComplete="family-name"
                aria-invalid={Boolean(errors.lastName)}
                onChange={(event) => onChange({ lastName: event.target.value })}
              />
            </FormField>
            <FormField
              label="Company / business"
              required
              htmlFor={field("company")}
              error={errors.company}
            >
              <Input
                id={field("company")}
                value={value.company}
                autoComplete="organization"
                aria-invalid={Boolean(errors.company)}
                onChange={(event) => onChange({ company: event.target.value })}
              />
            </FormField>
          </div>
        </SectionCard>

        <SectionCard
          icon={Phone}
          tone="neutral"
          title="Contact details"
          description="Add at least one way to contact them."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField
              label="Email"
              htmlFor={field("email")}
              error={errors.email}
            >
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
                  aria-hidden
                />
                <Input
                  id={field("email")}
                  type="email"
                  inputMode="email"
                  className="pl-8"
                  value={value.email}
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  onChange={(event) => onChange({ email: event.target.value })}
                />
              </div>
            </FormField>
            <FormField
              label="Mobile"
              hint="Used for SMS and WhatsApp."
              htmlFor={field("mobile")}
              error={errors.mobile}
            >
              <div className="relative">
                <Smartphone
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
                  aria-hidden
                />
                <Input
                  id={field("mobile")}
                  type="tel"
                  inputMode="tel"
                  className="pl-8"
                  value={value.mobile}
                  autoComplete="tel"
                  aria-invalid={Boolean(errors.mobile)}
                  onChange={(event) => onChange({ mobile: event.target.value })}
                />
              </div>
            </FormField>
            <FormField
              label="Telephone"
              htmlFor={field("tel")}
              error={errors.telephone}
            >
              <div className="relative">
                <Phone
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
                  aria-hidden
                />
                <Input
                  id={field("tel")}
                  type="tel"
                  inputMode="tel"
                  className="pl-8"
                  value={value.telephone}
                  aria-invalid={Boolean(errors.telephone)}
                  onChange={(event) => onChange({ telephone: event.target.value })}
                />
              </div>
            </FormField>
          </div>
        </SectionCard>

        <SectionCard
          icon={MapPin}
          tone="neutral"
          title="Address"
          description="Add the property or business location (optional)."
        >
          <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
            <FormField
              label="Postcode"
              required
              htmlFor={field("postcode")}
              error={errors.postcode}
            >
              <Input
                id={field("postcode")}
                value={value.postcode}
                autoComplete="postal-code"
                aria-invalid={Boolean(errors.postcode)}
                onChange={(event) => onChange({ postcode: event.target.value })}
              />
            </FormField>
            <FormField label="Address (optional)" htmlFor={field("address")}>
              <Input
                id={field("address")}
                value={value.address}
                placeholder="Start typing an address..."
                autoComplete="street-address"
                onChange={(event) => onChange({ address: event.target.value })}
              />
              <CharCount value={value.address} max={300} />
            </FormField>
          </div>
        </SectionCard>
      </div>

      <aside className="min-w-0 space-y-3">
        <RailCard icon={FileText} title="What happens next?">
          <p className="mb-3 text-[12px] leading-[1.5] text-content-muted">
            After you complete all 4 steps, ClientTurn will create the lead and
            route it based on your workspace settings.
          </p>
          <GuidanceList items={WHAT_HAPPENS} activeIndex={0} />
        </RailCard>

        <RailNote icon={ShieldCheck} tone="success" title="Built-in data protection">
          We automatically check for duplicates and help you maintain clean,
          high-quality lead data.
        </RailNote>
      </aside>
    </div>
  );
}
