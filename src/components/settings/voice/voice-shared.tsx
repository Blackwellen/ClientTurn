"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/** One card in a voice panel, with an optional save footer for editors. */
export function PanelCard({
  title,
  description,
  children,
  footer,
  aside,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {aside}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
      {footer && <CardFooter className="flex-wrap justify-end">{footer}</CardFooter>}
    </Card>
  );
}

/** The save button for a panel; absent for read-only viewers. */
export function SaveFooter({
  canEdit,
  saving,
  onSave,
  label = "Save",
  disabled,
  note,
}: {
  canEdit: boolean;
  saving: boolean;
  onSave: () => void;
  label?: string;
  disabled?: boolean;
  note?: string | null;
}) {
  if (!canEdit) return null;
  return (
    <>
      {note && <p className="mr-auto text-[12px] text-content-muted">{note}</p>}
      <Button size="sm" loading={saving} disabled={disabled} onClick={onSave}>
        {label}
      </Button>
    </>
  );
}

/** A label and a value, for read-only facts. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-content-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[13.5px] font-medium text-content">{children}</dd>
    </div>
  );
}

/** A switch with its label and help text on one row. */
export function SwitchRow({
  title,
  hint,
  control,
}: {
  title: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-content">{title}</p>
        {hint && <p className="mt-0.5 text-[12.5px] text-content-muted">{hint}</p>}
      </div>
      <div className="pt-0.5">{control}</div>
    </div>
  );
}

export function Notice({ tone = "neutral", children, role }: { tone?: "neutral" | "warning" | "danger" | "success"; children: React.ReactNode; role?: "status" | "alert" }) {
  const tones = {
    neutral: "border-line bg-surface-sunken text-content-secondary",
    warning: "border-warning-100 bg-warning-50 text-warning-700",
    danger: "border-danger-100 bg-danger-50 text-danger-700",
    success: "border-success-100 bg-success-50 text-success-700",
  } as const;
  return (
    <div role={role} className={`rounded-lg border px-3.5 py-2.5 text-[12.5px] ${tones[tone]}`}>
      {children}
    </div>
  );
}
