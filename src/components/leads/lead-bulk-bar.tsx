"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Ban,
  ChevronDown,
  Download,
  Gauge,
  Megaphone,
  Play,
  Square,
  Tags,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  DropdownGroup,
  DropdownItem,
  DropdownMenu,
} from "@/components/ui/dropdown";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { FormField, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { LEAD_STATUS } from "@/components/ui/badge";
import { LEAD_STATUSES } from "@/lib/leads/filters";
import { closeReasonProblem, statusNeedsReason } from "@/lib/leads/detail-page";
import {
  bulkActionsFor,
  leadCount,
  MAX_BULK_LEADS,
  type BulkActionKind,
  type BulkSummary,
} from "@/lib/leads/bulk";
import {
  listBulkCampaignTargets,
  runLeadBulkAction,
  type BulkLeadInput,
} from "@/lib/leads/bulk-actions";
import type { WorkspaceMember } from "@/lib/leads/types";

const ICONS: Record<BulkActionKind, React.ComponentType<{ className?: string }>> = {
  assign: UserPlus,
  set_status: Tags,
  rescore: Gauge,
  add_to_campaign: Megaphone,
  start_follow_up: Play,
  stop_follow_up: Square,
  suppress: Ban,
  archive: Archive,
};

const DESCRIPTIONS: Partial<Record<BulkActionKind, string>> = {
  start_follow_up: "Hand back to automated follow-up",
  stop_follow_up: "Take over; automated messages stop",
  rescore: "Recalculate from what is known now",
  suppress: "Do-not-contact on every channel",
  archive: "Hide from lists and stop follow-up",
};

type Dialog = "assign" | "set_status" | "add_to_campaign" | "suppress" | "archive" | null;

/**
 * The Leads list's bulk action bar (tracker 8.12 — the owner's "actions needs
 * a drop down window").
 *
 * Appears once anything is selected, sticks to the bottom of the viewport so
 * it stays reachable while scrolling a long page, and gathers every action
 * into one grouped "Actions" menu instead of a row of buttons that wraps on a
 * phone. Each action runs through `runLeadBulkAction`, which runs the
 * registry operation per lead and reports what actually happened — "12
 * archived, 2 skipped: this lead opted out" — rather than what was asked for.
 * Leads that did not change stay selected so the person can see which ones.
 */
export function LeadBulkBar({
  selected,
  pageIds,
  members,
  role,
  onSelectedChange,
}: {
  selected: Set<string>;
  pageIds: string[];
  members: WorkspaceMember[];
  role: string;
  onSelectedChange: (next: Set<string>) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [lastResult, setLastResult] = React.useState<BulkSummary | null>(null);
  const exportRef = React.useRef<HTMLFormElement>(null);

  const ids = React.useMemo(() => Array.from(selected), [selected]);
  const actions = bulkActionsFor(role);
  const canExport = role === "owner" || role === "admin";
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  // Clearing the selection makes the last result's detail stale.
  const shownResult = selected.size === 0 ? null : lastResult;

  if (selected.size === 0) return null;

  function run(input: BulkLeadInput) {
    startTransition(async () => {
      const result = await runLeadBulkAction(input);
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      const { summary } = result;
      toast({
        variant: summary.failed > 0 ? "error" : summary.skipped > 0 ? "warning" : "success",
        title: summary.message,
      });
      setDialog(null);
      if (summary.unchangedIds.length > 0) {
        setLastResult(summary);
        onSelectedChange(new Set(summary.unchangedIds));
      } else {
        setLastResult(null);
        onSelectedChange(new Set());
      }
      router.refresh();
    });
  }

  function choose(kind: BulkActionKind) {
    switch (kind) {
      case "rescore":
      case "start_follow_up":
      case "stop_follow_up":
        run({ kind, leadIds: ids });
        return;
      default:
        setDialog(kind);
    }
  }

  const groups = ["Ownership", "Pipeline", "Follow-up", "Data"] as const;

  return (
    <>
      <div
        className={cn(
          "sticky bottom-3 z-30 mx-auto w-full max-w-3xl",
          "animate-[lr-slide-up_var(--lr-duration-base)_var(--lr-ease)]",
        )}
      >
        <div
          role="region"
          aria-label="Bulk actions"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface-raised px-3 py-2.5 shadow-xl sm:px-4",
          )}
        >
          <div className="flex min-w-0 items-center gap-2" aria-live="polite">
            <span className="grid h-6 min-w-6 place-items-center rounded-md bg-accent-100 px-1.5 text-[12px] font-semibold tabular-nums text-accent-800">
              {selected.size}
            </span>
            <span className="text-[13px] font-medium text-content">selected</span>
            {!allOnPage && pageIds.length > selected.size && (
              <button
                type="button"
                onClick={() =>
                  onSelectedChange(new Set(pageIds.slice(0, MAX_BULK_LEADS)))
                }
                className="text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Select all {pageIds.length} on this page
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu
              align="end"
              label="Bulk actions"
              trigger={
                <Button size="sm" variant="primary" loading={pending} disabled={pending}>
                  Actions
                  <ChevronDown className="size-3.5" aria-hidden />
                </Button>
              }
            >
              {groups.map((group) => {
                const items = actions.filter((a) => a.group === group);
                const exportHere = group === "Data" && canExport;
                if (items.length === 0 && !exportHere) return null;
                return (
                  <DropdownGroup key={group} label={group}>
                    {items.map((action) => (
                      <DropdownItem
                        key={action.kind}
                        icon={ICONS[action.kind]}
                        destructive={action.destructive}
                        description={DESCRIPTIONS[action.kind]}
                        onSelect={() => choose(action.kind)}
                      >
                        {action.label}
                      </DropdownItem>
                    ))}
                    {exportHere && (
                      <DropdownItem
                        icon={Download}
                        description="CSV of the selected leads"
                        onSelect={() => exportRef.current?.requestSubmit()}
                      >
                        Export
                      </DropdownItem>
                    )}
                  </DropdownGroup>
                );
              })}
            </DropdownMenu>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSelectedChange(new Set())}
              disabled={pending}
              aria-label="Clear selection"
            >
              <X className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          </div>

          {shownResult && shownResult.reasons.length > 0 && (
            <div className="w-full border-t border-line-subtle pt-2 text-[12px] text-content-muted">
              <p className="font-medium text-content-secondary">
                Still selected: the {leadCount(shownResult.unchangedIds.length)} that did not change.
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                {shownResult.reasons.map((r) => (
                  <li key={`${r.outcome}:${r.reason}`}>
                    <span className={r.outcome === "failed" ? "text-danger-600" : undefined}>
                      {r.count} {r.outcome}
                    </span>
                    : {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* A real form POST: the browser downloads the attachment without the
            page navigating, and the ids never land in a URL. */}
        <form ref={exportRef} method="post" action="/api/exports/leads" className="hidden">
          {ids.map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
        </form>
      </div>

      <AssignDialog
        open={dialog === "assign"}
        count={ids.length}
        members={members}
        pending={pending}
        onClose={() => setDialog(null)}
        onSubmit={(userId) => run({ kind: "assign", leadIds: ids, userId })}
      />
      <StatusDialog
        open={dialog === "set_status"}
        count={ids.length}
        pending={pending}
        onClose={() => setDialog(null)}
        onSubmit={(status, reason) =>
          run({ kind: "set_status", leadIds: ids, status, reason })
        }
      />
      {/* Mounted only while open, so each opening fetches fresh targets. */}
      {dialog === "add_to_campaign" && (
        <CampaignDialog
          open
          count={ids.length}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(campaignId) => run({ kind: "add_to_campaign", leadIds: ids, campaignId })}
        />
      )}
      <SuppressDialog
        open={dialog === "suppress"}
        count={ids.length}
        pending={pending}
        onClose={() => setDialog(null)}
        onSubmit={(reason, note) =>
          run({ kind: "suppress", leadIds: ids, reason, note, confirmed: true })
        }
      />
      <ConfirmDialog
        open={dialog === "archive"}
        onClose={() => setDialog(null)}
        onConfirm={() => run({ kind: "archive", leadIds: ids, confirmed: true })}
        loading={pending}
        variant="warning"
        title={`Archive ${leadCount(ids.length)}?`}
        scope={`${leadCount(ids.length)} will leave your lists.`}
        consequence="Follow-up for them stops. Their history is kept and an admin can restore them."
        confirmLabel={`Archive ${ids.length}`}
      />
    </>
  );
}

/* ---------------------------------------------------------------- dialogs */

function Footer({
  onClose,
  pending,
  label,
  disabled,
  form,
  variant = "primary",
}: {
  onClose: () => void;
  pending: boolean;
  label: string;
  disabled?: boolean;
  form: string;
  variant?: "primary" | "danger";
}) {
  return (
    <>
      <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
        Cancel
      </Button>
      <Button
        type="submit"
        form={form}
        variant={variant}
        size="sm"
        loading={pending}
        disabled={pending || disabled}
      >
        {label}
      </Button>
    </>
  );
}

function AssignDialog({
  open,
  count,
  members,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  count: number;
  members: WorkspaceMember[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (userId: string | null) => void;
}) {
  const [userId, setUserId] = React.useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign ${leadCount(count)}`}
      description="Each lead is assigned individually and recorded in its activity."
      size="sm"
      footer={<Footer form="bulk-assign" onClose={onClose} pending={pending} label="Assign" />}
    >
      <form
        id="bulk-assign"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(userId || null);
        }}
      >
        <FormField label="Assign to" htmlFor="bulk-assign-user">
          <Select
            id="bulk-assign-user"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </Select>
        </FormField>
      </form>
    </Modal>
  );
}

function StatusDialog({
  open,
  count,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (status: (typeof LEAD_STATUSES)[number], reason?: string) => void;
}) {
  const [status, setStatus] = React.useState<(typeof LEAD_STATUSES)[number]>("CONTACTED");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const needsReason = statusNeedsReason(status);
  const problem = needsReason ? closeReasonProblem(reason) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Change status of ${leadCount(count)}`}
      description="Leads already at this status are skipped and reported."
      size="sm"
      footer={
        <Footer
          form="bulk-status"
          onClose={onClose}
          pending={pending}
          label="Change status"
          disabled={!!problem && touched}
        />
      }
    >
      <form
        id="bulk-status"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (problem) return;
          onSubmit(status, needsReason ? reason.trim() : undefined);
        }}
      >
        <FormField label="New status" htmlFor="bulk-status-value">
          <Select
            id="bulk-status-value"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as (typeof LEAD_STATUSES)[number])
            }
          >
            {LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {LEAD_STATUS[value].label}
              </option>
            ))}
          </Select>
        </FormField>
        {needsReason && (
          <FormField
            label={status === "WON" ? "Why were these won?" : "Why were these lost?"}
            htmlFor="bulk-status-reason"
            required
            error={touched ? (problem ?? undefined) : undefined}
            hint="Recorded on each lead's opportunity."
          >
            <Textarea
              id="bulk-status-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
        )}
      </form>
    </Modal>
  );
}

function CampaignDialog({
  open,
  count,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (campaignId: string) => void;
}) {
  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready"; campaigns: { id: string; name: string; status: string }[] }
  >({ status: "loading" });
  const [campaignId, setCampaignId] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listBulkCampaignTargets()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) setState({ status: "error", error: result.error });
        else {
          setState({ status: "ready", campaigns: result.campaigns });
          setCampaignId(result.campaigns[0]?.id ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", error: "Campaigns could not be loaded." });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const empty = state.status === "ready" && state.campaigns.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${leadCount(count)} to a reactivation campaign`}
      description="Adding does not send anything. Messages go out only when the campaign is launched or resumed, and suppression is re-checked before each one."
      size="sm"
      footer={
        <Footer
          form="bulk-campaign"
          onClose={onClose}
          pending={pending}
          label="Add to campaign"
          disabled={state.status !== "ready" || empty || !campaignId}
        />
      }
    >
      <form
        id="bulk-campaign"
        onSubmit={(event) => {
          event.preventDefault();
          if (campaignId) onSubmit(campaignId);
        }}
      >
        {state.status === "loading" && (
          <p className="text-[13px] text-content-muted" role="status">
            Loading campaigns…
          </p>
        )}
        {state.status === "error" && (
          <p className="text-[13px] text-danger-600" role="alert">
            {state.error}
          </p>
        )}
        {empty && (
          <p className="text-[13px] text-content-muted">
            There is no draft, scheduled or paused campaign to add to. Create one in
            Reactivation first.
          </p>
        )}
        {state.status === "ready" && !empty && (
          <FormField
            label="Campaign"
            htmlFor="bulk-campaign-id"
            hint="Leads without a mobile number, opted out or archived are skipped."
          >
            <Select
              id="bulk-campaign-id"
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
            >
              {state.campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {`${campaign.name} (${campaign.status.toLowerCase()})`}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </form>
    </Modal>
  );
}

function SuppressDialog({
  open,
  count,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: "MANUAL" | "OPT_OUT" | "LEGAL", note?: string) => void;
}) {
  const [reason, setReason] = React.useState<"MANUAL" | "OPT_OUT" | "LEGAL">("MANUAL");
  const [note, setNote] = React.useState("");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Suppress ${leadCount(count)}?`}
      description="Every address held for these leads goes on the do-not-contact list and follow-up stops."
      size="sm"
      footer={
        <Footer
          form="bulk-suppress"
          onClose={onClose}
          pending={pending}
          label={`Suppress ${count}`}
          variant="danger"
        />
      }
    >
      <form
        id="bulk-suppress"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(reason, note.trim() || undefined);
        }}
      >
        <FormField label="Reason" htmlFor="bulk-suppress-reason">
          <Select
            id="bulk-suppress-reason"
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as "MANUAL" | "OPT_OUT" | "LEGAL")
            }
          >
            <option value="MANUAL">Our decision</option>
            <option value="OPT_OUT">They asked not to be contacted</option>
            <option value="LEGAL">Restriction of processing (legal)</option>
          </Select>
        </FormField>
        <FormField label="Note (optional)" htmlFor="bulk-suppress-note">
          <Textarea
            id="bulk-suppress-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything a colleague would need to know later."
          />
        </FormField>
        <p className="text-[12px] text-content-muted">
          This cannot be lifted from the product: only ClientTurn support can remove a
          do-not-contact entry. The leads and their history are kept.
        </p>
      </form>
    </Modal>
  );
}
