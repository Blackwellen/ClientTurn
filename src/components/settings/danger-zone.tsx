"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, ShieldAlert, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { deleteWorkspace, exportWorkspaceData } from "@/lib/settings/actions";

export function DangerZone({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const { toast } = useToast();

  const [exporting, setExporting] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  async function onExport() {
    setExporting(true);
    const result = await exportWorkspaceData();
    setExporting(false);

    if (!result.ok) {
      toast({ variant: "error", title: "Export failed", description: result.error });
      return;
    }

    const blob = new Blob([result.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(url);

    toast({ variant: "success", title: "Export downloaded" });
  }

  async function onDelete(event: React.FormEvent) {
    event.preventDefault();
    setDeleting(true);
    setError(null);
    const result = await deleteWorkspace(confirmation);

    if (result.ok) {
      router.replace("/login");
      return;
    }

    setDeleting(false);
    setError(result.error);
  }

  return (
    <div className="space-y-4">
      <div className="border-danger-100 bg-danger-50 flex items-start gap-3 rounded-xl border px-4 py-3.5">
        <ShieldAlert className="text-danger-600 mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-danger-700 text-[13px] font-semibold">
            Irreversible actions
          </p>
          <p className="text-content-secondary mt-0.5 text-[13px]">
            Everything on this page either removes data permanently or ends
            this workspace entirely. Read each action carefully before you
            confirm it.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Download}
            title="Export workspace data"
            description="A JSON file containing your business details, services, team, leads, conversations and bookings."
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" variant="secondary" loading={exporting} onClick={onExport}>
            <Download className="size-3.5" aria-hidden />
            Export data
          </Button>
          <p className="text-content-subtle text-[12px]">
            The export covers the 5,000 most recent rows of each large table. Ask
            support if you need a complete historical extract.
          </p>
        </CardContent>
      </Card>

      <Card className="border-danger-200 overflow-hidden">
        <CardHeader className="bg-danger-50/60 border-danger-100">
          <SectionHeader
            icon={TriangleAlert}
            tone="danger"
            title="Delete this workspace"
            description="Permanent. There is no undo and no recovery from a backup."
            action={<Badge tone="danger">Irreversible</Badge>}
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="text-content-secondary list-disc space-y-1 pl-5 text-[13px]">
            <li>Every lead, conversation, booking and report is deleted.</li>
            <li>All provider connections are removed and follow-up stops immediately.</li>
            <li>Everyone on the team loses access straight away.</li>
            <li>Your subscription is cancelled.</li>
          </ul>
          <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
            <TriangleAlert className="size-3.5" aria-hidden />
            Delete workspace
          </Button>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => {
          if (!deleting) {
            setOpen(false);
            setConfirmation("");
            setError(null);
          }
        }}
        title="Delete this workspace permanently?"
        description="Export your data first if you might need it. This cannot be undone."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={deleting}
              onClick={() => {
                setOpen(false);
                setConfirmation("");
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              type="submit"
              form="delete-workspace"
              loading={deleting}
              disabled={confirmation.trim() !== workspaceName}
            >
              Delete workspace
            </Button>
          </>
        }
      >
        <form id="delete-workspace" onSubmit={onDelete} className="space-y-3">
          <p className="text-content text-[13px]">
            Type <span className="font-semibold">{workspaceName}</span> to confirm.
          </p>
          <FormField
            label="Workspace name"
            htmlFor="delete-confirmation"
            error={error ?? undefined}
          >
            <Input
              id="delete-confirmation"
              autoComplete="off"
              value={confirmation}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
