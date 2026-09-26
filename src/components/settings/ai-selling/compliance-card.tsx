"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Scale } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox, FormField, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { SectionHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/dates";
import {
  LIA_CHANNELS,
  LIA_STATUSES,
  liaProblems,
  liaReviewOverdue,
  liaSchema,
  type LiaChannel,
  type LiaRow,
  type LiaStatus,
} from "@/lib/settings/ai-selling";
import { saveLiaAction } from "@/lib/settings/ai-selling-actions";
import { useSettingsSave } from "./use-settings-save";

const CHANNEL_LABEL: Record<LiaChannel, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  SOCIAL: "Social",
};

type Draft = {
  id?: string;
  purpose: string;
  necessity: string;
  balancing: string;
  safeguards: string;
  channels: LiaChannel[];
  status: LiaStatus;
  nextReviewOn: string;
};

function blank(): Draft {
  return { purpose: "", necessity: "", balancing: "", safeguards: "", channels: ["EMAIL"], status: "DRAFT", nextReviewOn: "" };
}

function fromRow(row: LiaRow): Draft {
  return {
    id: row.id,
    purpose: row.purpose,
    necessity: row.necessity,
    balancing: row.balancing,
    safeguards: row.safeguards ?? "",
    channels: row.channels.filter((c): c is LiaChannel => (LIA_CHANNELS as readonly string[]).includes(c)),
    status: (LIA_STATUSES as readonly string[]).includes(row.status) ? (row.status as LiaStatus) : "DRAFT",
    nextReviewOn: row.nextReviewAt ? row.nextReviewAt.slice(0, 10) : "",
  };
}

/**
 * Compliance: a link to Data Controls, and the legitimate interests
 * assessments (ICO: purpose, necessity, balancing) this workspace relies on.
 * An ACTIVE assessment is what lets a contact be treated as
 * LEGITIMATE_INTERESTS_REVIEWED, so it must carry a future review date.
 */
export function ComplianceCard({ lias, canManage }: { lias: LiaRow[]; canManage: boolean }) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { save, saving, fieldErrors } = useSettingsSave();
  const now = React.useMemo(() => new Date(), []);

  const shown = { ...errors, ...fieldErrors };

  function open(next: Draft) {
    setErrors({});
    setDraft(next);
  }

  async function onSave() {
    if (!draft) return;
    const input = {
      ...(draft.id ? { id: draft.id } : {}),
      purpose: draft.purpose,
      necessity: draft.necessity,
      balancing: draft.balancing,
      ...(draft.safeguards.trim() ? { safeguards: draft.safeguards } : {}),
      channels: draft.channels,
      status: draft.status,
      ...(draft.nextReviewOn ? { nextReviewOn: draft.nextReviewOn } : {}),
    };
    const next: Record<string, string> = {};
    const parsed = liaSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
    }
    const problems = liaProblems({ status: draft.status, nextReviewOn: draft.nextReviewOn || undefined });
    if (problems[0]) next.nextReviewOn ??= problems[0];
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const ok = await save(() => saveLiaAction(input));
    if (ok) setDraft(null);
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Scale}
          title="Compliance"
          description="The legitimate interests assessments behind contacting people who have not given consent."
          action={
            canManage ? (
              <Button size="sm" variant="secondary" onClick={() => open(blank())}>
                <Plus className="size-3.5" />
                New assessment
              </Button>
            ) : undefined
          }
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[12.5px] text-content-muted">
          Suppression, retention and privacy requests are in{" "}
          <Link href="/app/settings?section=data-controls" className="font-medium text-content-accent hover:underline">
            Data Controls
          </Link>
          .
        </p>

        {lias.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-content-muted">
            No assessment recorded. An assessment is your written record of the legitimate interests balancing test. While one is active for a channel, the contactability check labels prospects found by ClientTurn or imported by you as reviewed under legitimate interests on that channel. It does not start or stop any sending: suppression, opt-outs and the contactability checks decide that.
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle rounded-lg border border-line">
            {lias.map((row) => {
              const overdue = liaReviewOverdue(row, now);
              return (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-content">{row.purpose}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-content-muted">
                      <StatusBadge kind="lia" value={row.status} dense />
                      {row.channels.map((channel) => (
                        <Badge key={channel} tone="neutral" dense>
                          {CHANNEL_LABEL[channel as LiaChannel] ?? channel}
                        </Badge>
                      ))}
                      <span>Reviewed {formatDate(row.reviewedAt)}</span>
                      {row.nextReviewAt && (
                        <span className={overdue ? "font-medium text-danger-700" : undefined}>
                          · {overdue ? "Review overdue since" : "Next review"} {formatDate(row.nextReviewAt)}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => open(fromRow(row))}>
                    {canManage ? "Edit" : "View"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Modal
        open={draft !== null}
        onClose={() => (saving ? undefined : setDraft(null))}
        size="lg"
        title={draft?.id ? "Legitimate interests assessment" : "New legitimate interests assessment"}
        description="Record the three ICO tests: the purpose, why the processing is necessary for it, and why it does not override the person's interests."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)} disabled={saving}>
              {canManage ? "Cancel" : "Close"}
            </Button>
            {canManage && (
              <Button size="sm" loading={saving} onClick={onSave}>
                Save assessment
              </Button>
            )}
          </>
        }
      >
        {draft && (
          <fieldset disabled={!canManage} className="space-y-4">
            <FormField label="Purpose" htmlFor="lia-purpose" required error={shown.purpose}>
              <Input
                id="lia-purpose"
                maxLength={500}
                value={draft.purpose}
                onChange={(event) => setDraft({ ...draft, purpose: event.target.value })}
              />
            </FormField>
            <FormField label="Necessity" htmlFor="lia-necessity" required error={shown.necessity}>
              <Textarea
                id="lia-necessity"
                rows={3}
                maxLength={4000}
                value={draft.necessity}
                onChange={(event) => setDraft({ ...draft, necessity: event.target.value })}
              />
            </FormField>
            <FormField label="Balancing test" htmlFor="lia-balancing" required error={shown.balancing}>
              <Textarea
                id="lia-balancing"
                rows={3}
                maxLength={4000}
                value={draft.balancing}
                onChange={(event) => setDraft({ ...draft, balancing: event.target.value })}
              />
            </FormField>
            <FormField label="Safeguards" htmlFor="lia-safeguards" hint="Optional. For example: an opt-out in every message." error={shown.safeguards}>
              <Textarea
                id="lia-safeguards"
                rows={2}
                maxLength={4000}
                value={draft.safeguards}
                onChange={(event) => setDraft({ ...draft, safeguards: event.target.value })}
              />
            </FormField>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-content">Channels</p>
              <div className="flex flex-wrap gap-3">
                {LIA_CHANNELS.map((channel) => (
                  <label key={channel} className="inline-flex items-center gap-2 text-[13px] text-content">
                    <Checkbox
                      checked={draft.channels.includes(channel)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          channels: draft.channels.includes(channel)
                            ? draft.channels.filter((c) => c !== channel)
                            : [...draft.channels, channel],
                        })
                      }
                    />
                    {CHANNEL_LABEL[channel]}
                  </label>
                ))}
              </div>
              {shown.channels && (
                <p role="alert" className="mt-1 text-[12px] text-danger-600">
                  {shown.channels}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Status" htmlFor="lia-status">
                <Select
                  id="lia-status"
                  value={draft.status}
                  onChange={(event) => setDraft({ ...draft, status: event.target.value as LiaStatus })}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                  <option value="WITHDRAWN">Withdrawn</option>
                </Select>
              </FormField>
              <FormField
                label="Next review"
                htmlFor="lia-review"
                required={draft.status === "ACTIVE"}
                hint="Required for an active assessment."
                error={shown.nextReviewOn}
              >
                <Input
                  id="lia-review"
                  type="date"
                  value={draft.nextReviewOn}
                  onChange={(event) => setDraft({ ...draft, nextReviewOn: event.target.value })}
                />
              </FormField>
            </div>
          </fieldset>
        )}
      </Modal>
    </Card>
  );
}
