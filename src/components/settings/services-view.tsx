"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/feedback";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { formatGbp } from "@/lib/dates";
import { deleteService, saveService } from "@/lib/settings/actions";
import type { ServiceRow } from "@/lib/settings/types";

type Draft = {
  id?: string;
  name: string;
  description: string;
  averageValue: string;
  active: boolean;
};

const EMPTY: Draft = { name: "", description: "", averageValue: "", active: true };

export function ServicesView({
  services,
  canManage,
}: {
  services: ServiceRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ServiceRow | null>(null);
  const [pending, setPending] = React.useState(false);

  function openNew() {
    setError(null);
    setDraft({ ...EMPTY });
  }

  function openEdit(service: ServiceRow) {
    setError(null);
    setDraft({
      id: service.id,
      name: service.name,
      description: service.description ?? "",
      averageValue:
        service.averageValue === null ? "" : String(service.averageValue),
      active: service.active,
    });
  }

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setSaving(true);
    setError(null);
    const result = await saveService(draft);
    setSaving(false);

    if (result.ok) {
      toast({ variant: "success", title: draft.id ? "Service saved" : "Service added" });
      setDraft(null);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function onDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteService(deleting.id);
    setPending(false);

    if (result.ok) {
      toast({ variant: "success", title: "Service deleted" });
      setDeleting(null);
      router.refresh();
    } else {
      setPending(false);
      setDeleting(null);
      toast({ variant: "error", title: "Not deleted", description: result.error });
    }
  }

  const activeCount = services.filter((service) => service.active).length;
  const inactiveCount = services.length - activeCount;
  const valuedServices = services.filter((service) => service.averageValue !== null);
  const averageValue =
    valuedServices.length === 0
      ? null
      : valuedServices.reduce((sum, s) => sum + (s.averageValue ?? 0), 0) /
        valuedServices.length;

  return (
    <div className="space-y-4">
      {services.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface border-line rounded-xl border px-4 py-3 shadow-xs">
            <StatCard label="Active" value={activeCount} />
          </div>
          <div className="bg-surface border-line rounded-xl border px-4 py-3 shadow-xs">
            <StatCard label="Inactive" value={inactiveCount} />
          </div>
          <div className="bg-surface border-line rounded-xl border px-4 py-3 shadow-xs">
            <StatCard
              label="Avg. job value"
              value={averageValue === null ? "Not set" : formatGbp(averageValue)}
            />
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Wrench}
            title="Services"
            description="The work you take on. A lead is qualified against the service it asks for."
            action={
              canManage ? (
                <Button size="sm" onClick={openNew}>
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
              description="Client Turn cannot qualify a lead until it knows what you sell. Add your first service to get started."
              action={
                canManage ? (
                  <Button size="sm" onClick={openNew}>
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
                  <TableHead align="right" numeric>
                    Average job value
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell>
                      <p className="text-content font-medium">{service.name}</p>
                      {service.description && (
                        <p className="text-content-muted line-clamp-1 text-[12px]">
                          {service.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {service.averageValue === null
                        ? "Not set"
                        : formatGbp(service.averageValue)}
                    </TableCell>
                    <TableCell>
                      <Badge tone={service.active ? "success" : "neutral"} dot>
                        {service.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell align="right">
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => openEdit(service)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-danger-600 hover:bg-danger-50"
                            onClick={() => setDeleting(service)}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : (
                        <span className="text-content-subtle text-[12px]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-content-subtle text-[12px]">
        Average job value is only used to work out the estimated pipeline figure on
        your dashboard. It is never sent to a lead.
      </p>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit service" : "Add service"}
        description="Average job value feeds the estimated pipeline figure on your dashboard."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" form="service-form" type="submit" loading={saving}>
              Save service
            </Button>
          </>
        }
      >
        {draft && (
          <form id="service-form" onSubmit={onSave} className="space-y-4">
            <FormField label="Service name" htmlFor="service-name" required>
              <Input
                id="service-name"
                required
                maxLength={80}
                value={draft.name}
                aria-invalid={Boolean(error) || undefined}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </FormField>

            <FormField label="Description" htmlFor="service-description">
              <Textarea
                id="service-description"
                maxLength={400}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </FormField>

            <FormField
              label="Average job value (£)"
              htmlFor="service-value"
              hint="Used for the estimated pipeline figure on your dashboard."
            >
              <Input
                id="service-value"
                type="number"
                inputMode="decimal"
                min={0}
                max={1000000}
                step="1"
                value={draft.averageValue}
                onChange={(event) =>
                  setDraft({ ...draft, averageValue: event.target.value })
                }
              />
            </FormField>

            <div className="flex items-center gap-2">
              <Checkbox
                id="service-active"
                checked={draft.active}
                onChange={(event) =>
                  setDraft({ ...draft, active: event.target.checked })
                }
              />
              <label htmlFor="service-active" className="text-content text-[13px]">
                Active — new leads can be qualified for this service
              </label>
            </div>

            {error && (
              <p role="alert" className="text-danger-600 text-[13px]">
                {error}
              </p>
            )}
          </form>
        )}
      </Modal>

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
        consequence="This cannot be undone. If the service is attached to existing leads, set it to inactive instead."
        confirmLabel="Delete"
      />
    </div>
  );
}
