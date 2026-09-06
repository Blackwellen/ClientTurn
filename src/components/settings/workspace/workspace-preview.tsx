"use client";

import * as React from "react";
import {
  Building2,
  CircleCheck,
  Clock3,
  Globe,
  Lightbulb,
  MapPin,
  Phone,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/app/page-header";
import { summariseHours, type BusinessHours } from "@/lib/settings/types";

/** Rendered live from the draft, so it always shows what Save would store. */
export function WorkspacePreview({
  name,
  industry,
  phone,
  website,
  serviceArea,
  hours,
  logoUrl,
}: {
  name: string;
  industry: string;
  phone: string;
  website: string;
  serviceArea: string;
  hours: BusinessHours;
  logoUrl: string | null;
}) {
  const hourLines = summariseHours(hours);

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Workspace preview"
          description="Here is how your business appears in messages and booking links."
        />
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border border-line bg-surface-sunken/40 p-4">
          <div className="flex h-[72px] items-center justify-center">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="max-h-[64px] max-w-full object-contain"
              />
            ) : (
              <Building2 className="size-7 text-content-subtle" aria-hidden />
            )}
          </div>

          <p className="mt-3 text-[15px] font-semibold text-content">
            {name.trim() || "Your business name"}
          </p>
          {industry && (
            <p className="text-[13px] text-content-muted">{industry}</p>
          )}

          <dl className="mt-3.5 space-y-2.5 border-t border-line pt-3.5 text-[13px]">
            {phone.trim() && (
              <div className="flex items-start gap-2.5">
                <Phone className="mt-0.5 size-3.5 shrink-0 text-content-muted" aria-hidden />
                <dd className="min-w-0 break-words text-content">{phone}</dd>
              </div>
            )}
            {website.trim() && (
              <div className="flex items-start gap-2.5">
                <Globe className="mt-0.5 size-3.5 shrink-0 text-content-muted" aria-hidden />
                <dd className="min-w-0 break-all text-content-accent">
                  {website.replace(/^https?:\/\//, "")}
                </dd>
              </div>
            )}
            {serviceArea.trim() && (
              <div className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-content-muted" aria-hidden />
                <dd className="min-w-0 text-content">{serviceArea}</dd>
              </div>
            )}
            <div className="flex items-start gap-2.5">
              <Clock3 className="mt-0.5 size-3.5 shrink-0 text-content-muted" aria-hidden />
              <dd className="min-w-0 space-y-0.5 text-content">
                {hourLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

const TIPS = [
  "Keep your business information up to date so customers know how to reach you.",
  "Use a clear, high-quality square logo — it appears on booking links.",
  "Set accurate business hours so follow-up never lands out of hours.",
  "Be specific about your service area to attract better-qualified leads.",
  "Add every service you offer, with a typical value, to improve qualification.",
];

export function WorkspaceTips() {
  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Lightbulb}
          title="Quick tips"
        />
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {TIPS.map((tip) => (
            <li key={tip} className="flex items-start gap-2.5">
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-success-600"
                aria-hidden
              />
              <span className="text-[13px] leading-[1.5] text-content-secondary">
                {tip}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
