"use client";

import * as React from "react";
import { ExternalLink, Hand, SquarePen, UserPlus } from "lucide-react";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { useLeadParams } from "./use-lead-params";

/**
 * Deliberately short. The row menu is a shortcut into the drawer, not a second
 * home for every manual action — those live in one place, on the lead itself,
 * where the operator can see the state they are acting on. `leadFocus` tells
 * the drawer which control to scroll to and focus once it opens.
 */
export function LeadRowActions({
  leadId,
  leadName,
  onOpen,
  trigger,
}: {
  leadId: string;
  leadName: string;
  onOpen: () => void;
  trigger: React.ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    "aria-expanded"?: boolean;
    "aria-haspopup"?: string;
  }>;
}) {
  const { setParams } = useLeadParams();

  const focus = (target: string) =>
    setParams({ lead: leadId, leadFocus: target }, "push");

  return (
    // The menu sits inside a clickable card/row, so clicks are contained here —
    // otherwise choosing an item would also fire the card's own open handler.
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu trigger={trigger} align="end">
        <DropdownItem onSelect={onOpen} icon={ExternalLink}>
          Open lead
          <span className="sr-only"> {leadName}</span>
        </DropdownItem>
        <DropdownItem onSelect={() => focus("assign")} icon={UserPlus}>
          Assign
        </DropdownItem>
        <DropdownItem onSelect={() => focus("status")} icon={SquarePen}>
          Change status
        </DropdownItem>
        <DropdownItem onSelect={() => focus("takeover")} icon={Hand}>
          Human takeover
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}
