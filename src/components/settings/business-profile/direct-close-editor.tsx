"use client";

import * as React from "react";
import { Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { saveCommercialAuthority } from "@/lib/commercial/actions";
import type { CheckoutLink, CommercialAuthority } from "@/lib/commercial/authority";

const EMPTY_LINK: CheckoutLink = {
  id: "",
  label: "",
  product: "",
  url: "",
  price_text: "",
  currency: "GBP",
};

/**
 * Selling: direct close (decision Q2, Phase 3.2).
 *
 * Off by default. When on, the assistant may send only a link listed here,
 * with exactly the price wording listed here, and may offer no discount above
 * the maximum. It never says a purchase happened. Owner/admin only; the server
 * re-validates everything.
 */
export function DirectCloseEditor({
  authority,
  canEdit,
}: {
  authority: CommercialAuthority;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const signature = JSON.stringify(authority);
  const [draft, setDraft] = React.useState<CommercialAuthority>(authority);
  const [seeded, setSeeded] = React.useState(signature);
  const [saving, setSaving] = React.useState(false);
  if (seeded !== signature) {
    setSeeded(signature);
    setDraft(authority);
  }
  const dirty = JSON.stringify(draft) !== signature;

  function setLink(index: number, key: keyof CheckoutLink, value: string) {
    setDraft((current) => ({
      ...current,
      approved_checkout_links: current.approved_checkout_links.map((link, i) =>
        i === index ? { ...link, [key]: key === "currency" ? value.toUpperCase() : value } : link,
      ),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveCommercialAuthority(draft);
      toast(
        result.ok
          ? { variant: "success", title: "Selling settings saved" }
          : { variant: "error", title: result.error },
      );
    } finally {
      setSaving(false);
    }
  }

  const ceilingPounds =
    draft.requires_human_above_value_minor == null
      ? ""
      : String(draft.requires_human_above_value_minor / 100);

  return (
    <Card>
      <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
        <SectionHeader
          icon={ShoppingCart}
          tone="info"
          title="Selling: direct close"
          description="Let the assistant send an approved checkout link when a lead is ready to buy."
        />
      </CardHeader>

      <CardContent className="space-y-4 px-5 pt-4 pb-5">
        <label className="flex items-start gap-2.5 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={draft.enabled}
            disabled={!canEdit}
            onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>
            <span className="font-medium text-content">Allow direct close</span>
            <span className="block text-[12px] text-content-muted">
              Only on self-serve, ecommerce and direct B2B motions. The assistant never offers a
              link that is not listed below and never says a purchase has happened.
            </span>
          </span>
        </label>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="dc-discount">Maximum discount (%)</Label>
            <Input
              id="dc-discount"
              type="number"
              min={0}
              max={100}
              step={1}
              value={String(draft.max_discount_percent)}
              disabled={!canEdit}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  max_discount_percent: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                }))
              }
            />
            <p className="text-[11.5px] text-content-muted">0 means the assistant offers no discount at all.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dc-ceiling">A person closes deals above (£)</Label>
            <Input
              id="dc-ceiling"
              type="number"
              min={0}
              step={1}
              placeholder="No limit"
              value={ceilingPounds}
              disabled={!canEdit}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  requires_human_above_value_minor:
                    event.target.value === "" ? null : Math.max(0, Math.round(Number(event.target.value) * 100)),
                }))
              }
            />
            <p className="text-[11.5px] text-content-muted">
              Above this opportunity value the lead is handed to your team instead.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[12.5px] font-medium text-content">Approved checkout links</p>
          {draft.approved_checkout_links.length === 0 && (
            <p className="text-[12px] text-content-muted">
              No links yet. Add the checkout pages your team already uses; the price text is the only
              price wording the assistant may repeat.
            </p>
          )}
          {draft.approved_checkout_links.map((link, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-3">
              <LinkField label="Id" value={link.id} placeholder="pro-monthly" disabled={!canEdit} onChange={(v) => setLink(index, "id", v)} />
              <LinkField label="Label" value={link.label} placeholder="Pro plan" disabled={!canEdit} onChange={(v) => setLink(index, "label", v)} />
              <LinkField label="Product" value={link.product} placeholder="Pro, monthly" disabled={!canEdit} onChange={(v) => setLink(index, "product", v)} />
              <div className="sm:col-span-2">
                <LinkField label="Checkout URL (https)" value={link.url} placeholder="https://" disabled={!canEdit} onChange={(v) => setLink(index, "url", v)} />
              </div>
              <LinkField label="Currency" value={link.currency} placeholder="GBP" disabled={!canEdit} onChange={(v) => setLink(index, "currency", v)} />
              <div className="sm:col-span-2">
                <LinkField label="Price text" value={link.price_text} placeholder="£49 per month" disabled={!canEdit} onChange={(v) => setLink(index, "price_text", v)} />
              </div>
              {canEdit && (
                <div className="flex items-end justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        approved_checkout_links: current.approved_checkout_links.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
          {canEdit && draft.approved_checkout_links.length < 25 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  approved_checkout_links: [...current.approved_checkout_links, { ...EMPTY_LINK }],
                }))
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Add checkout link
            </Button>
          )}
        </div>

        {canEdit ? (
          <div className="flex items-center justify-end gap-2 border-t border-line-subtle pt-3.5">
            <Button variant="secondary" size="sm" disabled={!dirty} onClick={() => setDraft(authority)}>
              Discard
            </Button>
            <Button size="sm" loading={saving} disabled={!dirty} onClick={save}>
              Save selling settings
            </Button>
          </div>
        ) : (
          <p className="text-[12px] text-content-muted">Only an owner or admin can change these settings.</p>
        )}
      </CardContent>
    </Card>
  );
}

function LinkField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={2000}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
