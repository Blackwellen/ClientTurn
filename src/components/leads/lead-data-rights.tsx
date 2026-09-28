"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { CONFIRMATION, type DataRightsMode } from "@/lib/data-rights/wording";
import type { LeadDrawerActions } from "./lead-drawer-actions";

/**
 * Suppress / Restrict / Export / Anonymise / Erase, from the lead drawer.
 *
 * Every dialog's text comes from `lib/data-rights/wording.ts`, the same module
 * the tests hold to "never say deleted when something remains", and each
 * outcome is shown with what changed *and* what was kept.
 */

type Outcome = { headline: string; changed: string[]; kept: string[] };
type CrmReport = { provider: string; outcome: string; detail: string };

const CHANNELS = [
  { value: "ALL", label: "Every channel" },
  { value: "EMAIL", label: "Email only" },
  { value: "SMS", label: "SMS only" },
  { value: "WHATSAPP", label: "WhatsApp only" },
  { value: "SOCIAL", label: "Social messages only" },
] as const;

export function LeadDataRightsDialogs({
  leadId,
  mode,
  onClose,
  onErased,
  actions,
}: {
  leadId: string;
  mode: DataRightsMode | null;
  onClose: () => void;
  /** Called once an erased lead's outcome has been read; the lead is gone. */
  onErased: () => void;
  actions: NonNullable<LeadDrawerActions["dataRights"]>;
}) {
  const router = useRouter();
  const [result, setResult] = React.useState<ErasureOutcome | null>(null);

  function dismiss() {
    const erased = result?.mode === "DELETE";
    setResult(null);
    if (erased) {
      onErased();
      router.refresh();
    }
  }

  return (
    <>
      {/* Keyed by mode so every opening starts from fresh choices. */}
      {mode && (
        <DataRightsConfirm
          key={mode}
          leadId={leadId}
          mode={mode}
          onClose={onClose}
          onErasure={setResult}
          actions={actions}
        />
      )}

      {result && (
        <Modal
          open
          size="md"
          title={result.mode === "DELETE" ? "Lead erased" : "Lead anonymised"}
          description={result.outcome.headline}
          onClose={dismiss}
          footer={
            <Button size="sm" onClick={dismiss}>
              Done
            </Button>
          }
        >
          <div className="space-y-4">
            <OutcomeList title="What changed" items={result.outcome.changed} empty="Nothing was left to change." />
            <OutcomeList title="What was kept" items={result.outcome.kept} />
            {result.crm.length > 0 && (
              <OutcomeList
                title="Connected CRM"
                items={result.crm.map((report) => report.detail)}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

type ErasureOutcome = {
  mode: "ANONYMISE" | "DELETE";
  outcome: Outcome;
  crm: CrmReport[];
};

function DataRightsConfirm({
  leadId,
  mode,
  onClose,
  onErasure,
  actions,
}: {
  leadId: string;
  mode: DataRightsMode;
  onClose: () => void;
  onErasure: (result: ErasureOutcome) => void;
  actions: NonNullable<LeadDrawerActions["dataRights"]>;
}) {
  const { toast } = useToast();
  const [channel, setChannel] = React.useState<string>("ALL");
  const [reason, setReason] = React.useState<"MANUAL" | "OPT_OUT">("MANUAL");
  const [crmSystems, setCrmSystems] = React.useState<string[]>([]);
  const [alsoCrm, setAlsoCrm] = React.useState(false);

  // Which CRMs the person was pushed to, so the dialog can offer to remove
  // them there too.
  React.useEffect(() => {
    if (mode !== "ANONYMISE" && mode !== "DELETE") return;
    let live = true;
    actions.crmSystems({ leadId }).then((systems) => {
      if (live) setCrmSystems(systems);
    });
    return () => {
      live = false;
    };
  }, [mode, leadId, actions]);

  async function confirm() {
    if (mode === "SUPPRESS" || mode === "RESTRICT") {
      const outcome = await actions.suppress({
        leadId,
        channel: mode === "RESTRICT" ? "ALL" : channel,
        reason: mode === "RESTRICT" ? "LEGAL" : reason,
      });
      if (outcome.ok) {
        toast({ variant: "success", title: outcome.message });
        onClose();
      } else toast({ variant: "error", title: outcome.error });
      return;
    }

    if (mode === "EXPORT") {
      const outcome = await actions.exportData({ leadId });
      if (!outcome.ok || !outcome.data) {
        toast({ variant: "error", title: outcome.ok ? "The export was empty." : outcome.error });
        return;
      }
      const blob = new Blob([outcome.data.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = outcome.data.filename;
      link.click();
      URL.revokeObjectURL(url);
      toast({ variant: "success", title: "Export downloaded. It contains personal data. Store it securely." });
      onClose();
      return;
    }

    const run = mode === "DELETE" ? actions.erase : actions.anonymise;
    const outcome = await run({ leadId, alsoRemoveFromCrm: alsoCrm });
    if (!outcome.ok || !outcome.data) {
      toast({ variant: "error", title: outcome.ok ? "That did not complete." : outcome.error });
      return;
    }
    onErasure({ mode, outcome: outcome.data.outcome, crm: outcome.data.crm });
    onClose();
  }

  const copy = CONFIRMATION[mode];

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={confirm}
      title={copy.title}
      scope={copy.scope}
      consequence={copy.consequence}
      confirmLabel={copy.confirmLabel}
      variant={copy.variant}
    >
      {mode === "SUPPRESS" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Channel" htmlFor="suppress-channel">
            <Select
              id="suppress-channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
            >
              {CHANNELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Reason" htmlFor="suppress-reason">
            <Select
              id="suppress-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as "MANUAL" | "OPT_OUT")}
            >
              <option value="MANUAL">Our decision</option>
              <option value="OPT_OUT">The person asked us to stop</option>
            </Select>
          </FormField>
        </div>
      )}

      {(mode === "ANONYMISE" || mode === "DELETE") && crmSystems.length > 0 && (
        <label className="flex items-start gap-2 text-[13px] text-content">
          <Checkbox
            checked={alsoCrm}
            onChange={(event) => setAlsoCrm(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            Also remove this person from {crmSystems.join(" and ")}.{" "}
            <span className="text-content-muted">
              Each system reports back what it did; a recycle bin is reported as such.
            </span>
          </span>
        </label>
      )}
    </ConfirmDialog>
  );
}

function OutcomeList({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty?: string;
}) {
  return (
    <section>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-content-subtle">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-content-muted">{empty ?? "—"}</p>
      ) : (
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] text-content-secondary">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
