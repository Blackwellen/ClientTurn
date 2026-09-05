"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Image as ImageIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/form";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import {
  createLogoUploadUrl,
  removeBusinessLogo,
  saveBusinessLogo,
  updateBusinessProfile,
} from "@/lib/settings/actions";
import {
  INDUSTRIES,
  TIMEZONES,
  type BusinessProfile,
} from "@/lib/settings/types";

export function BusinessForm({
  profile,
  readOnly,
}: {
  profile: BusinessProfile;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [values, setValues] = React.useState({
    name: profile.name,
    industry: profile.industry ?? "",
    website: profile.website ?? "",
    phone: profile.phone ?? "",
    timezone: profile.timezone,
  });
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  function set<K extends keyof typeof values>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await updateBusinessProfile(values);
    setSaving(false);

    if (result.ok) {
      toast({ variant: "success", title: "Business details saved" });
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function onLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    const prepared = await createLogoUploadUrl({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    });

    if (!prepared.ok) {
      setUploading(false);
      toast({ variant: "error", title: "Logo not uploaded", description: prepared.error });
      return;
    }

    try {
      const response = await fetch(prepared.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!response.ok) throw new Error("upload failed");
    } catch {
      setUploading(false);
      toast({
        variant: "error",
        title: "Logo not uploaded",
        description: "The file could not be sent. Check your connection and try again.",
      });
      return;
    }

    const saved = await saveBusinessLogo(prepared.key);
    setUploading(false);

    if (saved.ok) {
      toast({ variant: "success", title: "Logo updated" });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Logo not saved", description: saved.error });
    }
  }

  async function onLogoRemove() {
    setUploading(true);
    const result = await removeBusinessLogo();
    setUploading(false);
    if (result.ok) {
      toast({ variant: "success", title: "Logo removed" });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Logo not removed", description: result.error });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-surface border-line rounded-xl border px-4 py-3 shadow-xs">
          <StatCard label="Industry" value={values.industry || "Not set"} />
        </div>
        <div className="bg-surface border-line rounded-xl border px-4 py-3 shadow-xs">
          <StatCard label="Timezone" value={values.timezone} />
        </div>
        <div className="bg-surface border-line rounded-xl border px-4 py-3 shadow-xs">
          <StatCard label="Website" value={values.website || "Not set"} />
        </div>
        <div className="bg-surface border-line rounded-xl border px-4 py-3 shadow-xs">
          <StatCard label="Logo" value={profile.logoKey ? "Uploaded" : "Not set"} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Building2}
            title="Business details"
            description="Used on your messages, your booking pages and your invoices."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Business name" htmlFor="business-name" required>
            <Input
              id="business-name"
              name="name"
              value={values.name}
              disabled={readOnly}
              required
              maxLength={120}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => set("name", event.target.value)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Industry" htmlFor="business-industry">
              <Select
                id="business-industry"
                name="industry"
                value={values.industry}
                disabled={readOnly}
                onChange={(event) => set("industry", event.target.value)}
              >
                <option value="">Not set</option>
                {INDUSTRIES.map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Timezone"
              htmlFor="business-timezone"
              hint="Quiet hours and business hours follow this timezone."
            >
              <Select
                id="business-timezone"
                name="timezone"
                value={values.timezone}
                disabled={readOnly}
                onChange={(event) => set("timezone", event.target.value)}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Website" htmlFor="business-website">
              <Input
                id="business-website"
                name="website"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={values.website}
                disabled={readOnly}
                onChange={(event) => set("website", event.target.value)}
              />
            </FormField>

            <FormField label="Contact number" htmlFor="business-phone">
              <Input
                id="business-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                value={values.phone}
                disabled={readOnly}
                onChange={(event) => set("phone", event.target.value)}
              />
            </FormField>
          </div>

          {error && (
            <p role="alert" className="text-danger-600 text-[13px]">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" size="sm" loading={saving} disabled={readOnly}>
            Save changes
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={ImageIcon}
            title="Logo"
            description="PNG, JPG, WebP or SVG, up to 10MB."
          />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="border-line bg-surface-sunken flex size-14 items-center justify-center overflow-hidden rounded-xl border">
              {profile.logoUrl ? (
                // Logos are served from short-lived R2 signed URLs, so next/image
                // optimisation cannot cache them.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.logoUrl}
                  alt={`${profile.name} logo`}
                  className="size-full object-contain"
                />
              ) : (
                <Building2 className="text-content-muted size-5" aria-hidden />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                aria-label="Upload a logo"
                onChange={onLogoChange}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={uploading}
                disabled={readOnly}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-3.5" aria-hidden />
                {profile.logoKey ? "Replace logo" : "Upload logo"}
              </Button>
              {profile.logoKey && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-danger-600 hover:bg-danger-50"
                  disabled={readOnly || uploading}
                  onClick={onLogoRemove}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
