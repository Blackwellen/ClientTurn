"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import { INDUSTRIES, TIMEZONES, timezoneLabel } from "@/lib/settings/types";
import { LogoUploader } from "./logo-uploader";

export type IdentityDraft = {
  name: string;
  industry: string;
  website: string;
  phone: string;
  timezone: string;
};

export function BusinessIdentityCard({
  draft,
  onChange,
  readOnly,
  logoUrl,
  hasLogo,
  onLogoChange,
  errors,
}: {
  draft: IdentityDraft;
  onChange: (next: Partial<IdentityDraft>) => void;
  readOnly: boolean;
  logoUrl: string | null;
  hasLogo: boolean;
  onLogoChange: (previewUrl: string | null) => void;
  errors: Partial<Record<keyof IdentityDraft, string>>;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Business identity"
          description="This information appears in your messages and booking links."
        />
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <LogoUploader
            businessName={draft.name}
            logoUrl={logoUrl}
            hasLogo={hasLogo}
            readOnly={readOnly}
            onLogoChange={onLogoChange}
          />

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Business name"
                htmlFor="ws-name"
                required
                error={errors.name}
              >
                <Input
                  id="ws-name"
                  value={draft.name}
                  required
                  maxLength={120}
                  disabled={readOnly}
                  aria-invalid={Boolean(errors.name) || undefined}
                  onChange={(event) => onChange({ name: event.target.value })}
                />
              </FormField>

              <FormField label="Industry" htmlFor="ws-industry">
                <Select
                  id="ws-industry"
                  value={draft.industry}
                  disabled={readOnly}
                  onChange={(event) => onChange({ industry: event.target.value })}
                >
                  <option value="">Not set</option>
                  {INDUSTRIES.map((industry) => (
                    <option key={industry} value={industry}>
                      {industry}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Website" htmlFor="ws-website" error={errors.website}>
                <Input
                  id="ws-website"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={draft.website}
                  disabled={readOnly}
                  aria-invalid={Boolean(errors.website) || undefined}
                  onChange={(event) => onChange({ website: event.target.value })}
                />
              </FormField>

              <FormField label="Phone" htmlFor="ws-phone" error={errors.phone}>
                <Input
                  id="ws-phone"
                  type="tel"
                  inputMode="tel"
                  value={draft.phone}
                  disabled={readOnly}
                  aria-invalid={Boolean(errors.phone) || undefined}
                  onChange={(event) => onChange({ phone: event.target.value })}
                />
              </FormField>
            </div>

            <FormField
              label="Timezone"
              htmlFor="ws-timezone"
              hint="Business hours, quiet hours, follow-up and reactivation scheduling all follow this timezone."
            >
              <Select
                id="ws-timezone"
                value={draft.timezone}
                disabled={readOnly}
                onChange={(event) => onChange({ timezone: event.target.value })}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {timezoneLabel(zone)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
