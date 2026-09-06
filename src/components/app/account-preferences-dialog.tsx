"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Switch } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import {
  loadAccountPreferences,
  requestOwnPasswordReset,
  updateNotificationPreferences,
  updateProfile,
  type AccountPreferences,
} from "@/lib/settings/actions";

const NOTIFICATIONS: {
  key: keyof AccountPreferences["notifications"];
  label: string;
  description: string;
}[] = [
  {
    key: "handover",
    label: "Human handover",
    description: "Get notified when a lead needs human handover.",
  },
  {
    key: "booking",
    label: "New booking",
    description: "Get notified when a new booking is confirmed.",
  },
  {
    key: "integrationFailure",
    label: "Integration failure",
    description: "Get notified if any of your integrations stop working.",
  },
  {
    key: "campaignComplete",
    label: "Campaign complete",
    description: "Get notified when a campaign has finished sending.",
  },
  {
    key: "dailySummary",
    label: "Daily summary",
    description: "Receive a daily summary of your leads and results.",
  },
];

/**
 * Account preferences open over whatever page the user is on — there is no
 * standalone profile page. Notification switches are workspace-level, because
 * that is what the notification pipeline reads; a member therefore sees them
 * read-only rather than being offered a control that would be refused.
 */
export function AccountPreferencesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [data, setData] = React.useState<AccountPreferences | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<AccountPreferences | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The component is mounted fresh each time it opens (see AppShell), so this
  // only ever subscribes to the load — it never resets state synchronously.
  React.useEffect(() => {
    let cancelled = false;

    void loadAccountPreferences().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setDraft(result.data);
      } else {
        setLoadError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave() {
    if (!draft || !data) return;
    setSaving(true);
    setError(null);

    const profileChanged =
      draft.firstName !== data.firstName || draft.lastName !== data.lastName;
    const notificationsChanged =
      JSON.stringify(draft.notifications) !== JSON.stringify(data.notifications);

    if (profileChanged) {
      const result = await updateProfile({
        firstName: draft.firstName,
        lastName: draft.lastName,
        phone: draft.phone,
      });
      if (!result.ok) {
        setSaving(false);
        setError(result.error);
        return;
      }
    }

    if (notificationsChanged && draft.canEditNotifications) {
      const result = await updateNotificationPreferences(draft.notifications);
      if (!result.ok) {
        setSaving(false);
        setError(result.error);
        return;
      }
    }

    setSaving(false);
    setData(draft);
    toast({ variant: "success", title: "Account preferences saved" });
    onClose();
    router.refresh();
  }

  async function onResetPassword() {
    setResetting(true);
    const result = await requestOwnPasswordReset();
    setResetting(false);

    if (result.ok) {
      toast({
        variant: "success",
        title: "Password reset email sent",
        description: "Check your inbox for the link.",
      });
    } else {
      toast({
        variant: "error",
        title: "Reset email not sent",
        description: result.error,
      });
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      size="lg"
      title="Account preferences"
      description="Manage your account details and notification preferences."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" loading={saving} disabled={!draft} onClick={onSave}>
            Save changes
          </Button>
        </>
      }
    >
      {loadError ? (
        <p role="alert" className="text-[13px] text-danger-600">
          {loadError}
        </p>
      ) : !draft ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 md:gap-0 md:divide-x md:divide-line">
          <div className="space-y-4 md:pr-6">
            <h3 className="text-[15px] font-semibold text-content">
              Personal details
            </h3>

            <FormField label="First name" htmlFor="account-first-name" required>
              <Input
                id="account-first-name"
                required
                maxLength={80}
                value={draft.firstName}
                aria-invalid={Boolean(error) || undefined}
                onChange={(event) =>
                  setDraft({ ...draft, firstName: event.target.value })
                }
              />
            </FormField>

            <FormField label="Last name" htmlFor="account-last-name" required>
              <Input
                id="account-last-name"
                required
                maxLength={80}
                value={draft.lastName}
                aria-invalid={Boolean(error) || undefined}
                onChange={(event) =>
                  setDraft({ ...draft, lastName: event.target.value })
                }
              />
            </FormField>

            <FormField
              label="Email address"
              htmlFor="account-email"
              hint="To change your email address, please contact support."
            >
              <Input id="account-email" value={draft.email} readOnly disabled />
            </FormField>

            <div className="space-y-2 border-t border-line-subtle pt-4">
              <h3 className="text-[15px] font-semibold text-content">Password</h3>
              <p className="text-[13px] text-content-muted">
                Reset your password to keep your account secure.
              </p>
              <Button
                size="sm"
                variant="secondary"
                loading={resetting}
                onClick={onResetPassword}
              >
                <Lock className="size-3.5" aria-hidden />
                Reset password
              </Button>
            </div>

            {error && (
              <p role="alert" className="text-[13px] text-danger-600">
                {error}
              </p>
            )}
          </div>

          <div className="space-y-1 md:pl-6">
            <h3 className="text-[15px] font-semibold text-content">
              Notification preferences
            </h3>
            <p className="pb-1 text-[13px] text-content-muted">
              Choose what you would like to be notified about.
            </p>

            {!draft.canEditNotifications && (
              <p className="mb-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-[12px] text-content-muted">
                Notification settings apply to the whole workspace, so only an
                owner or admin can change them.
              </p>
            )}

            <ul className="divide-y divide-line-subtle">
              {NOTIFICATIONS.map((item) => (
                <li
                  key={item.key}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-content">
                      {item.label}
                    </p>
                    <p className="text-[13px] text-content-muted">
                      {item.description}
                    </p>
                  </div>
                  <Switch
                    label={item.label}
                    checked={draft.notifications[item.key]}
                    disabled={!draft.canEditNotifications}
                    onCheckedChange={(checked) =>
                      setDraft({
                        ...draft,
                        notifications: {
                          ...draft.notifications,
                          [item.key]: checked,
                        },
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
