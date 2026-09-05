"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { adminSignOut } from "@/lib/admin/actions";

export function AdminProfileMenu({
  name,
  email,
}: {
  name: string;
  email: string;
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
          <Avatar name={name} size="md" />
        </button>
      }
    >
      <div className="px-3 pb-2 pt-1.5">
        <p className="truncate text-[13px] font-semibold text-content">{name}</p>
        <p className="truncate text-[12px] text-content-muted">{email}</p>
      </div>
      <DropdownSeparator />

      <DropdownItem
        icon={LogOut}
        destructive
        onSelect={async () => {
          const result = await adminSignOut();
          router.push(result.ok && result.redirectTo ? result.redirectTo : "/admin/login");
          router.refresh();
        }}
      >
        Sign out
      </DropdownItem>
    </DropdownMenu>
  );
}
