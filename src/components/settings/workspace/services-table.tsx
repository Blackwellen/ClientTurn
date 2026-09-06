"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DropdownItem, DropdownMenu } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { IconButton } from "@/components/ui/button";
import { SectionHeader } from "@/components/app/page-header";
import { formatGbp } from "@/lib/dates";
import { deleteService, saveService } from "@/lib/settings/actions";
import type { ServiceRow } from "@/lib/settings/types";
import {
  EMPTY_SERVICE,
  ServiceEditorDrawer,
  toDraft,
  type ServiceDraft,
} from "./service-editor-drawer";

/**
 * Services are separate records, so every change here commits on its own
 * rather than joining the Workspace draft — an active toggle that only took
 * effect after a page-level save would be a lie.
 */
export function ServicesTable({
  services,
  canManage,
}: {
  services: ServiceRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [draft, setDraft] = React.useState<ServiceDraft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [toggling, setToggling] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<ServiceRow | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const result = await saveService(draft);
    setSaving(false);

    if (result.ok) {
      toast({
        variant: "success",
        title: draft.id ? "Service updated" : "Service added",
      });
      setDraft(null);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function onToggleActive(service: ServiceRow, active: boolean) {
    setToggling(service.id);
    const result = await saveService({
      id: service.id,
      name: service.name,
      description: service.description ?? "",
      averageValue:
        service.averageValue === null ? "" : String(service.averageValue),
      active,
    });
    setToggling(null);

    if (result.ok) {
      toast({
        variant: "success",
        title: active ? "Service activated" : "Service deactivated",
      });
      router.refresh();
    } else {
      toast({
        variant: "error",
        title: "Service not updated",
        description: result.error,
      });
    }
  }

  async function onDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteService(deleting.id);
    setPending(false);
    setDeleting(null);

    if (result.ok) {
      toast({ variant: "success", title: "Service deleted" });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Not deleted", description: result.error });
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <SectionHeader
            title="Services"
            description="Manage the services you offer. These are used in lead capture, messaging and bookings."
            action={
              canManage ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setDraft({ ...EMPTY_SERVICE });
                  }}
                >
                  <Plus className="size-3.5" aria-hidden />
                  Add service
                </Button>
              ) : undefined
            }
          />
        </CardHeader>
        <CardContent className="p-0">
          {services.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No services yet"
              description="Client Turn cannot qualify a lead until it knows what you sell."
              action={
                canManage ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setError(null);
                      setDraft({ ...EMPTY_SERVICE });
                    }}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Add service
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead numeric>Average value</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead align="right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell>
                      <p className="font-medium text-content">{service.name}</p>
                      {service.description && (
                        <p className="line-clamp-1 text-[12px] text-content-muted">
                          {service.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell numeric>
                      {service.averageValue === null
                        ? "Not set"
                        : formatGbp(service.averageValue)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Switch
                          label={`${service.name} active`}
                          checked={service.active}
                          disabled={!canManage || toggling === service.id}
                          onCheckedChange={(active) =>
                            onToggleActive(service, active)
                          }
                        />
                        <span className="text-[13px] text-content-secondary">
                          {service.active ? "On" : "Off"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell align="right">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => {
                              setError(null);
                              setDraft(toDraft(service));
                            }}
                          >
                            Edit
                          </Button>
                          <DropdownMenu
                            align="end"
                            trigger={
                              <IconButton
                                size="xs"
                                label={`More actions for ${service.name}`}
                              >
                                <MoreVertical className="size-4" />
                              </IconButton>
                            }
                          >
                            <DropdownItem
                              onSelect={() =>
                                onToggleActive(service, !service.active)
                              }
                            >
                              {service.active ? "Deactivate" : "Activate"}
                            </DropdownItem>
                            <DropdownItem
                              destructive
                              onSelect={() => setDeleting(service)}
                            >
                              Delete service
                            </DropdownItem>
                          </DropdownMenu>
                        </div>
                      ) : (
                        <span className="text-[12px] text-content-subtle">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ServiceEditorDrawer
        draft={draft}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={onSave}
        saving={saving}
        error={error}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        loading={pending}
        variant="danger"
        title="Delete this service?"
        scope={
          deleting
            ? `${deleting.name} is removed from this workspace along with its qualifying questions and rules.`
            : ""
        }
        consequence="This cannot be undone. If the service is attached to existing leads, deactivate it instead so their history stays intact."
        confirmLabel="Delete"
      />
    </>
  );
}
