"use client";

import * as React from "react";
import { Archive, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Checkbox, FormField, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { archiveCatalogueEntry, saveCatalogueBundle, saveCatalogueItem } from "@/lib/quotes/settings-actions";
import { formatMinor } from "@/lib/quotes/money";
import { keyFromName, minorToInput, parseMoneyInput, parsePercentInput } from "@/lib/quotes/money-input";
import { VAT_RATE_LABEL, type CatalogueBundle, type CatalogueItem, type VatRateCode } from "@/lib/catalogue/types";

type CheckoutLink = { id: string; label: string; priceText: string };

const CHARGE_LABEL = { ONE_OFF: "One-off", RECURRING: "Recurring", USAGE: "Usage (estimate)" } as const;
const INTERVAL_LABEL = { WEEK: "week", MONTH: "month", QUARTER: "quarter", YEAR: "year" } as const;

/**
 * Settings -> Quotes & invoices -> Catalogue: the priced lines quotes are
 * built from (items, price tiers, bundles, VAT class). Prices and cost are
 * owner/admin; a member sees the list read-only and without cost. Every
 * save validates the whole catalogue on the server, and quotes already sent
 * keep the price they were sent with.
 */
export function CatalogueCard({
  currency,
  items,
  bundles,
  checkoutLinks,
  checkoutByItem,
  canEdit,
  showCost,
}: {
  currency: string;
  items: CatalogueItem[];
  bundles: CatalogueBundle[];
  checkoutLinks: CheckoutLink[];
  checkoutByItem: Record<string, string | null>;
  canEdit: boolean;
  showCost: boolean;
}) {
  const [editing, setEditing] = React.useState<CatalogueItem | "new" | null>(null);
  const [bundleOpen, setBundleOpen] = React.useState(false);
  const [archiving, setArchiving] = React.useState<{ kind: "item" | "bundle"; key: string; name: string } | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const { toast } = useToast();
  const visible = items.filter((item) => showArchived || item.active);

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle>Catalogue</CardTitle>
          <CardDescription>The products and services quotes are priced from. Prices are in {currency}{showCost ? "; cost is only visible to owners and admins" : ""}.</CardDescription>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setBundleOpen(true)} disabled={items.filter((i) => i.active).length < 2}>
              <Package className="size-4" aria-hidden />
              New bundle
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden />
              Add item
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No catalogue items yet"
            description={canEdit ? "Add the products and services you quote for, with their price, unit and VAT rate." : "An owner or admin adds the products and services quotes are built from."}
            action={canEdit ? <Button size="sm" onClick={() => setEditing("new")}>Add your first item</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {visible.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-content">
                    {item.name}
                    {!item.active && <span className="ml-2 text-[11.5px] font-normal text-content-subtle">Archived</span>}
                  </p>
                  <p className="text-[12px] text-content-muted">
                    {CHARGE_LABEL[item.chargeType]}
                    {item.interval ? `, per ${INTERVAL_LABEL[item.interval.unit]}` : ""} · VAT {VAT_RATE_LABEL[item.vatRate]}
                    {item.tiers.length > 0 ? ` · ${item.tiers.length} price tiers` : ""}
                    {checkoutByItem[item.id] ? " · payment link" : ""}
                  </p>
                </div>
                <p className="text-[13.5px] font-semibold tabular-nums text-content">
                  {formatMinor(item.unitPriceMinor, currency)} <span className="text-[12px] font-normal text-content-muted">/ {item.unit}</span>
                </p>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="xs" aria-label={`Edit ${item.name}`} onClick={() => setEditing(item)}>
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                    {item.active && (
                      <Button variant="ghost" size="xs" aria-label={`Archive ${item.name}`} onClick={() => setArchiving({ kind: "item", key: item.id, name: item.name })}>
                        <Archive className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
            {bundles.map((bundle) => (
              <li key={`b-${bundle.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-content">
                    <Package className="mr-1.5 inline size-3.5 text-content-muted" aria-hidden />
                    {bundle.name}
                  </p>
                  <p className="text-[12px] text-content-muted">
                    Bundle of {bundle.components.length} · {bundle.pricing.type === "FIXED" ? `${formatMinor(bundle.pricing.priceMinor, currency)} fixed` : `${bundle.pricing.bps / 100}% off the parts`}
                  </p>
                </div>
                {canEdit && bundle.active && (
                  <Button variant="ghost" size="xs" aria-label={`Archive ${bundle.name}`} onClick={() => setArchiving({ kind: "bundle", key: bundle.id, name: bundle.name })}>
                    <Archive className="size-3.5" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {items.some((item) => !item.active) && (
          <label className="flex items-center gap-2 border-t border-line-subtle px-5 py-2.5 text-[12.5px] text-content-muted">
            <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived items
          </label>
        )}
      </CardContent>

      {editing && (
        <ItemEditor
          currency={currency}
          item={editing === "new" ? null : editing}
          existingKeys={items.map((i) => i.id)}
          addOnCandidates={items.filter((i) => i.active && (editing === "new" || i.id !== editing.id))}
          checkoutLinks={checkoutLinks}
          checkoutLinkId={editing === "new" ? null : (checkoutByItem[editing.id] ?? null)}
          showCost={showCost}
          onClose={() => setEditing(null)}
        />
      )}
      {bundleOpen && <BundleEditor currency={currency} items={items.filter((i) => i.active && i.chargeType !== "USAGE")} existingKeys={[...items.map((i) => i.id), ...bundles.map((b) => b.id)]} onClose={() => setBundleOpen(false)} />}
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.name ?? ""}?`}
        scope="New quotes can no longer include it."
        consequence="Quotes already sent keep it at the price they were sent with. You can restore it by editing it and marking it active."
        confirmLabel="Archive"
        variant="warning"
        onConfirm={async () => {
          if (!archiving) return;
          const result = await archiveCatalogueEntry({ kind: archiving.kind, key: archiving.key });
          setArchiving(null);
          toast(result.ok ? { variant: "success", title: "Archived" } : { variant: "error", title: "Not archived", description: result.error });
        }}
      />
    </Card>
  );
}

type TierDraft = { upTo: string; price: string };

function ItemEditor({
  currency,
  item,
  existingKeys,
  addOnCandidates,
  checkoutLinks,
  checkoutLinkId,
  showCost,
  onClose,
}: {
  currency: string;
  item: CatalogueItem | null;
  existingKeys: string[];
  addOnCandidates: CatalogueItem[];
  checkoutLinks: CheckoutLink[];
  checkoutLinkId: string | null;
  showCost: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState(item?.name ?? "");
  const [description, setDescription] = React.useState(item?.description ?? "");
  const [chargeType, setChargeType] = React.useState<CatalogueItem["chargeType"]>(item?.chargeType ?? "ONE_OFF");
  const [interval, setInterval] = React.useState<"WEEK" | "MONTH" | "QUARTER" | "YEAR">(item?.interval?.unit ?? "MONTH");
  const [unit, setUnit] = React.useState(item?.unit ?? "project");
  const [price, setPrice] = React.useState(minorToInput(item?.unitPriceMinor ?? null));
  const [cost, setCost] = React.useState(minorToInput(item?.costPriceMinor ?? null));
  const [vat, setVat] = React.useState<VatRateCode>(item?.vatRate ?? "STANDARD");
  const [link, setLink] = React.useState(checkoutLinkId ?? "");
  const [addOns, setAddOns] = React.useState<string[]>(item?.addOnItemIds ?? []);
  const [addOnOnly, setAddOnOnly] = React.useState(item?.addOnOnly ?? false);
  const [active, setActive] = React.useState(item?.active ?? true);
  const [tierMode, setTierMode] = React.useState<"" | "VOLUME" | "GRADUATED">(item?.tierMode ?? "");
  const [tiers, setTiers] = React.useState<TierDraft[]>(
    item?.tiers.map((t) => ({ upTo: t.upTo === null ? "" : String(t.upTo), price: minorToInput(t.unitPriceMinor) })) ?? [],
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setError(null);
    const unitPrice = parseMoneyInput(price);
    if (!name.trim()) return setError("Give the item a name.");
    if (unitPrice === null) return setError("Enter the price in pounds, e.g. 1200 or 49.99.");
    const costMinor = cost.trim() === "" ? null : parseMoneyInput(cost);
    if (cost.trim() !== "" && costMinor === null) return setError("Enter the cost in pounds, or leave it blank.");
    let key = item?.id ?? keyFromName(name);
    if (!item) {
      let n = 2;
      const base = key;
      while (existingKeys.includes(key)) key = `${base}-${n++}`;
    }
    const tierRows = tierMode
      ? tiers.map((t, i) => ({
          upTo: i === tiers.length - 1 ? null : Number(t.upTo),
          unitPriceMinor: parseMoneyInput(t.price),
          flatFeeMinor: 0,
        }))
      : [];
    if (tierRows.some((t) => t.unitPriceMinor === null || (t.upTo !== null && !(t.upTo > 0)))) return setError("Each tier needs an upper quantity (except the last) and a price.");
    setSaving(true);
    const result = await saveCatalogueItem({
      item: {
        id: key,
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        serviceId: item?.serviceId ?? null,
        chargeType,
        ...(chargeType === "RECURRING" ? { interval: { unit: interval, count: 1 } } : {}),
        unit: unit.trim() || "item",
        unitPriceMinor: unitPrice,
        costPriceMinor: showCost ? costMinor : (item?.costPriceMinor ?? null),
        vatRate: vat,
        ...(tierMode ? { tierMode } : {}),
        tiers: tierRows,
        options: item?.options ?? [],
        addOnItemIds: addOns,
        addOnOnly,
        active,
      },
      checkoutLinkId: link || null,
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    toast({ variant: "success", title: item ? "Item saved" : "Item added", description: result.warnings[0] });
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={item ? `Edit ${item.name}` : "Add a catalogue item"}
      description="Quotes already sent keep the price they were sent with."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>{item ? "Save item" : "Add item"}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" htmlFor="ci-name" required className="sm:col-span-2">
          <Input id="ci-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </FormField>
        <FormField label="Description" htmlFor="ci-desc" hint="Optional. Shown on the quote." className="sm:col-span-2">
          <Textarea id="ci-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </FormField>
        <FormField label="Charged" htmlFor="ci-charge">
          <Select native id="ci-charge" value={chargeType} onChange={(e) => setChargeType(e.target.value as CatalogueItem["chargeType"])}>
            <option value="ONE_OFF">One-off</option>
            <option value="RECURRING">Recurring</option>
            <option value="USAGE">Usage, billed in arrears</option>
          </Select>
        </FormField>
        {chargeType === "RECURRING" ? (
          <FormField label="Every" htmlFor="ci-interval">
            <Select native id="ci-interval" value={interval} onChange={(e) => setInterval(e.target.value as typeof interval)}>
              <option value="WEEK">Week</option>
              <option value="MONTH">Month</option>
              <option value="QUARTER">Quarter</option>
              <option value="YEAR">Year</option>
            </Select>
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
        <FormField label={`Price (${currency})`} htmlFor="ci-price" required hint="Per unit, before VAT.">
          <Input id="ci-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1200.00" />
        </FormField>
        <FormField label="Unit" htmlFor="ci-unit" hint="e.g. project, hour, seat, month">
          <Input id="ci-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} />
        </FormField>
        <FormField label="VAT" htmlFor="ci-vat">
          <Select native id="ci-vat" value={vat} onChange={(e) => setVat(e.target.value as VatRateCode)}>
            {(Object.keys(VAT_RATE_LABEL) as VatRateCode[]).map((code) => (
              <option key={code} value={code}>{VAT_RATE_LABEL[code]}</option>
            ))}
          </Select>
        </FormField>
        {showCost && (
          <FormField label={`Cost (${currency})`} htmlFor="ci-cost" hint="Internal, for margin. Never shown to customers.">
            <Input id="ci-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </FormField>
        )}
        <FormField label="Payment link after acceptance" htmlFor="ci-link" hint={checkoutLinks.length ? "One of your approved checkout links." : "Add approved checkout links under Business Profile, Direct close."} className="sm:col-span-2">
          <Select native id="ci-link" value={link} onChange={(e) => setLink(e.target.value)} disabled={checkoutLinks.length === 0}>
            <option value="">None</option>
            {checkoutLinks.map((l) => (
              <option key={l.id} value={l.id}>{l.label} ({l.priceText})</option>
            ))}
          </Select>
        </FormField>
      </div>

      <details className="mt-4 rounded-lg border border-line-subtle p-3">
        <summary className="cursor-pointer text-[13px] font-medium text-content">Price tiers, add-ons and availability</summary>
        <div className="mt-3 space-y-4">
          <FormField label="Tiered pricing" htmlFor="ci-tiermode" hint="Volume: the whole quantity at one tier's price. Graduated: each band at its own price.">
            <Select native id="ci-tiermode" value={tierMode} onChange={(e) => {
              const mode = e.target.value as typeof tierMode;
              setTierMode(mode);
              if (mode && tiers.length === 0) setTiers([{ upTo: "10", price }, { upTo: "", price }]);
            }}>
              <option value="">No tiers: one price</option>
              <option value="VOLUME">Volume</option>
              <option value="GRADUATED">Graduated</option>
            </Select>
          </FormField>
          {tierMode && (
            <div className="space-y-2">
              {tiers.map((tier, i) => (
                <div key={i} className="flex items-end gap-2">
                  <FormField label={i === tiers.length - 1 ? "And above" : "Up to (quantity)"} htmlFor={`tier-up-${i}`} className="w-36">
                    <Input id={`tier-up-${i}`} inputMode="decimal" value={i === tiers.length - 1 ? "" : tier.upTo} disabled={i === tiers.length - 1} onChange={(e) => setTiers(tiers.map((t, j) => (j === i ? { ...t, upTo: e.target.value } : t)))} />
                  </FormField>
                  <FormField label="Unit price" htmlFor={`tier-price-${i}`} className="w-36">
                    <Input id={`tier-price-${i}`} inputMode="decimal" value={tier.price} onChange={(e) => setTiers(tiers.map((t, j) => (j === i ? { ...t, price: e.target.value } : t)))} />
                  </FormField>
                  {tiers.length > 1 && (
                    <Button variant="ghost" size="sm" aria-label="Remove tier" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              {tiers.length < 20 && (
                <Button variant="secondary" size="xs" onClick={() => setTiers([...tiers.slice(0, -1), { upTo: "", price: tiers.at(-1)?.price ?? price }, ...tiers.slice(-1)])}>
                  <Plus className="size-3.5" aria-hidden /> Add tier
                </Button>
              )}
            </div>
          )}
          {addOnCandidates.length > 0 && (
            <fieldset>
              <legend className="text-[13px] font-medium text-content">Add-ons that can be attached to this item</legend>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {addOnCandidates.filter((c) => c.addOnItemIds.length === 0).map((candidate) => (
                  <label key={candidate.id} className="flex items-center gap-2 text-[13px] text-content-secondary">
                    <Checkbox
                      checked={addOns.includes(candidate.id)}
                      onChange={(e) => setAddOns(e.target.checked ? [...addOns, candidate.id] : addOns.filter((id) => id !== candidate.id))}
                    />
                    {candidate.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="flex items-center gap-2 text-[13px] text-content-secondary">
            <Checkbox checked={addOnOnly} onChange={(e) => setAddOnOnly(e.target.checked)} />
            Only sold as an add-on to another item
          </label>
          <label className="flex items-center gap-2 text-[13px] text-content-secondary">
            <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active: can be added to new quotes
          </label>
        </div>
      </details>
      {error && <p role="alert" className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-[13px] text-danger-700">{error}</p>}
    </Modal>
  );
}

function BundleEditor({ currency, items, existingKeys, onClose }: { currency: string; items: CatalogueItem[]; existingKeys: string[]; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [parts, setParts] = React.useState<{ itemId: string; quantity: string }[]>([
    { itemId: items[0]?.id ?? "", quantity: "1" },
    { itemId: items[1]?.id ?? "", quantity: "1" },
  ]);
  const [pricing, setPricing] = React.useState<"PERCENT_OFF" | "FIXED">("PERCENT_OFF");
  const [amount, setAmount] = React.useState("10");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Give the bundle a name.");
    const value = pricing === "FIXED" ? parseMoneyInput(amount) : parsePercentInput(amount);
    if (value === null || value === 0) return setError(pricing === "FIXED" ? "Enter the bundle price in pounds." : "Enter the discount as a percentage.");
    let key = `bundle-${keyFromName(name)}`;
    let n = 2;
    const base = key;
    while (existingKeys.includes(key)) key = `${base}-${n++}`;
    setSaving(true);
    const result = await saveCatalogueBundle({
      bundle: {
        id: key,
        name: name.trim(),
        components: parts.map((p) => ({ itemId: p.itemId, quantity: Number(p.quantity) })),
        pricing: pricing === "FIXED" ? { type: "FIXED", priceMinor: value } : { type: "PERCENT_OFF", bps: value },
        active: true,
      },
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    toast({ variant: "success", title: "Bundle added" });
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New bundle"
      description="Items sold together at a fixed price or a percentage off. A bundle may not cost more than its parts."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Add bundle</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Name" htmlFor="cb-name" required>
          <Input id="cb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </FormField>
        {parts.map((part, i) => (
          <div key={i} className="flex items-end gap-2">
            <FormField label={`Item ${i + 1}`} htmlFor={`cb-item-${i}`} className="flex-1">
              <Select native id={`cb-item-${i}`} value={part.itemId} onChange={(e) => setParts(parts.map((p, j) => (j === i ? { ...p, itemId: e.target.value } : p)))}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Qty" htmlFor={`cb-qty-${i}`} className="w-20">
              <Input id={`cb-qty-${i}`} inputMode="decimal" value={part.quantity} onChange={(e) => setParts(parts.map((p, j) => (j === i ? { ...p, quantity: e.target.value } : p)))} />
            </FormField>
            {parts.length > 2 && (
              <Button variant="ghost" size="sm" aria-label="Remove item" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        ))}
        <Button variant="secondary" size="xs" onClick={() => setParts([...parts, { itemId: items[0]?.id ?? "", quantity: "1" }])}>
          <Plus className="size-3.5" aria-hidden /> Add item
        </Button>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Priced as" htmlFor="cb-pricing">
            <Select native id="cb-pricing" value={pricing} onChange={(e) => setPricing(e.target.value as typeof pricing)}>
              <option value="PERCENT_OFF">Percentage off the parts</option>
              <option value="FIXED">A fixed price</option>
            </Select>
          </FormField>
          <FormField label={pricing === "FIXED" ? `Price (${currency})` : "Percent off"} htmlFor="cb-amount">
            <Input id="cb-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
        </div>
        {error && <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-[13px] text-danger-700">{error}</p>}
      </div>
    </Modal>
  );
}
