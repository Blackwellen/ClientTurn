"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { signOut } from "@/lib/auth/actions";

export function ProfileMenu({
  name,
  email,
  avatarUrl,
}: {
  name: string;
  email: string;
  avatarUrl?: string | null;
}) {
  const router = useRouter();

  return (
    <DropdownMenu
      align="end"
      trigger={
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
        >
          <Avatar name={name} src={avatarUrl} size="md" />
        </button>
      }
    >
      <div className="px-3 pb-2 pt-1.5">
        <p className="truncate text-[13px] font-semibold text-content">{name}</p>
        <p className="truncate text-[12px] text-content-muted">{email}</p>
      </div>
      <DropdownSeparator />

      <DropdownItem icon={Settings} onSelect={() => router.push("/app/settings")}>
        Settings
      </DropdownItem>

      <DropdownSeparator />
      <DropdownItem
        icon={LogOut}
        destructive
        onSelect={() => {
          void signOut();
        }}
      >
        Sign out
      </DropdownItem>
    </DropdownMenu>
  );
}
