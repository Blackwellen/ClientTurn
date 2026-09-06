"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { ReadOnlyNotice } from "@/components/settings/notices";
import { SettingsSaveBar } from "@/components/settings/settings-save-bar";
import { saveWorkspaceSettings } from "@/lib/settings/actions";
import {
  type BusinessHours,
  type BusinessProfile,
  type DayKey,
  type ServiceRow,
} from "@/lib/settings/types";
import {
  BusinessIdentityCard,
  type IdentityDraft,
} from "./business-identity-card";
import { BusinessHoursEditor } from "./business-hours-editor";
import { ServiceAreaField } from "./service-area-field";
import { ServicesTable } from "./services-table";
import { WorkspacePreview, WorkspaceTips } from "./workspace-preview";

type Draft = IdentityDraft & {
  serviceArea: string;
  hours: BusinessHours;
};

function buildDraft(profile: BusinessProfile, serviceArea: string, hours: BusinessHours): Draft {
  return {
    name: profile.name,
    industry: profile.industry ?? "",
    website: profile.website ?? "",
    phone: profile.phone ?? "",
    timezone: profile.timezone,
    serviceArea,
    hours,
  };
}

function validate(draft: Draft) {
  const errors: Partial<Record<keyof IdentityDraft | "serviceArea", string>> = {};

  if (draft.name.trim().length < 2) {
    errors.name = "Enter your business name.";
  }
  if (
    draft.website.trim() &&
    !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(draft.website.trim())
  ) {
    errors.website = "Enter a full web address, starting with https://";
  }
  if (draft.phone.trim() && !/^[+0-9 ()-]{7,30}$/.test(draft.phone.trim())) {
    errors.phone = "Enter a valid contact number.";
  }
  if (draft.serviceArea.length > 500) {
    errors.serviceArea = "Keep the service area under 500 characters.";
  }
  return errors;
}

/**
 * Settings → Workspace. Identity, hours and service area form one draft with
 * one save bar; services commit individually because they are their own
 * records. See `saveWorkspaceSettings` for the server-side counterpart, which
 * revalidates every rule again.
 */
export function WorkspaceSettings({
  profile,
  serviceAreaDescription,
  businessHours,
  services,
  canManage,
  children,
}: {
  profile: BusinessProfile;
  serviceAreaDescription: string | null;
  businessHours: BusinessHours;
  services: ServiceRow[];
  canManage: boolean;
  /** Messaging, booking and danger-zone cards, rendered under Services so
   *  they keep the same column and width as the rest of Workspace. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const initial = React.useMemo(
    () => buildDraft(profile, serviceAreaDescription ?? "", businessHours),
    [profile, serviceAreaDescription, businessHours],
  );

  const [draft, setDraft] = React.useState<Draft>(initial);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<
    Partial<Record<keyof IdentityDraft | "serviceArea", string>>
  >({});

  const dirty = React.useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initial),
    [draft, initial],
  );

  const readOnly = !canManage;

  function update(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function updateDay(day: DayKey, value: BusinessHours[DayKey]) {
    setDraft((current) => ({
      ...current,
      hours: { ...current.hours, [day]: value },
    }));
  }

  function onDiscard() {
    setDraft(initial);
    setErrors({});
  }

  async function onSave() {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast({
        variant: "error",
        title: "Changes not saved",
        description: "Fix the highlighted fields and try again.",
      });
      return;
    }

    setSaving(true);
    const result = await saveWorkspaceSettings({
      name: draft.name,
      industry: draft.industry,
      website: draft.website,
      phone: draft.phone,
      timezone: draft.timezone,
      serviceAreaDescription: draft.serviceArea,
      businessHours: draft.hours,
    });
    setSaving(false);

    if (result.ok) {
      toast({ variant: "success", title: "Workspace settings saved" });
      router.refresh();
    } else {
      toast({
        variant: "error",
        title: "Changes not saved",
        description: result.error,
      });
    }
  }

  const previewLogo = logoPreview ?? profile.logoUrl;

  return (
    <div className="space-y-4">
      {readOnly && (
        <ReadOnlyNotice message="Only an owner or admin can change workspace settings." />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <BusinessIdentityCard
            draft={draft}
            onChange={update}
            readOnly={readOnly}
            logoUrl={previewLogo}
            hasLogo={Boolean(profile.logoKey) || Boolean(logoPreview)}
            onLogoChange={setLogoPreview}
            errors={errors}
          />

          <BusinessHoursEditor
            hours={draft.hours}
            onChange={updateDay}
            readOnly={readOnly}
          />

          <ServiceAreaField
            value={draft.serviceArea}
            onChange={(serviceArea) => update({ serviceArea })}
            readOnly={readOnly}
            error={errors.serviceArea}
          />

          <ServicesTable services={services} canManage={canManage} />

          {children}
        </div>

        <aside className="space-y-4" aria-label="Workspace preview and tips">
          <WorkspacePreview
            name={draft.name}
            industry={draft.industry}
            phone={draft.phone}
            website={draft.website}
            serviceArea={draft.serviceArea}
            hours={draft.hours}
            logoUrl={previewLogo}
          />
          <WorkspaceTips />
        </aside>
      </div>

      {canManage && (
        <SettingsSaveBar
          dirty={dirty}
          saving={saving}
          onDiscard={onDiscard}
          onSave={onSave}
        />
      )}
    </div>
  );
}
