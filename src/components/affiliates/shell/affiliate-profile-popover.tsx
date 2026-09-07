"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  CircleHelp,
  CreditCard,
  Lock,
  LogOut,
  Settings,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import { signOut } from "@/lib/auth/actions";
import { requestOwnPasswordReset } from "@/lib/settings/actions";
import {
  ACCOUNT_STATE_LABEL,
  ACCOUNT_STATE_TONE,
  PAYOUT_READINESS_LABEL,
  PAYOUT_READINESS_TONE,
  type AffiliateAccountState,
  type PayoutReadiness,
} from "@/lib/affiliates/programme";

/**
 * The affiliate account menu (V4 §36).
 *
 * Same popover pattern as the customer app so the product feels like one
 * family, but branded for the portal and carrying the two facts a partner
 * actually checks here: whether their account is active, and whether they can
 * be paid. Those are separate states — an ACTIVE partner with no Stripe
 * account still cannot receive money — so both are shown rather than one
 * conflated badge.
 *
 * Accessibility comes from `DropdownMenu`: it owns `aria-expanded`, focuses
 * the first item on open, closes on Escape and outside click, and returns
 * focus to the trigger.
 */
export function AffiliateProfilePopover({
  name,
  email,
  reference,
  status,
  payoutReadiness,
}: {
  name: string;
  email: string;
  reference: string;
  status: AffiliateAccountState;
  payoutReadiness: PayoutReadiness;
}) {
  const { toast } = useToast();
  const router = useRouter();

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
      className="mt-2.5 min-w-[292px]"
      trigger={
        <button
          type="button"
          aria-label="Affiliate account menu"
          className="flex items-center gap-1 rounded-full pr-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
        >
          <Avatar name={name} size="md" />
          <ChevronDown className="size-4 text-content-muted" aria-hidden />
        </button>
      }
    >
      <span
        aria-hidden
        className="absolute -top-1.5 right-4 size-3 rotate-45 rounded-[2px] border-l border-t border-line bg-surface-raised"
      />

      <div className="relative flex items-center gap-3 px-3.5 pb-3 pt-2.5">
        <Avatar name={name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-content">{name}</p>
          <p className="truncate text-[12px] text-content-muted">{email}</p>
        </div>
      </div>

      <DropdownSeparator />

      <div className="px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-content-muted">Affiliate Partner</span>
          <Badge tone={ACCOUNT_STATE_TONE[status]} dot dense>
            {ACCOUNT_STATE_LABEL[status]}
          </Badge>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[12px] text-content-muted">Payout setup</span>
          <Badge tone={PAYOUT_READINESS_TONE[payoutReadiness]} dense>
            {PAYOUT_READINESS_LABEL[payoutReadiness]}
          </Badge>
        </div>
        <p className="mt-2 font-mono text-[11px] text-content-subtle">{reference}</p>
      </div>

      <DropdownSeparator />

      <DropdownItem
        icon={Settings}
        className="px-3.5 py-2 text-[13px]"
        onSelect={() => router.push("/affiliates/app/settings?section=account")}
      >
        Affiliate settings
      </DropdownItem>
      <DropdownItem
        icon={CreditCard}
        className="px-3.5 py-2 text-[13px]"
        onSelect={() => router.push("/affiliates/app/settings?section=payments")}
      >
        Payment &amp; tax
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
      <DropdownItem
        icon={CircleHelp}
        className="px-3.5 py-2 text-[13px]"
        onSelect={() => router.push("/affiliates/app/help")}
      >
        Help
      </DropdownItem>

      <DropdownSeparator />

      <DropdownItem
        icon={LogOut}
        className="px-3.5 py-2 text-[13px]"
        onSelect={() => {
          // Back to the partner login, not the customer one: a partner may have
          // no workspace and no account to sign in to there.
          void signOut("/affiliates/login");
        }}
      >
        Sign out
      </DropdownItem>
    </DropdownMenu>
  );
}
