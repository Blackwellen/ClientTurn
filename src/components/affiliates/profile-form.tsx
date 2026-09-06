"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateProfile } from "@/lib/affiliates/actions";

/** Contact details. The referral code is not editable and is not on this form. */
export function ProfileForm({
  displayName,
  contactEmail,
  companyName = "",
  websiteUrl = "",
  country = "",
}: {
  displayName: string;
  contactEmail: string;
  companyName?: string;
  websiteUrl?: string;
  country?: string;
}) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [values, setValues] = React.useState({
    displayName,
    contactEmail,
    companyName,
    websiteUrl,
    country,
  });

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="space-y-3 px-4 py-4 sm:px-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        try {
          const result = await updateProfile(values);
          toast(
            result.ok
              ? { variant: "success", title: result.message ?? "Saved." }
              : { variant: "error", title: result.error },
          );
        } catch {
          toast({ variant: "error", title: "That could not be saved." });
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required value={values.displayName} onChange={set("displayName")} />
        <Field
          label="Contact email"
          type="email"
          required
          value={values.contactEmail}
          onChange={set("contactEmail")}
        />
        <Field label="Company" value={values.companyName} onChange={set("companyName")} />
        <Field
          label="Website"
          placeholder="https://"
          value={values.websiteUrl}
          onChange={set("websiteUrl")}
        />
        <Field label="Country" value={values.country} onChange={set("country")} />
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending}>
          Save details
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-content-secondary">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-line bg-surface px-3 text-[13px] text-content outline-none transition-colors placeholder:text-content-subtle focus:border-line-strong"
      />
    </label>
  );
}
