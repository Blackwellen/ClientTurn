"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inviteMember } from "@/lib/settings/actions";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/settings/types";

export function InviteMemberDialog({
  open,
  onClose,
  atSeatLimit,
  seatLimit,
  planName,
}: {
  open: boolean;
  onClose: () => void;
  atSeatLimit: boolean;
  seatLimit: number;
  planName: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await inviteMember({ email, role });
    setPending(false);

    if (result.ok) {
      toast({
        variant: "success",
        title: "Invitation sent",
        description: "They appear as Invited until they accept.",
      });
      onClose();
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a team member"
      description="They receive an email invitation and appear in the table straight away."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            form="invite-member-form"
            loading={pending}
            disabled={atSeatLimit}
          >
            Send invite
          </Button>
        </>
      }
    >
      {atSeatLimit ? (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-content">
            Every seat on your plan is in use
          </p>
          <p className="text-[13px] text-content-muted">
            Your {planName} plan includes {seatLimit}{" "}
            {seatLimit === 1 ? "user" : "users"}. Upgrade, or remove someone, to
            invite another person.
          </p>
          <Link
            href="/app/settings?section=billing"
            className="inline-block rounded-xs text-[13px] font-medium text-content-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
          >
            Compare plans
          </Link>
        </div>
      ) : (
        <form id="invite-member-form" onSubmit={onSubmit} className="space-y-4">
          <FormField
            label="Email address"
            htmlFor="invite-email"
            required
            error={error ?? undefined}
          >
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              required
              value={email}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>

          <FormField
            label="Role"
            htmlFor="invite-role"
            hint={ROLE_DESCRIPTIONS[role as keyof typeof ROLE_DESCRIPTIONS]}
          >
            <Select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {ASSIGNABLE_ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
          </FormField>

          <p className="text-[12px] text-content-subtle">
            Ownership cannot be granted by invitation. Only the current owner can
            transfer it.
          </p>
        </form>
      )}
    </Modal>
  );
}
