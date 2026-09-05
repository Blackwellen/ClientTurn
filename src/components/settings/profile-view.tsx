"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Lock, User } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Input, Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import {
  changePassword,
  updateNotificationPreferences,
  updateProfile,
} from "@/lib/settings/actions";
import {
  ROLE_LABELS,
  type BusinessRole,
  type NotificationPreferences,
  type ProfileView,
} from "@/lib/settings/types";

const NOTIFICATIONS: {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}[] = [
  {
    key: "handover",
    label: "Human handover needed",
    description: "A conversation needs a person, right now.",
  },
  {
    key: "booking",
    label: "New booking",
    description: "A qualified lead has booked a time.",
  },
  {
    key: "integrationFailure",
    label: "Integration failure",
    description: "A connection stopped working and leads or messages are at risk.",
  },
  {
    key: "campaignComplete",
    label: "Reactivation campaign finished",
    description: "A campaign has sent its last message.",
  },
  {
    key: "dailySummary",
    label: "Daily summary",
    description: "One email each morning with yesterday's numbers.",
  },
];

export function ProfileSettings({
  profile,
  role,
}: {
  profile: ProfileView;
  role: BusinessRole;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const fullName = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  const [details, setDetails] = React.useState({
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    phone: profile.phone ?? "",
  });
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const [savingDetails, setSavingDetails] = React.useState(false);

  const [passwords, setPasswords] = React.useState({
    currentPassword: "",
    password: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [savingPassword, setSavingPassword] = React.useState(false);

  const [preferences, setPreferences] = React.useState(profile.notifications);
  const [savingPreferences, setSavingPreferences] = React.useState(false);

  async function onSaveDetails(event: React.FormEvent) {
    event.preventDefault();
    setSavingDetails(true);
    setDetailsError(null);
    const result = await updateProfile(details);
    setSavingDetails(false);

    if (result.ok) {
      toast({ variant: "success", title: "Profile saved" });
      router.refresh();
    } else {
      setDetailsError(result.error);
    }
  }

  async function onChangePassword(event: React.FormEvent) {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordError(null);
    const result = await changePassword(passwords);
    setSavingPassword(false);

    if (result.ok) {
      setPasswords({ currentPassword: "", password: "", confirmPassword: "" });
      toast({ variant: "success", title: "Password changed" });
    } else {
      setPasswordError(result.error);
    }
  }

  async function onSavePreferences(next: NotificationPreferences) {
    setPreferences(next);
    setSavingPreferences(true);
    const result = await updateNotificationPreferences(next);
    setSavingPreferences(false);

    if (!result.ok) {
      setPreferences(profile.notifications);
      toast({
        variant: "error",
        title: "Preferences not saved",
        description: result.error,
      });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center gap-4">
          <Avatar name={fullName || profile.email} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-content truncate text-[15px] font-semibold">
              {fullName || "Unnamed"}
            </p>
            <p className="text-content-muted truncate text-[13px]">
              {profile.email}
            </p>
          </div>
          <Badge tone="accent">{ROLE_LABELS[role]}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            title={
              <span className="flex items-center gap-2">
                <User className="text-content-muted size-4" aria-hidden />
                Your details
              </span>
            }
            description="Used to identify you inside the workspace and on assigned leads."
          />
        </CardHeader>
        <form onSubmit={onSaveDetails}>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="First name" htmlFor="first-name" required>
                <Input
                  id="first-name"
                  required
                  maxLength={80}
                  value={details.firstName}
                  aria-invalid={Boolean(detailsError) || undefined}
                  onChange={(event) =>
                    setDetails({ ...details, firstName: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Last name" htmlFor="last-name" required>
                <Input
                  id="last-name"
                  required
                  maxLength={80}
                  value={details.lastName}
                  aria-invalid={Boolean(detailsError) || undefined}
                  onChange={(event) =>
                    setDetails({ ...details, lastName: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Contact number" htmlFor="profile-phone">
                <Input
                  id="profile-phone"
                  type="tel"
                  inputMode="tel"
                  value={details.phone}
                  onChange={(event) =>
                    setDetails({ ...details, phone: event.target.value })
                  }
                />
              </FormField>
              <FormField
                label="Email address"
                htmlFor="profile-email"
                hint="Contact support to change the email you sign in with."
              >
                <Input id="profile-email" value={profile.email} disabled readOnly />
              </FormField>
            </div>

            {detailsError && (
              <p role="alert" className="text-danger-600 text-[13px]">
                {detailsError}
              </p>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" size="sm" loading={savingDetails}>
              Save details
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            title={
              <span className="flex items-center gap-2">
                <Lock className="text-content-muted size-4" aria-hidden />
                Password
              </span>
            }
            description="At least 8 characters, including a letter and a number."
          />
        </CardHeader>
        <form onSubmit={onChangePassword}>
          <CardContent className="space-y-4">
            <FormField label="Current password" htmlFor="current-password" required>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={passwords.currentPassword}
                aria-invalid={Boolean(passwordError) || undefined}
                onChange={(event) =>
                  setPasswords({ ...passwords, currentPassword: event.target.value })
                }
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="New password" htmlFor="new-password" required>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={passwords.password}
                  aria-invalid={Boolean(passwordError) || undefined}
                  onChange={(event) =>
                    setPasswords({ ...passwords, password: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Confirm new password" htmlFor="confirm-password" required>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={passwords.confirmPassword}
                  aria-invalid={Boolean(passwordError) || undefined}
                  onChange={(event) =>
                    setPasswords({ ...passwords, confirmPassword: event.target.value })
                  }
                />
              </FormField>
            </div>

            {passwordError && (
              <p role="alert" className="text-danger-600 text-[13px]">
                {passwordError}
              </p>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" size="sm" loading={savingPassword}>
              Change password
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            title={
              <span className="flex items-center gap-2">
                <Bell className="text-content-muted size-4" aria-hidden />
                Notifications
              </span>
            }
            description="What Client Turn alerts this workspace about."
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {!profile.canEditNotifications && (
            <div className="border-line bg-surface-sunken rounded-lg border px-3.5 py-3">
              <p className="text-content-muted text-[13px]">
                Only an owner or admin can change notification settings for
                this workspace.
              </p>
            </div>
          )}
          {NOTIFICATIONS.map((item) => (
            <div key={item.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-content text-[13px] font-medium">{item.label}</p>
                <p className="text-content-muted text-[13px]">{item.description}</p>
              </div>
              <Switch
                label={item.label}
                checked={preferences[item.key]}
                disabled={!profile.canEditNotifications || savingPreferences}
                onCheckedChange={(checked) =>
                  onSavePreferences({ ...preferences, [item.key]: checked })
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

    </div>
  );
}
