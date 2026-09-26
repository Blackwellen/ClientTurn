"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useAdminAction } from "@/components/admin/use-admin-action";
import {
  resolveMergeCandidateAdmin,
  revertMergeAdmin,
} from "@/lib/admin/revenue-ops-actions";
import type { AdminActionResult } from "@/lib/admin/actions";

type Side = { id: string; name: string; createdAt: string | null } | null;

/**
 * Merge / dismiss / undo for one duplicate pair. Every path is confirmed, runs
 * through the guarded server action (step-up, audit), and the merge itself is
 * recorded with a before-snapshot so it can be undone from the Merged list.
 */
export function MergeCandidateActions({
  candidateId,
  status,
  leadA,
  leadB,
  undoableMergeEventId,
}: {
  candidateId: string;
  status: string;
  leadA: Side;
  leadB: Side;
  undoableMergeEventId: string | null;
}) {
  const router = useRouter();
  const { run, pending, stepUpDialog } = useAdminAction();
  const [dialog, setDialog] = React.useState<
    "merge" | "dismiss" | "undo" | null
  >(null);
  const older =
    leadA &&
    leadB &&
    leadB.createdAt &&
    leadA.createdAt &&
    leadB.createdAt < leadA.createdAt
      ? leadB.id
      : (leadA?.id ?? null);
  const [keeperId, setKeeperId] = React.useState<string | null>(older);

  async function act(
    key: string,
    fn: () => Promise<AdminActionResult>,
    success: string,
  ) {
    await run(key, fn, success);
    setDialog(null);
    router.refresh();
  }

  if (status === "MERGED") {
    if (!undoableMergeEventId)
      return (
        <span className="text-content-subtle text-[12px]">
          Undone or not undoable
        </span>
      );
    return (
      <>
        <Button
          size="xs"
          variant="secondary"
          loading={pending === "undo"}
          onClick={() => setDialog("undo")}
        >
          Undo merge
        </Button>
        <ConfirmDialog
          open={dialog === "undo"}
          onClose={() => setDialog(null)}
          title="Undo this merge?"
          scope="Both lead records, their touches, conversations and messages."
          consequence="Moved touches, conversations and messages go back to the second lead, it is un-archived, and fields the merge filled on the kept lead are cleared unless someone has edited them since. The pair returns to the open queue."
          confirmLabel="Undo merge"
          variant="warning"
          onConfirm={() =>
            act(
              "undo",
              () => revertMergeAdmin({ mergeEventId: undoableMergeEventId }),
              "Merge undone",
            )
          }
        />
        {stepUpDialog}
      </>
    );
  }

  if (status !== "OPEN") return null;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="xs"
        variant="secondary"
        loading={pending === "merge"}
        onClick={() => setDialog("merge")}
      >
        Merge
      </Button>
      <Button
        size="xs"
        variant="ghost"
        loading={pending === "dismiss"}
        onClick={() => setDialog("dismiss")}
      >
        Dismiss
      </Button>

      <ConfirmDialog
        open={dialog === "merge"}
        onClose={() => setDialog(null)}
        title="Merge these records?"
        scope={
          leadB
            ? "Two leads in this workspace."
            : "A lead and a sourced prospect."
        }
        consequence={
          leadB
            ? "The other lead's touches, conversations and messages move to the kept lead, its blank fields are filled (never overwritten), and the other lead is archived as a duplicate. This is recorded and can be undone."
            : "The prospect is linked to this lead, so it is not contacted as a separate person. This can be undone."
        }
        confirmLabel="Merge"
        onConfirm={() =>
          act(
            "merge",
            () =>
              resolveMergeCandidateAdmin({
                candidateId,
                decision: "MERGE",
                keeperId: leadB ? keeperId : null,
              }),
            "Merged",
          )
        }
      >
        {leadA && leadB && (
          <fieldset className="space-y-1.5">
            <legend className="text-content mb-1 text-[12.5px] font-medium">
              Keep which record?
            </legend>
            {[leadA, leadB].map((side) => (
              <label
                key={side.id}
                className="text-content-secondary flex items-center gap-2 text-[13px]"
              >
                <input
                  type="radio"
                  name={`keeper-${candidateId}`}
                  checked={keeperId === side.id}
                  onChange={() => setKeeperId(side.id)}
                />
                {side.name}
                {side.id === older && (
                  <span className="text-content-subtle text-[11.5px]">
                    (older, recommended)
                  </span>
                )}
              </label>
            ))}
          </fieldset>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "dismiss"}
        onClose={() => setDialog(null)}
        title="Keep these records separate?"
        scope="This duplicate pair only."
        consequence="The pair leaves the queue and both records stay exactly as they are."
        confirmLabel="Dismiss"
        onConfirm={() =>
          act(
            "dismiss",
            () =>
              resolveMergeCandidateAdmin({ candidateId, decision: "DISMISS" }),
            "Dismissed",
          )
        }
      />
      {stepUpDialog}
    </div>
  );
}
