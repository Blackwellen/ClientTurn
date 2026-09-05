"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import { createAutomation } from "@/lib/automations/actions";
import {
  AUTOMATION_TYPE_META,
  type AutomationType,
} from "@/lib/automations/types";

export function CreateAutomationButton({
  available,
}: {
  available: AutomationType[];
}) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  if (available.length === 0) return null;

  async function create(type: AutomationType) {
    setPending(true);
    try {
      const result = await createAutomation({ type });
      if (result.ok) {
        toast({
          variant: "success",
          title: `${AUTOMATION_TYPE_META[type].label} created as a draft`,
        });
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu
      align="end"
      trigger={
        <Button size="sm" loading={pending}>
          <Plus className="size-3.5" />
          New automation
        </Button>
      }
    >
      <DropdownLabel>Available automation types</DropdownLabel>
      {available.map((type) => (
        <DropdownItem key={type} onSelect={() => create(type)}>
          {AUTOMATION_TYPE_META[type].label}
        </DropdownItem>
      ))}
    </DropdownMenu>
  );
}
