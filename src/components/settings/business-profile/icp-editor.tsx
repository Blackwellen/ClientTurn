"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { IcpProfileRow } from "@/lib/business-profile/types";
import { saveIcpProfile } from "@/lib/business-profile/actions";

/**
 * Create or edit an ideal customer profile.
 *
 * Lists are entered as comma-separated text rather than as tag widgets: this is
 * a settings form filled in once, and a plain field is faster to type into and
 * easier to paste a list into than a chip editor.
 */
export function IcpEditor({
  profile,
  onClose,
}: {
  profile: IcpProfileRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");

  const [name, setName] = React.useState(profile?.name ?? "");
  const [description, setDescription] = React.useState(profile?.description ?? "");
  const [industries, setIndustries] = React.useState((profile?.industries ?? []).join(", "));
  const [locations, setLocations] = React.useState((profile?.locations ?? []).join(", "));
  const [roles, setRoles] = React.useState((profile?.roles ?? []).join(", "));
  const [employeeMin, setEmployeeMin] = React.useState(
    profile?.companyFilters.employeeMin?.toString() ?? "",
  );
  const [employeeMax, setEmployeeMax] = React.useState(
    profile?.companyFilters.employeeMax?.toString() ?? "",
  );

  const parseList = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  function submit() {
    startTransition(async () => {
      const result = await saveIcpProfile({
        id: profile?.id ?? "",
        name,
        description,
        industries: parseList(industries),
        locations: parseList(locations),
        roles: parseList(roles),
        employeeMin: employeeMin === "" ? null : Number(employeeMin),
        employeeMax: employeeMax === "" ? null : Number(employeeMax),
      });

      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-accent-200/60 bg-accent-50/30 p-4">
      <h3 className="text-[13px] font-semibold text-content">
        {profile ? "Edit profile" : "New customer profile"}
      </h3>

      <div className="mt-3 space-y-3">
        <Field label="Name">
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. South coast property managers"
            className={INPUT}
          />
        </Field>

        <Field label="Description" hint="Optional. Who is this, in your own words?">
          <textarea
            value={description}
            maxLength={400}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            className={INPUT}
          />
        </Field>

        <Field
          label="Industries"
          hint="Comma-separated. Common industry names match provider vocabularies better than your internal terms."
        >
          <input
            value={industries}
            onChange={(event) => setIndustries(event.target.value)}
            placeholder="Property management, Facilities management"
            className={INPUT}
          />
        </Field>

        <Field label="Locations" hint="Comma-separated towns, counties or countries.">
          <input
            value={locations}
            onChange={(event) => setLocations(event.target.value)}
            placeholder="Bournemouth, Poole, Dorset"
            className={INPUT}
          />
        </Field>

        <Field label="Decision makers" hint="The job titles worth reaching.">
          <input
            value={roles}
            onChange={(event) => setRoles(event.target.value)}
            placeholder="Property Manager, Facilities Manager, Operations Director"
            className={INPUT}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Smallest company" hint="Employees. Leave blank for no minimum.">
            <input
              type="number"
              min={0}
              value={employeeMin}
              onChange={(event) => setEmployeeMin(event.target.value)}
              className={INPUT}
            />
          </Field>
          <Field label="Largest company" hint="Employees. Leave blank for no maximum.">
            <input
              type="number"
              min={0}
              value={employeeMax}
              onChange={(event) => setEmployeeMax(event.target.value)}
              className={INPUT}
            />
          </Field>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button size="sm" loading={pending} onClick={submit} disabled={!name.trim()}>
          {profile ? "Save changes" : "Create profile"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const INPUT = cn(
  "w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-content",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
);

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-content-muted">{hint}</p>}
    </div>
  );
}
