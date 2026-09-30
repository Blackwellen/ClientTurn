"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select, Switch } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { PlanLimitState, FormError } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import {
  AI_PERMISSIONS_ENFORCED_BY_ASSISTANT,
  AI_PERMISSION_DESCRIPTION,
  AI_PERMISSION_LABEL,
  AI_PERMISSION_REQUIRES,
  DISCOUNT_RESTRAINTS,
  DISCOUNT_RESTRAINT_LABEL,
  normaliseAiAuthorityInput,
  type AiAuthority,
  type AiPermission,
  type DiscountRestraint,
} from "@/lib/commercial/ai-permissions";
import { saveAiAuthority } from "@/lib/commercial/actions";

/**
 * Settings -> AI & selling -> What the AI may do (brief §74).
 *
 * Progressive disclosure: the switches first; the discount limits only when
 * "Offer discounts" is on; the approval thresholds behind "More limits".
 * Owners and admins edit (the save action checks server-side); everyone else
 * sees the same values read-only. Every gate that reads these runs on the
 * server; this card only writes them.
 */

type Money = string;

type Draft = {
  capabilities: Record<AiPermission, boolean>;
  restraint: DiscountRestraint;
  maxPercent: string;
  maxAmount: Money;
  firstConcessionPercent: string;
  marginFloorPercent: string;
  approvalAbovePercent: string;
  approvalAboveAmount: Money;
  approvalAboveValue: Money;
  approvalRole: "admin" | "owner";
};

const GROUPS: { title: string; keys: AiPermission[] }[] = [
  { title: "Conversations", keys: ["qualify", "book", "call", "transfer_human"] },
  { title: "Quotes", keys: ["create_quote", "send_quote", "discount"] },
  { title: "After the quote", keys: ["request_signature", "send_payment_link", "create_invoice", "mark_won"] },
];

function fromMinor(minor: number | null): Money {
  return minor === null ? "" : (minor / 100).toFixed(2).replace(/\.00$/, "");
}

function toMinor(value: Money): number | null {
  const trimmed = value.trim().replace(/[£,\s]/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Number.NaN;
}

function toNumber(value: string): number | null {
  const trimmed = value.trim().replace(/%$/, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

function draftFrom(authority: AiAuthority): Draft {
  const d = authority.discount;
  return {
    capabilities: { ...authority.capabilities },
    restraint: d.restraint,
    maxPercent: d.maxPercent ? String(d.maxPercent) : "",
    maxAmount: fromMinor(d.maxAmountMinor),
    firstConcessionPercent: d.firstConcessionPercent === null ? "" : String(d.firstConcessionPercent),
    marginFloorPercent: d.marginFloorPercent === null ? "" : String(d.marginFloorPercent),
    approvalAbovePercent: d.approvalAbovePercent === null ? "" : String(d.approvalAbovePercent),
    approvalAboveAmount: fromMinor(d.approvalAboveAmountMinor),
    approvalAboveValue: fromMinor(d.approvalAboveValueMinor),
    approvalRole: d.approvalRole,
  };
}

export function AiPermissionsCard({
  authority,
  canManage,
  quoteAiAllowed,
  quoteAiMessage,
}: {
  authority: AiAuthority;
  canManage: boolean;
  /** can(businessId, "quote_ai_enabled"): the plan and the AI entitlement. */
  quoteAiAllowed: boolean;
  quoteAiMessage: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(authority));
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const locked = !canManage;
  const id = React.useId();

  function toggle(key: AiPermission, on: boolean) {
    setDraft((current) => {
      const capabilities = { ...current.capabilities, [key]: on };
      // Sending, discounting and the steps after need drafting; turning
      // drafting off turns them off too, and turning one on turns drafting on.
      if (!on) {
        for (const [dependent, needs] of Object.entries(AI_PERMISSION_REQUIRES) as [AiPermission, AiPermission][]) {
          if (needs === key) capabilities[dependent] = false;
        }
        if (key === "send_quote") {
          capabilities.request_signature = false;
          capabilities.send_payment_link = false;
        }
      } else {
        let needs = AI_PERMISSION_REQUIRES[key];
        while (needs) {
          capabilities[needs] = true;
          needs = AI_PERMISSION_REQUIRES[needs];
        }
      }
      const restraint = key === "discount" ? (on ? (current.restraint === "NEVER" ? "ONLY_AFTER_OBJECTION" : current.restraint) : "NEVER") : current.restraint;
      return { ...current, capabilities, restraint };
    });
  }

  async function onSave() {
    const payload = {
      capabilities: draft.capabilities,
      discount: {
        restraint: draft.restraint,
        maxPercent: toNumber(draft.maxPercent) ?? 0,
        maxAmountMinor: toMinor(draft.maxAmount),
        firstConcessionPercent: toNumber(draft.firstConcessionPercent),
        marginFloorPercent: toNumber(draft.marginFloorPercent),
        approvalAbovePercent: toNumber(draft.approvalAbovePercent),
        approvalAboveAmountMinor: toMinor(draft.approvalAboveAmount),
        approvalAboveValueMinor: toMinor(draft.approvalAboveValue),
        approvalRole: draft.approvalRole,
      },
    };
    const checked = normaliseAiAuthorityInput(payload);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await saveAiAuthority(payload);
      if (result.ok) {
        toast({ variant: "success", title: "Saved what the assistant may do." });
        router.refresh();
      } else {
        setError(result.error);
        toast({ variant: "error", title: result.error });
      }
    } catch {
      toast({ variant: "error", title: "That could not be saved. Try again." });
    } finally {
      setSaving(false);
    }
  }

  const discountOn = draft.capabilities.discount;

  return (
    <Card id="ai-permissions" className="scroll-mt-24">
      <CardHeader>
        <SectionHeader
          icon={ShieldCheck}
          title="What the AI may do"
          description="Everything starts off except qualifying and booking. Turn on only what you want the assistant to do without a person. Prices always come from your catalogue, and your rules decide every discount."
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {!quoteAiAllowed && (
          <PlanLimitState
            title="AI quoting is not available"
            description={quoteAiMessage ?? "Your plan does not include AI quote drafting, so the quote switches below have no effect."}
          />
        )}

        {GROUPS.map((group) => (
          <fieldset key={group.title} className="space-y-2">
            <legend className="text-[12px] font-semibold uppercase tracking-wide text-content-muted">{group.title}</legend>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {group.keys.map((key) => {
                const enforced = AI_PERMISSIONS_ENFORCED_BY_ASSISTANT.includes(key);
                // Qualifying is what the assistant is for: it is turned off
                // with the assistant itself (AI strategy -> Mode).
                const fixed = key === "qualify";
                const disabled = locked || fixed || (!enforced && !draft.capabilities[key]);
                return (
                  <li key={key} className="flex items-start justify-between gap-4 px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-content-primary">
                        {AI_PERMISSION_LABEL[key]}
                        {!enforced && <Badge tone="neutral" dense>Set in its own settings</Badge>}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-content-secondary">
                        {fixed
                          ? "Always on while the assistant is on. To stop it, turn the assistant off in AI strategy."
                          : AI_PERMISSION_DESCRIPTION[key]}
                      </p>
                    </div>
                    <Switch
                      checked={draft.capabilities[key]}
                      disabled={disabled}
                      onCheckedChange={(on) => toggle(key, on)}
                      label={AI_PERMISSION_LABEL[key]}
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}

        {discountOn && (
          <div className="space-y-4 rounded-lg border border-line bg-surface-sunken p-4">
            <p className="text-[13px] font-semibold text-content-primary">Discount limits for the assistant</p>
            <div className="grid gap-4 md:grid-cols-3">
              <FormField label="When it may offer one" htmlFor={`${id}-restraint`} hint="It never offers a discount you have not allowed.">
                <Select
                  id={`${id}-restraint`}
                  value={draft.restraint}
                  disabled={locked}
                  onChange={(event) => setDraft((d) => ({ ...d, restraint: event.target.value as DiscountRestraint }))}
                >
                  {DISCOUNT_RESTRAINTS.filter((mode) => mode !== "NEVER").map((mode) => (
                    <option key={mode} value={mode}>
                      {DISCOUNT_RESTRAINT_LABEL[mode]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Most it may take off (%)" htmlFor={`${id}-max`} hint="Of the price before the discount.">
                <Input id={`${id}-max`} inputMode="decimal" disabled={locked} value={draft.maxPercent} onChange={(e) => setDraft((d) => ({ ...d, maxPercent: e.target.value }))} />
              </FormField>
              <FormField label="Most it may take off (£)" htmlFor={`${id}-max-amount`} hint="Leave blank for no money cap.">
                <Input id={`${id}-max-amount`} inputMode="decimal" disabled={locked} value={draft.maxAmount} onChange={(e) => setDraft((d) => ({ ...d, maxAmount: e.target.value }))} />
              </FormField>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-content-accent"
              aria-expanded={moreOpen}
              aria-controls={`${id}-more`}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <ChevronDown className={moreOpen ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} />
              More limits
            </button>
            {moreOpen && (
              <div id={`${id}-more`} className="grid gap-4 md:grid-cols-3">
                <FormField label="First concession (%)" htmlFor={`${id}-first`} hint="Its first offer is this small. A second one always goes to a person.">
                  <Input id={`${id}-first`} inputMode="decimal" disabled={locked} value={draft.firstConcessionPercent} onChange={(e) => setDraft((d) => ({ ...d, firstConcessionPercent: e.target.value }))} />
                </FormField>
                <FormField label="Lowest margin kept (%)" htmlFor={`${id}-floor`} hint="Needs a cost price on your catalogue items. Without one, no discount.">
                  <Input id={`${id}-floor`} inputMode="decimal" disabled={locked} value={draft.marginFloorPercent} onChange={(e) => setDraft((d) => ({ ...d, marginFloorPercent: e.target.value }))} />
                </FormField>
                <FormField label="Who approves" htmlFor={`${id}-role`}>
                  <Select
                    id={`${id}-role`}
                    value={draft.approvalRole}
                    disabled={locked}
                    onChange={(event) => setDraft((d) => ({ ...d, approvalRole: event.target.value as "admin" | "owner" }))}
                  >
                    <option value="admin">An owner or admin</option>
                    <option value="owner">The owner</option>
                  </Select>
                </FormField>
                <FormField label="Approval above (%)" htmlFor={`${id}-appr-pct`} hint="A bigger discount waits for a person.">
                  <Input id={`${id}-appr-pct`} inputMode="decimal" disabled={locked} value={draft.approvalAbovePercent} onChange={(e) => setDraft((d) => ({ ...d, approvalAbovePercent: e.target.value }))} />
                </FormField>
                <FormField label="Approval above (£ off)" htmlFor={`${id}-appr-amt`}>
                  <Input id={`${id}-appr-amt`} inputMode="decimal" disabled={locked} value={draft.approvalAboveAmount} onChange={(e) => setDraft((d) => ({ ...d, approvalAboveAmount: e.target.value }))} />
                </FormField>
                <FormField label="Approval for quotes above (£)" htmlFor={`${id}-appr-val`} hint="Any quote worth more waits for a person.">
                  <Input id={`${id}-appr-val`} inputMode="decimal" disabled={locked} value={draft.approvalAboveValue} onChange={(e) => setDraft((d) => ({ ...d, approvalAboveValue: e.target.value }))} />
                </FormField>
              </div>
            )}
          </div>
        )}

        <FormError message={error} />
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Button size="sm" onClick={onSave} loading={saving}>
            Save permissions
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
