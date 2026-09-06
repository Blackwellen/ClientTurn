"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { Overlay, useBodyScrollLock, useFocusTrap } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import {
  checkContactability,
  checkLeadDuplicates,
  createManualLead,
  createProspectFromWizard,
} from "@/lib/leads/add-lead/actions";
import type { AddLeadContext, WizardService } from "@/lib/leads/add-lead/queries";
import {
  followUpEligibility,
  initialAddLeadState,
  isDirty,
  validateContactStep,
  validateEnquiryStep,
  validatePermissionStep,
  validateRouteStep,
  type AddLeadState,
  type ContactabilityAssessment,
  type ContactState,
  type DuplicateMatch,
  type EnquiryState,
  type FieldErrors,
  type PermissionState,
  type RoutingState,
} from "@/lib/leads/add-lead/types";
import { ADD_LEAD_STEPS, WizardProgress } from "./wizard-progress";
import { ContactStep, type DuplicateStatus } from "./contact-step";
import { EnquiryStep } from "./enquiry-step";
import { PermissionStep } from "./permission-step";
import { RouteStartStep } from "./route-step";

/**
 * `AddLeadWizard` — the modal opened by "+ Add lead" on /app/leads.
 *
 * Exactly four steps, one state object across all of them, and no partial
 * record written until Step 4 is submitted. Everything the wizard shows about
 * duplicates, contactability and follow-up eligibility is a *preview* of a
 * decision the server makes again inside `createManualLead`.
 *
 * The Leads page behind it keeps its list, filters and scroll position: the
 * wizard never navigates, it only opens the created lead's drawer on success.
 */

const CONTINUE_LABELS = [
  "Continue to Enquiry",
  "Continue to Permission",
  "Continue to Route & Start",
  "Create lead",
];

const DUPLICATE_DEBOUNCE_MS = 500;

export function AddLeadWizard({
  context,
  onClose,
  onCreated,
  onOpenLead,
}: {
  context: AddLeadContext;
  onClose: () => void;
  onCreated: (leadId: string) => void;
  onOpenLead: (leadId: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  const [step, setStep] = React.useState(0);
  const [furthest, setFurthest] = React.useState(0);
  const [state, setState] = React.useState<AddLeadState>(initialAddLeadState);
  const [createdServices, setCreatedServices] = React.useState<WizardService[]>([]);
  const [showErrors, setShowErrors] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  const [acknowledged, setAcknowledged] = React.useState(false);
  const [prospectBusy, setProspectBusy] = React.useState(false);

  // Both async checks store their answer next to the input key it answers, so
  // "still checking" is derived by comparing keys rather than being a second
  // piece of state that can fall out of step with the request in flight.
  const [dupResolved, setDupResolved] = React.useState<{
    key: string;
    matches: DuplicateMatch[] | null;
    error: string | null;
  } | null>(null);
  const [assessResolved, setAssessResolved] = React.useState<{
    key: string;
    assessment: ContactabilityAssessment | null;
    error: string | null;
  } | null>(null);

  useBodyScrollLock(true);
  useFocusTrap(panelRef, true);

  const services = React.useMemo(() => {
    const known = new Set(context.services.map((service) => service.id));
    return [
      ...context.services,
      ...createdServices.filter((service) => !known.has(service.id)),
    ];
  }, [context.services, createdServices]);

  /* ------------------------------------------------------------- patching */

  const patch = React.useCallback(
    <K extends keyof AddLeadState>(key: K, value: Partial<AddLeadState[K]>) => {
      setState((current) => ({
        ...current,
        [key]: { ...current[key], ...value },
      }));
    },
    [],
  );

  const setContact = React.useCallback(
    (value: Partial<ContactState>) => {
      setAcknowledged(false);
      patch("contact", value);
    },
    [patch],
  );
  const setEnquiry = React.useCallback(
    (value: Partial<EnquiryState>) => patch("enquiry", value),
    [patch],
  );
  const setPermission = React.useCallback(
    (value: Partial<PermissionState>) => patch("permission", value),
    [patch],
  );
  const setRouting = React.useCallback(
    (value: Partial<RoutingState>) => patch("routing", value),
    [patch],
  );

  /* -------------------------------------------------- live duplicate check */

  const dupKey = [
    state.contact.email.trim().toLowerCase(),
    state.contact.mobile.trim(),
    state.contact.telephone.trim(),
    state.contact.company.trim().toLowerCase(),
    state.contact.firstName.trim().toLowerCase(),
    state.contact.lastName.trim().toLowerCase(),
  ].join("|");

  const dupHasInput = Boolean(
    state.contact.email.trim() ||
      state.contact.mobile.trim() ||
      state.contact.telephone.trim() ||
      state.contact.company.trim(),
  );

  React.useEffect(() => {
    if (!dupHasInput) return;

    let cancelled = false;
    // Debounced: the check is a server round trip, not a keystroke handler.
    const timer = setTimeout(async () => {
      const result = await checkLeadDuplicates({
        email: state.contact.email,
        mobile: state.contact.mobile,
        telephone: state.contact.telephone,
        company: state.contact.company,
        firstName: state.contact.firstName,
        lastName: state.contact.lastName,
      });
      if (cancelled) return;
      setDupResolved(
        result.ok
          ? { key: dupKey, matches: result.matches, error: null }
          : { key: dupKey, matches: null, error: result.error },
      );
    }, DUPLICATE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, dupHasInput]);

  const duplicate: DuplicateStatus = !dupHasInput
    ? { state: "idle" }
    : !dupResolved || dupResolved.key !== dupKey
      ? { state: "checking" }
      : dupResolved.error
        ? { state: "error", message: dupResolved.error }
        : dupResolved.matches && dupResolved.matches.length > 0
          ? { state: "found", matches: dupResolved.matches }
          : { state: "clear" };

  const duplicates = duplicate.state === "found" ? duplicate.matches : [];
  const duplicateChecked =
    duplicate.state === "clear" || duplicate.state === "found";

  /* ------------------------------------------------ contactability preview */

  const assessKey = [
    state.permission.relationship,
    state.permission.evidence.trim(),
    state.contact.email.trim().toLowerCase(),
    state.contact.mobile.trim(),
    state.contact.telephone.trim(),
  ].join("|");

  React.useEffect(() => {
    if (step !== 2 || !state.permission.relationship) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await checkContactability({
        email: state.contact.email,
        mobile: state.contact.mobile,
        telephone: state.contact.telephone,
        postcode: state.contact.postcode,
        relationship: state.permission.relationship,
        evidence: state.permission.evidence,
      });
      if (cancelled) return;
      setAssessResolved(
        result.ok
          ? { key: assessKey, assessment: result.assessment, error: null }
          : { key: assessKey, assessment: null, error: result.error },
      );
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessKey, step]);

  const assessCurrent =
    state.permission.relationship && assessResolved?.key === assessKey
      ? assessResolved
      : null;
  const assessment = assessCurrent?.assessment ?? null;
  const assessError = assessCurrent?.error ?? null;
  const assessing = Boolean(state.permission.relationship) && !assessCurrent;

  /* ------------------------------------------------------------ validation */

  const errors: FieldErrors = React.useMemo(() => {
    if (step === 0) return validateContactStep(state.contact);
    if (step === 1) return validateEnquiryStep(state.enquiry);
    if (step === 2) return validatePermissionStep(state.permission, assessment);
    return validateRouteStep(state.routing);
  }, [step, state, assessment]);

  const blockingDuplicate = duplicates.some(
    (match) =>
      match.confidence === "EXACT_EMAIL" || match.confidence === "EXACT_PHONE",
  );
  const softDuplicateBlocked =
    duplicates.length > 0 && !blockingDuplicate && !acknowledged;

  const stepBlocked =
    Object.keys(errors).length > 0 ||
    (step === 0 && (blockingDuplicate || softDuplicateBlocked)) ||
    (step === 2 && (assessing || !assessment));

  const followUp = followUpEligibility(assessment, context.followUp);

  /* ------------------------------------------------------------ navigation */

  function goTo(next: number) {
    setStep(next);
    setShowErrors(false);
    setSubmitError(null);
    bodyRef.current?.scrollTo({ top: 0 });
    // Announced by the heading itself; focus moves to the panel so the next
    // Tab lands inside the new step rather than back at the top of the page.
    panelRef.current?.focus();
  }

  function advance() {
    if (stepBlocked) {
      setShowErrors(true);
      return;
    }
    if (step === ADD_LEAD_STEPS.length - 1) {
      void submit();
      return;
    }
    setFurthest((current) => Math.max(current, step + 1));
    goTo(step + 1);
  }

  function requestClose() {
    if (submitting) return;
    if (isDirty(state)) {
      setConfirmCancel(true);
      return;
    }
    onClose();
  }

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, submitting]);

  /* ---------------------------------------------------------------- submit */

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);

    const result = await createManualLead({
      contact: state.contact,
      enquiry: {
        ...state.enquiry,
        conversionGoal: state.enquiry.conversionGoal || undefined,
      },
      permission: state.permission,
      routing: state.routing,
      acknowledgedDuplicates: acknowledged,
    });

    setSubmitting(false);

    if (result.status === "CREATED") {
      toast({
        variant: result.warning ? "warning" : "success",
        title: "Lead created",
        description:
          result.warning ??
          (result.followUpStarted
            ? "Follow-up has been queued."
            : "No follow-up was started for this lead."),
      });
      onCreated(result.leadId);
      onOpenLead(result.leadId);
      return;
    }

    if (result.status === "DUPLICATE") {
      setDupResolved({ key: dupKey, matches: result.matches, error: null });
      setAcknowledged(false);
      setSubmitError(
        "We found an existing record for this contact. Review it in Step 1.",
      );
      goTo(0);
      return;
    }

    if (result.status === "PROSPECT_REQUIRED") {
      setSubmitError(result.message);
      goTo(2);
      return;
    }

    setSubmitError(result.error);
  }

  async function prospectHandoff() {
    setProspectBusy(true);
    const result = await createProspectFromWizard({
      firstName: state.contact.firstName,
      lastName: state.contact.lastName,
      company: state.contact.company,
      email: state.contact.email,
      mobile: state.contact.mobile,
      telephone: state.contact.telephone,
      enquirySummary: state.enquiry.enquiryText,
      sourceDetail: state.enquiry.sourceDetail,
    });
    setProspectBusy(false);

    if (result.status === "ERROR") {
      toast({ variant: "error", title: "Could not add prospect", description: result.error });
      return;
    }

    toast({
      variant: "success",
      title: "Added to Find Leads",
      description:
        "This person was saved as a Prospect. Cold-outreach policy applies before any message.",
    });
    onClose();
    router.push("/app/find-leads");
  }

  const shownErrors = showErrors ? errors : {};

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
        <Overlay onClick={requestClose} />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn(
            "relative flex w-full flex-col bg-surface outline-none",
            "rounded-t-2xl border border-line shadow-xl sm:rounded-2xl",
            "h-[96dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-[980px]",
            "animate-[lr-slide-up_var(--lr-duration-base)_var(--lr-ease)]",
          )}
        >
          <header className="shrink-0 px-5 pb-3 pt-5 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-content"
                >
                  Add Lead
                </h2>
                <p className="mt-1 text-[13px] text-content-muted">
                  Manually add a vetted warm lead and route them into ClientTurn.
                </p>
              </div>
              <IconButton
                size="sm"
                label="Close Add Lead"
                onClick={requestClose}
                disabled={submitting}
              >
                <X className="size-[18px]" />
              </IconButton>
            </div>

            <div className="mt-4">
              <WizardProgress current={step} furthest={furthest} onSelect={goTo} />
            </div>
          </header>

          <div
            ref={bodyRef}
            className="min-h-0 flex-1 overflow-y-auto border-t border-line-subtle bg-surface-sunken/25 px-5 py-5 sm:px-6"
          >
            {step === 0 && (
              <ContactStep
                value={state.contact}
                errors={shownErrors}
                duplicate={duplicate}
                acknowledged={acknowledged}
                onChange={setContact}
                onAcknowledge={() => setAcknowledged(true)}
                onOpenExisting={(match) => {
                  onOpenLead(match.id);
                  onClose();
                }}
              />
            )}

            {step === 1 && (
              <EnquiryStep
                value={state.enquiry}
                errors={shownErrors}
                services={services}
                canManageServices={context.permissions.canManageServices}
                currencySymbol={context.currencySymbol}
                onChange={setEnquiry}
                onServiceCreated={(service: WizardService) => {
                  setCreatedServices((current) => [...current, service]);
                  setEnquiry({ serviceId: service.id });
                }}
              />
            )}

            {step === 2 && (
              <PermissionStep
                value={state.permission}
                errors={shownErrors}
                assessment={assessment}
                assessing={assessing}
                assessError={assessError}
                prospectBusy={prospectBusy}
                onChange={setPermission}
                onProspectHandoff={prospectHandoff}
              />
            )}

            {step === 3 && (
              <RouteStartStep
                state={state}
                errors={shownErrors}
                assessment={assessment}
                duplicates={duplicates}
                duplicateChecked={duplicateChecked}
                members={context.members}
                services={services}
                serviceFlows={context.serviceFlows}
                followUp={followUp}
                canAssignOthers={context.permissions.canAssignOthers}
                onChange={setRouting}
                onEditStep={goTo}
              />
            )}
          </div>

          <footer className="shrink-0 border-t border-line-subtle bg-surface px-5 py-3.5 sm:rounded-b-2xl sm:px-6">
            {submitError && (
              <p
                role="alert"
                className="mb-2.5 rounded-lg border border-danger-100 bg-danger-50/60 px-3 py-2 text-[12.5px] text-danger-700"
              >
                {submitError}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                onClick={requestClose}
                disabled={submitting}
              >
                Cancel
              </Button>

              <div className="flex items-center gap-2.5">
                <Button
                  variant="secondary"
                  disabled={step === 0 || submitting}
                  onClick={() => goTo(step - 1)}
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  Back
                </Button>
                <Button
                  onClick={advance}
                  loading={submitting}
                  aria-disabled={stepBlocked}
                  className={cn(stepBlocked && "opacity-60")}
                >
                  {CONTINUE_LABELS[step]}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          </footer>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          onClose();
        }}
        title="Discard this lead setup?"
        scope="The details you have entered will not be saved."
        consequence="No lead has been created yet, so nothing is left behind."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="warning"
      />
    </>
  );
}
