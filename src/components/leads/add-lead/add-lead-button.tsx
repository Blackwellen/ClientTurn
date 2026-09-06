"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AddLeadContext } from "@/lib/leads/add-lead/queries";
import { useLeadParams } from "../use-lead-params";
import { AddLeadWizard } from "./add-lead-wizard";

/**
 * The "+ Add lead" control in the Leads page header and the wizard it owns.
 *
 * Kept together so focus can be returned to this exact button when the modal
 * closes, and so the Leads page itself stays a Server Component — the modal is
 * state on this page, never a route of its own.
 */
export function AddLeadButton({
  context,
  canCreate,
}: {
  context: AddLeadContext;
  canCreate: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { openLead } = useLeadParams();
  // A counter rather than a boolean: remounting the wizard is what resets it,
  // so a second "Add lead" never resumes a half-filled first attempt.
  const [session, setSession] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    // Focus goes back where it came from, so a keyboard user is not dropped
    // at the top of the document.
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return (
    <>
      {/* Import sits beside Add lead rather than inside a split menu: they are
          two different jobs (one record vs a file), and hiding the file path
          behind a caret is how people never find it. */}
      {canCreate && (
        <Link
          href="/app/leads/import"
          className="border-line-strong bg-surface text-content hover:bg-surface-hover focus-visible:outline-content-accent inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Upload className="size-3.5" aria-hidden />
          Import
        </Link>
      )}

      <Button
        ref={triggerRef}
        onClick={() => {
          if (!canCreate) {
            toast({
              variant: "warning",
              title: "You cannot add leads",
              description:
                "Ask an owner or admin to give you member access to this workspace.",
            });
            return;
          }
          setSession((current) => current + 1);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Plus className="size-4" aria-hidden />
        Add lead
      </Button>

      {open && (
        <AddLeadWizard
          key={session}
          context={context}
          onClose={close}
          onCreated={() => {
            // The list is server-rendered; refresh it in place rather than
            // reloading the shell.
            router.refresh();
            setOpen(false);
          }}
          onOpenLead={(leadId) => openLead(leadId)}
        />
      )}
    </>
  );
}
