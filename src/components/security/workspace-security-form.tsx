"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Select, Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveWorkspaceSecurityPolicy } from "@/lib/auth/mfa-actions";
import {
  AUDIT_RETENTION_OPTIONS,
  IDLE_TIMEOUT_OPTIONS,
} from "@/lib/auth/security-policy";

function idleLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function monthsLabel(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "12 months (default)" : `${years} years`;
  }
  return `${months} months`;
}

/**
 * Settings -> Security -> Workspace policy. Owner-only; everyone else sees
 * the current values read-only. `saveWorkspaceSecurityPolicy` re-checks the
 * role and the plan cap on the server.
 */
export function WorkspaceSecurityForm({
  canEdit,
  initial,
  retentionCapMonths,
  ownerHasFactor,
  settingsAvailable,
}: {
  canEdit: boolean;
  initial: { requireMfa: boolean; idleTimeoutMinutes: number | null; auditRetentionMonths: number };
  retentionCapMonths: number;
  ownerHasFactor: boolean;
  settingsAvailable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [requireMfa, setRequireMfa] = React.useState(initial.requireMfa);
  const [idle, setIdle] = React.useState<string>(
    initial.idleTimeoutMinutes ? String(initial.idleTimeoutMinutes) : "off",
  );
  const [retention, setRetention] = React.useState(String(initial.auditRetentionMonths));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const disabled = !canEdit || !settingsAvailable;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await saveWorkspaceSecurityPolicy({
        requireMfa,
        idleTimeoutMinutes: idle === "off" ? null : Number(idle),
        auditRetentionMonths: Number(retention),
      });
      if (result.ok) {
        toast({ variant: "success", title: "Security settings saved" });
        router.refresh();
      } else setError(result.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-content-muted" aria-hidden />
            Workspace policy
          </CardTitle>
          <CardDescription>
            Applies to every member of this workspace and is enforced on the server.
            {canEdit ? "" : " Only the workspace owner can change it."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!settingsAvailable ? (
          <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-[12.5px] text-content-muted">
            Workspace security settings are being switched on for your account. Until then two-factor
            stays optional and the audit log keeps the standard 12 months.
          </p>
        ) : null}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-content">Require two-factor for all members</p>
            <p className="text-[12.5px] text-content-muted">
              Members without an authenticator are asked to set one up before they can use the app.
              {canEdit && !ownerHasFactor ? " Set up two-factor on your own account first." : ""}
            </p>
          </div>
          <Switch
            label="Require two-factor for all members"
            checked={requireMfa}
            disabled={disabled || (!ownerHasFactor && !requireMfa)}
            onCheckedChange={setRequireMfa}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Sign out after inactivity"
            htmlFor="security-idle"
            hint="Members are signed out on this device after this long without using ClientTurn."
          >
            <Select
              id="security-idle"
              value={idle}
              disabled={disabled}
              onChange={(event) => setIdle(event.target.value)}
            >
              <option value="off">Never (stay signed in)</option>
              {IDLE_TIMEOUT_OPTIONS.map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {idleLabel(minutes)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Keep audit log for"
            htmlFor="security-retention"
            hint={
              retentionCapMonths > 12
                ? `Your plan allows up to ${monthsLabel(retentionCapMonths).replace(" (default)", "")}. Older entries are deleted daily.`
                : "Longer retention is available on Pro and Enterprise. Older entries are deleted daily."
            }
          >
            <Select
              id="security-retention"
              value={retention}
              disabled={disabled}
              onChange={(event) => setRetention(event.target.value)}
            >
              {AUDIT_RETENTION_OPTIONS.filter((months) => months <= retentionCapMonths).map((months) => (
                <option key={months} value={String(months)}>
                  {monthsLabel(months)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {error ? (
          <p role="alert" className="text-[12.5px] text-danger-600">
            {error}
          </p>
        ) : null}

        {canEdit ? (
          <Button size="sm" loading={saving} disabled={!settingsAvailable} onClick={save}>
            Save policy
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
