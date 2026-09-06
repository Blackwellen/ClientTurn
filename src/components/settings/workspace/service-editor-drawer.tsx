"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { FormField, Input, Switch, Textarea } from "@/components/ui/form";
import type { ServiceRow } from "@/lib/settings/types";

export type ServiceDraft = {
  id?: string;
  name: string;
  description: string;
  averageValue: string;
  active: boolean;
};

export function toDraft(service: ServiceRow): ServiceDraft {
  return {
    id: service.id,
    name: service.name,
    description: service.description ?? "",
    averageValue: service.averageValue === null ? "" : String(service.averageValue),
    active: service.active,
  };
}

export const EMPTY_SERVICE: ServiceDraft = {
  name: "",
  description: "",
  averageValue: "",
  active: true,
};

/**
 * Add and edit both happen in this drawer rather than on a separate page.
 * Qualification rules are deliberately absent — they live in
 * Follow-Up → Qualification and are not duplicated under Settings.
 */
export function ServiceEditorDrawer({
  draft,
  onChange,
  onClose,
  onSave,
  saving,
  error,
}: {
  draft: ServiceDraft | null;
  onChange: (next: ServiceDraft) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <Drawer
      open={Boolean(draft)}
      onClose={onClose}
      anchor="content"
      title={draft?.id ? "Edit service" : "Add service"}
      description="Services are used in lead capture, messaging and bookings."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" form="service-editor-form" type="submit" loading={saving}>
            Save service
          </Button>
        </>
      }
    >
      {draft && (
        <form
          id="service-editor-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <FormField label="Name" htmlFor="service-name" required>
            <Input
              id="service-name"
              required
              maxLength={80}
              value={draft.name}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </FormField>

          <FormField
            label="Description"
            htmlFor="service-description"
            hint="Optional. Helps your team tell similar services apart."
          >
            <Textarea
              id="service-description"
              rows={3}
              maxLength={400}
              value={draft.description}
              onChange={(event) =>
                onChange({ ...draft, description: event.target.value })
              }
            />
          </FormField>

          <FormField
            label="Average value (£)"
            htmlFor="service-value"
            hint="Used for the estimated pipeline figure on your dashboard. Never sent to a lead."
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
                onChange({ ...draft, averageValue: event.target.value })
              }
            />
          </FormField>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-line px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-content">Active</p>
              <p className="text-[13px] text-content-muted">
                New leads can be qualified for this service.
              </p>
            </div>
            <Switch
              label="Service is active"
              checked={draft.active}
              onCheckedChange={(active) => onChange({ ...draft, active })}
            />
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-danger-600">
              {error}
            </p>
          )}
        </form>
      )}
    </Drawer>
  );
}
