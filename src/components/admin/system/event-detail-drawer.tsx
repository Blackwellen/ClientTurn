"use client";

import * as React from "react";
import Link from "next/link";
import { Play, ShieldAlert } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { EventStatusBadge } from "@/components/admin/ui";
import { formatDateTime, formatRelative } from "@/lib/admin/format";
import type { EventDetail } from "@/lib/admin/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <dt className="shrink-0 text-[12.5px] text-content-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] break-all text-content">
        {children}
      </dd>
    </div>
  );
}

export function EventDetailDrawer({
  detail,
  retrying,
  onClose,
  onRetry,
}: {
  detail: EventDetail;
  retrying: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <Drawer
      open
      onClose={onClose}
      size="panel"
      anchor="content"
      title={`${detail.providerLabel} · ${detail.typeLabel}`}
      description="Operational event detail"
      footer={
        detail.retryable ? (
          <Button size="sm" loading={retrying} onClick={onRetry}>
            <Play className="size-3.5" aria-hidden />
            Safe retry
          </Button>
        ) : (
          <p className="flex items-start gap-2 text-[12px] text-content-muted">
            <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{detail.retryBlockedReason}</span>
          </p>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <EventStatusBadge status={detail.status} />
          <span className="text-[12.5px] text-content-muted">
            Attempt {detail.attempts}
            {detail.maxAttempts !== null && ` of ${detail.maxAttempts}`}
          </span>
        </div>

        <dl className="rounded-lg border border-line bg-surface-sunken/50 px-3 py-2">
          <Row label="Event id">{detail.id}</Row>
          {detail.reference && <Row label="Provider reference">{detail.reference}</Row>}
          <Row label="Provider">{detail.providerLabel}</Row>
          <Row label="Type">{detail.typeLabel}</Row>
          <Row label="Business">
            {detail.businessId ? (
              <Link
                href={`/admin/customers?customer=${detail.businessId}`}
                className="text-content-accent hover:underline"
              >
                {detail.businessName}
              </Link>
            ) : (
              "Platform"
            )}
          </Row>
          <Row label="Received">
            {formatDateTime(detail.receivedAt)}{" "}
            <span className="text-content-muted">
              ({formatRelative(detail.receivedAt)})
            </span>
          </Row>
          <Row label="Processed">
            {detail.processedAt ? formatDateTime(detail.processedAt) : "—"}
          </Row>
        </dl>

        {detail.metadata.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-content">
              Metadata
            </h3>
            <dl className="rounded-lg border border-line bg-surface-sunken/50 px-3 py-2">
              {detail.metadata.map((entry) => (
                <Row key={entry.key} label={entry.key}>
                  {entry.value}
                </Row>
              ))}
            </dl>
          </div>
        )}

        {detail.lastError && (
          <div>
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-content">
              Last error
            </h3>
            <p className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[12.5px] break-words text-danger-700">
              {detail.lastError}
            </p>
          </div>
        )}

        {detail.payloadPreview && (
          <div>
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-content">
              Payload
            </h3>
            <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-surface-sunken/50 px-3 py-2 text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-content-secondary">
              {detail.payloadPreview}
            </pre>
            <p className="mt-1.5 text-[11.5px] text-content-subtle">
              Tokens, signatures, auth headers and other credential-shaped
              fields are redacted before this payload leaves the server.
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
