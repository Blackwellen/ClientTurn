"use client";

import * as React from "react";
import { Building2, ChevronDown, Lock, LogOut, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import { signOut } from "@/lib/auth/actions";
import { requestOwnPasswordReset } from "@/lib/settings/actions";

/**
 * The account entry point. There is no standalone profile page — account
 * preferences open as a dialog over whatever the user is already looking at.
 */
export function ProfilePopover({
  name,
  email,
  avatarUrl,
  businessName,
  planLabel,
  onOpenAccount,
}: {
  name: string;
  email: string;
  avatarUrl?: string | null;
  businessName: string;
  planLabel: string;
  onOpenAccount: () => void;
}) {
  const { toast } = useToast();

  async function onResetPassword() {
    const result = await requestOwnPasswordReset();
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
    <DropdownMenu
      align="end"
      className="min-w-[286px] mt-2.5"
      trigger={
        <button
          type="button"
          aria-label="Account menu"
          className="flex items-center gap-1 rounded-full pr-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
        >
          <Avatar name={name} src={avatarUrl} size="md" />
          <ChevronDown className="size-4 text-content-muted" aria-hidden />
        </button>
      }
    >
      {/* Pointer back to the avatar, matching the reference popover. */}
      <span
        aria-hidden
        className="absolute -top-1.5 right-4 size-3 rotate-45 rounded-[2px] border-l border-t border-line bg-surface-raised"
      />

      <div className="relative flex items-center gap-3 px-3.5 pb-3 pt-2.5">
        <Avatar name={name} src={avatarUrl} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-content">
            {name}
          </p>
          <p className="truncate text-[12px] text-content-muted">{email}</p>
        </div>
      </div>

      <DropdownSeparator />

      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken">
          <Building2 className="size-4 text-content-muted" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-content">
            {businessName}
          </p>
          <p className="truncate text-[12px] text-content-muted">{planLabel}</p>
        </div>
      </div>

      <DropdownSeparator />

      <DropdownItem
        icon={Settings}
        className="px-3.5 py-2 text-[13px]"
        onSelect={onOpenAccount}
      >
        Account preferences
      </DropdownItem>
      <DropdownItem
        icon={Lock}
        className="px-3.5 py-2 text-[13px]"
        onSelect={() => {
          void onResetPassword();
        }}
      >
        Reset password
      </DropdownItem>

      <DropdownSeparator />

      <DropdownItem
        icon={LogOut}
        className="px-3.5 py-2 text-[13px]"
        onSelect={() => {
          void signOut();
        }}
      >
        Sign out
      </DropdownItem>
    </DropdownMenu>
  );
}
