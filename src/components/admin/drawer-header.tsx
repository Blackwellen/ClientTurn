"use client";

import * as React from "react";
import { X } from "lucide-react";
import { DrawerHeader } from "@/components/ui/drawer";
import { IconButton } from "@/components/ui/button";

/**
 * Header for an admin drawer that supplies its own title block. The Drawer
 * primitive renders a custom `header` as-is, so the subscription, provider,
 * job and policy drawers had no padding, no divider and no close button: the
 * title sat flush against the top-left edge and Escape was the only way out.
 */
export function AdminDrawerHeader({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <DrawerHeader>
      <div className="min-w-0 flex-1">{children}</div>
      <IconButton size="sm" label="Close panel" onClick={onClose}>
        <X className="size-4" />
      </IconButton>
    </DrawerHeader>
  );
}
