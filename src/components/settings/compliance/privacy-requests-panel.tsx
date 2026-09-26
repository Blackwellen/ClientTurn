"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  createPrivacyRequestAction,
  updatePrivacyRequestAction,
} from "@/lib/data-rights/actions";
import {
  daysUntil,
  PRIVACY_REQUEST_TYPE_COPY,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestKind,
  type WorkspacePrivacyRequest,
} from "@/lib/data-rights/types";

/**
 * Settings -> Data controls -> Privacy requests.
 *
 * The two clocks are the point of this list: acknowledge within 30 days
 * (DUAA complaint duty) and respond within one month (Art 12(3)). Each row
 * says how long is left on whichever clock is still running, in amber when it
 * is close and red when it has passed.
 */

const TYPE_LABEL: Record<string, string> = {
  ACCESS: "Access",
  ERASURE: "Erasure",
  RECTIFICATION: "Rectification",
  RESTRICTION: "Restriction",
  OBJECTION: "Objection",
  COMPLAINT: "Complaint",
  CONTEST_DECISION: "Contest a decision",
  EXPORT: "Data export",
  DELETION: "Deletion",
  MARKETING_DATA: "Marketing data",
};

const STATUS: Record<string, { label: string; tone: "warning" | "info" | "success" | "neutral" }> = {
  PENDING: { label: "Open", tone: "warning" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  REJECTED: { label: "Refused", tone: "neutral" },
};

function clock(label: string, iso: string | null): { text: string; tone: "danger" | "warning" | "neutral" } | null {
  const days = daysUntil(iso);
  if (days === null) return null;
  if (days < 0) return { text: `${label} overdue by ${-days} day${days === -1 ? "" : "s"}`, tone: "danger" };
  if (days <= 7) return { text: `${label} in ${days} day${days === 1 ? "" : "s"}`, tone: "warning" };
  return { text: `${label} by ${new Date(iso!).toLocaleDateString("en-GB")}`, tone: "neutral" };
}

export function PrivacyRequestsPanel({
  requests,
  canManage,
  loadError,
}: {
  requests: WorkspacePrivacyRequest[];
  canManage: boolean;
  loadError: boolean;
}) {
  const [creating, setCreating] = React.useState(false);
  const [closing, setClosing] = React.useState<WorkspacePrivacyRequest | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  async function update(
    request: WorkspacePrivacyRequest,
    patch: { acknowledged?: boolean; identityVerified?: boolean; status?: "IN_PROGRESS" },
  ) {
    setPending(request.id);
    try {
      const result = await updatePrivacyRequestAction({ requestId: request.id, ...patch });
      if (result.ok) {
        toast({ variant: "success", title: result.message });
        router.refresh();
      } else toast({ variant: "error", title: result.error });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-content">Privacy requests</h3>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            Requests from people about their data. Acknowledge each within 30
            days and respond within one month of receipt.
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            Record a request
          </Button>
        )}
      </div>

      {!canManage ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-content-muted">
          Only owners and admins can see and handle privacy requests.
        </p>
      ) : loadError ? (
        <p className="mt-3 rounded-lg border border-danger-100 bg-danger-50 px-3 py-4 text-center text-[12.5px] text-danger-700">
          Privacy requests could not be loaded. Refresh the page to try again.
        </p>
      ) : requests.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-content-muted">
          No privacy requests recorded. When someone asks about their data by
          email or phone, record it here so the deadlines are tracked.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line-subtle rounded-lg border border-line">
          {requests.map((request) => {
            const open = request.status === "PENDING" || request.status === "IN_PROGRESS";
            const ack = open && !request.acknowledgedAt ? clock("Acknowledge", request.acknowledgeBy) : null;
            const due = open ? clock("Respond", request.dueAt) : null;
            const status = STATUS[request.status] ?? STATUS.PENDING;
            return (
              <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 space-y-1">
                  <p className="text-[13px] font-medium text-content">
                    {request.reference} · {TYPE_LABEL[request.type] ?? request.type}
                  </p>
                  <p className="truncate text-[12px] text-content-muted">
                    {request.subjectName ?? request.subjectEmail ?? "Unnamed"} · received{" "}
                    {new Date(request.receivedAt).toLocaleDateString("en-GB")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={status.tone} dense dot>
                      {status.label}
                    </Badge>
                    {request.verificationStatus !== "VERIFIED" &&
                      request.verificationStatus !== "NOT_REQUIRED" && (
                        <Badge tone="warning" dense>
                          Identity not verified
                        </Badge>
                      )}
                    {ack && (
                      <Badge tone={ack.tone} dense>
                        {ack.text}
                      </Badge>
                    )}
                    {due && (
                      <Badge tone={due.tone} dense>
                        {due.text}
                      </Badge>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="flex flex-wrap gap-1.5">
                    {!request.acknowledgedAt && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending === request.id}
                        onClick={() => update(request, { acknowledged: true })}
                      >
                        Mark acknowledged
                      </Button>
                    )}
                    {request.verificationStatus !== "VERIFIED" &&
                      request.verificationStatus !== "NOT_REQUIRED" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pending === request.id}
                          onClick={() => update(request, { identityVerified: true })}
                        >
                          Identity checked
                        </Button>
                      )}
                    {request.status === "PENDING" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending === request.id}
                        onClick={() => update(request, { status: "IN_PROGRESS" })}
                      >
                        Start
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setClosing(request)}>
                      Close…
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {creating && <CreateRequestDialog onClose={() => setCreating(false)} />}
      {closing && <CloseRequestDialog request={closing} onClose={() => setClosing(null)} />}
    </section>
  );
}

function CreateRequestDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [type, setType] = React.useState<PrivacyRequestKind>("ACCESS");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [receivedOn, setReceivedOn] = React.useState(new Date().toISOString().slice(0, 10));
  const [verified, setVerified] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim() && !email.trim()) {
      setError("Enter the person's name or email.");
      return;
    }
    setSaving(true);
    try {
      const result = await createPrivacyRequestAction({
        type,
        subjectName: name.trim() || undefined,
        subjectEmail: email.trim() || undefined,
        details: details.trim() || undefined,
        identityVerified: verified,
        receivedOn,
      });
      if (result.ok) {
        toast({ variant: "success", title: result.message });
        router.refresh();
        onClose();
      } else setError(result.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title="Record a privacy request"
      description="The response deadlines run from the day the person asked, not the day it was recorded."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" loading={saving} onClick={save}>
            Record request
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormField label="Type" htmlFor="pr-type">
          <Select id="pr-type" value={type} onChange={(e) => setType(e.target.value as PrivacyRequestKind)}>
            {PRIVACY_REQUEST_TYPES.map((value) => (
              <option key={value} value={value}>
                {PRIVACY_REQUEST_TYPE_COPY[value].label}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" htmlFor="pr-name">
            <Input id="pr-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Email" htmlFor="pr-email">
            <Input id="pr-email" type="email" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Received on" htmlFor="pr-received">
          <Input
            id="pr-received"
            type="date"
            value={receivedOn}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
        </FormField>
        <FormField label="Details" htmlFor="pr-details" hint="What they asked for, in their words.">
          <Textarea id="pr-details" rows={3} value={details} maxLength={4000} onChange={(e) => setDetails(e.target.value)} />
        </FormField>
        <label className="flex items-start gap-2 text-[13px] text-content">
          <Checkbox checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-0.5" />
          <span>
            We have confirmed this person is who they say they are.{" "}
            <span className="text-content-muted">
              Do not act on an access or erasure request until they are.
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-[12px] text-danger-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function CloseRequestDialog({
  request,
  onClose,
}: {
  request: WorkspacePrivacyRequest;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [status, setStatus] = React.useState<"COMPLETED" | "REJECTED">("COMPLETED");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!note.trim()) {
      setError("Record how the request was answered before closing it.");
      return;
    }
    setSaving(true);
    try {
      const result = await updatePrivacyRequestAction({ requestId: request.id, status, note: note.trim() });
      if (result.ok) {
        toast({ variant: "success", title: `${request.reference} closed.` });
        router.refresh();
        onClose();
      } else setError(result.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title={`Close ${request.reference}`}
      description="Closing records that the person was answered. The note is kept with the request."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" loading={saving} onClick={save}>
            Close request
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormField label="Outcome" htmlFor="pr-outcome">
          <Select id="pr-outcome" value={status} onChange={(e) => setStatus(e.target.value as "COMPLETED" | "REJECTED")}>
            <option value="COMPLETED">Answered</option>
            <option value="REJECTED">Refused, with reasons given to the person</option>
          </Select>
        </FormField>
        <FormField label="How it was answered" htmlFor="pr-note" error={error ?? undefined}>
          <Textarea id="pr-note" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}
