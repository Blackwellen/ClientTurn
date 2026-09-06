"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";

const MAX = 500;

export function ServiceAreaField({
  value,
  onChange,
  readOnly,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  error?: string;
}) {
  const id = React.useId();

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Service area"
          description="Describe the geographic area you serve."
        />
      </CardHeader>
      <CardContent className="space-y-2">
        <label htmlFor={id} className="sr-only">
          Service area description
        </label>
        <Textarea
          id={id}
          rows={3}
          maxLength={MAX}
          value={value}
          disabled={readOnly}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={`${id}-count`}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p role="alert" className="text-[12px] text-danger-600">
              {error}
            </p>
          ) : (
            <span />
          )}
          <p id={`${id}-count`} className="lr-tabular text-[12px] text-content-muted">
            {value.length} / {MAX}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
