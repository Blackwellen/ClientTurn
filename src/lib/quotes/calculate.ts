/**
 * calculateQuote: THE ONLY place a quote price is computed.
 *
 * The AI never computes, rounds or restates a price on its own: it calls a
 * tool that calls this, and the validator checks every money figure in an
 * outbound message against a figure this function produced
 * (docs/revenue-engine/12 §1.2, release criterion R5). Deterministic: the
 * same input always yields the same breakdown and `calculationHash`.
 *
 * Order of operations for every line (integer minor units throughout):
 *
 *   1. list      = tier/flat unit price (+ option deltas) x quantity,
 *                  each extension rounded half up to the minor unit
 *   2. bundle    = a bundle's saving, split across its components in
 *                  proportion to their list amounts (largest remainder)
 *   3. line      = the line discount (% of, or an amount off, list - bundle)
 *   4. quote     = the quote discount, computed ONCE on the in-scope
 *                  subtotal and split across in-scope lines in proportion
 *   5. net       = list - bundle - line - quote
 *   6. VAT       = round_half_up(net x rate), PER LINE
 *   7. gross     = net + VAT
 *
 * VAT ROUNDING RULE (chosen and fixed): VAT is calculated on each line's
 * net amount and rounded to the nearest penny, halves rounded up. The VAT
 * total is the sum of the line VAT amounts, and each rate's VAT is the sum
 * of its lines. HMRC VAT Notice 700 section 17 lets a business calculate VAT
 * at line level or on the invoice total, provided it applies one method
 * consistently; line level is used here because it keeps every line, every
 * VAT-rate bucket, every deposit/balance split and every credit note
 * reconcilable to the penny with no "rounding adjustment" line. Discounts
 * are applied BEFORE VAT (VAT is due on the discounted consideration).
 * Workspaces that are not VAT-registered charge and show no VAT at all.
 *
 * Charges: ONE_OFF lines make the project total; RECURRING lines are priced
 * per period and grouped by interval; USAGE lines are an ESTIMATE at the
 * quoted quantity, billed in arrears, never in totals, deposits or the
 * first payment.
 *
 * DEPOSIT RULES: a deposit applies to the one-off gross only (recurring is
 * never deposited). PERCENT = round_half_up(one-off gross x bps); FIXED is
 * an amount that may not exceed the one-off gross. A deposit that rounds to
 * zero, or a deposit on a quote with no one-off lines, is an error rather
 * than silently dropped. deposit + balance (or + instalments) = one-off
 * gross exactly. Instalments split the remainder evenly, the first
 * instalments taking the extra minor units. Every payment's share of each
 * VAT rate is allocated so rows and rates both sum exactly.
 */

import { listPrice, costAmount } from "../catalogue/pricing.ts";
import { quantityWithinBounds, validateCatalogue } from "../catalogue/validate.ts";
import {
  INTERVAL_UNITS,
  VAT_RATE_BPS,
  VAT_RATE_CODES,
  intervalKey,
  type BillingInterval,
  type CatalogueBundle,
  type CatalogueItem,
  type ItemOption,
} from "../catalogue/types.ts";
import { hashCanonical } from "./canonical.ts";
import {
  MoneyError,
  allocate,
  allocateMatrix,
  mulDivRound,
  percentOf,
  ratioBps,
  toMilli,
} from "./money.ts";
import {
  calculateQuoteInputSchema,
  type CalcIssue,
  type CalculateQuoteResult,
  type CalculatedLine,
  type Discount,
  type DueRule,
  type ParsedQuoteInput,
  type QuoteCalculation,
  type RecurringSubtotal,
  type ScheduleItem,
  type Subtotal,
  type VatBucket,
} from "./types.ts";

export const CALCULATION_VERSION = "quote-calc/1";

function fail(issues: CalcIssue[]): CalculateQuoteResult {
  return { ok: false, issues };
}

function discountAmount(base: number, discount: Discount | undefined): { minor: number; bps: number | null; exceeds: boolean } {
  if (!discount) return { minor: 0, bps: null, exceeds: false };
  if (discount.type === "PERCENT") return { minor: percentOf(base, discount.bps), bps: discount.bps, exceeds: false };
  return { minor: Math.min(discount.minor, base), bps: null, exceeds: discount.minor > base };
}

function blankLine(): Omit<CalculatedLine, "lineId" | "sourceLineId" | "itemId" | "description" | "unit" | "chargeType" | "vatRate"> {
  return {
    bundleId: null,
    bundleName: null,
    parentLineId: null,
    interval: null,
    quantityMilli: 0,
    optionIds: [],
    unitPriceMinor: null,
    listMinor: 0,
    bundleDiscountMinor: 0,
    lineDiscountMinor: 0,
    quoteDiscountMinor: 0,
    lineDiscountBps: null,
    netMinor: 0,
    vatBps: 0,
    vatMinor: 0,
    grossMinor: 0,
    costMinor: null,
    marginMinor: null,
    marginBps: null,
  };
}

function discountBase(line: CalculatedLine): number {
  return line.listMinor - line.bundleDiscountMinor - line.lineDiscountMinor;
}

function subtotalOf(lines: CalculatedLine[], vatRegistered: boolean): Subtotal {
  const sum = (pick: (line: CalculatedLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const vatByRate: VatBucket[] = [];
  if (vatRegistered) {
    for (const code of VAT_RATE_CODES) {
      const inRate = lines.filter((line) => line.vatRate === code);
      if (inRate.length === 0) continue;
      const netMinor = inRate.reduce((t, l) => t + l.netMinor, 0);
      const vatMinor = inRate.reduce((t, l) => t + l.vatMinor, 0);
      vatByRate.push({ vatRate: code, vatBps: VAT_RATE_BPS[code], netMinor, vatMinor, grossMinor: netMinor + vatMinor });
    }
  }
  return {
    listMinor: sum((l) => l.listMinor),
    discountMinor: sum((l) => l.bundleDiscountMinor + l.lineDiscountMinor + l.quoteDiscountMinor),
    netMinor: sum((l) => l.netMinor),
    vatMinor: sum((l) => l.vatMinor),
    grossMinor: sum((l) => l.grossMinor),
    vatByRate,
  };
}

function intervalOrder(a: BillingInterval, b: BillingInterval): number {
  const ua = INTERVAL_UNITS.indexOf(a.unit);
  const ub = INTERVAL_UNITS.indexOf(b.unit);
  return ua !== ub ? ua - ub : a.count - b.count;
}

/** Split one amount into schedule rows' VAT buckets; rows and buckets both reconcile. */
export function splitAcrossBuckets(
  rowGross: readonly number[],
  buckets: readonly VatBucket[],
): { netMinor: number; vatMinor: number; vatByRate: VatBucket[] }[] {
  if (buckets.length === 0) {
    return rowGross.map((gross) => ({ netMinor: gross, vatMinor: 0, vatByRate: [] }));
  }
  const matrix = allocateMatrix(
    rowGross,
    buckets.map((bucket) => bucket.grossMinor),
  );
  const cumulativeGross = buckets.map(() => 0);
  const cumulativeVat = buckets.map(() => 0);
  return matrix.map((cells) => {
    const vatByRate = cells.map((cell, b) => {
      const bucket = buckets[b];
      cumulativeGross[b] += cell;
      // VAT on the running total, so the last payment lands exactly on the
      // bucket's VAT and no payment's VAT share can go negative.
      const vatSoFar = bucket.grossMinor === 0 ? 0 : mulDivRound(bucket.vatMinor, cumulativeGross[b], bucket.grossMinor);
      const vatMinor = vatSoFar - cumulativeVat[b];
      cumulativeVat[b] = vatSoFar;
      return { vatRate: bucket.vatRate, vatBps: bucket.vatBps, netMinor: cell - vatMinor, vatMinor, grossMinor: cell };
    });
    return {
      netMinor: vatByRate.reduce((t, v) => t + v.netMinor, 0),
      vatMinor: vatByRate.reduce((t, v) => t + v.vatMinor, 0),
      vatByRate,
    };
  });
}

export function calculateQuote(raw: unknown): CalculateQuoteResult {
  const parsed = calculateQuoteInputSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map((issue) => ({
        code: "INVALID_INPUT",
        path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: issue.message,
      })),
    );
  }
  const input = parsed.data;
  const catalogueCheck = validateCatalogue(input.catalogue);
  if (!catalogueCheck.ok) {
    return fail(catalogueCheck.issues.map((issue) => ({ ...issue, path: ["catalogue", ...issue.path] })));
  }
  if (input.currency !== input.catalogue.currency) {
    return fail([
      {
        code: "CURRENCY_MISMATCH",
        path: ["currency"],
        message: `A quote is in one currency: the workspace catalogue is ${input.catalogue.currency}, not ${input.currency}.`,
      },
    ]);
  }
  try {
    return compute(input);
  } catch (error) {
    if (error instanceof MoneyError) return fail([{ code: error.code, path: [], message: error.message }]);
    throw error;
  }
}

function compute(input: ParsedQuoteInput): CalculateQuoteResult {
  const issues: CalcIssue[] = [];
  const items = new Map<string, CatalogueItem>(input.catalogue.items.map((item) => [item.id, item]));
  const bundles = new Map<string, CatalogueBundle>(input.catalogue.bundles.map((bundle) => [bundle.id, bundle]));
  const inputById = new Map(input.lines.map((line) => [line.lineId, line]));
  const seen = new Set<string>();
  const lines: CalculatedLine[] = [];

  input.lines.forEach((line, index) => {
    const path = ["lines", index];
    if (seen.has(line.lineId)) {
      issues.push({ code: "DUPLICATE_LINE", path: [...path, "lineId"], message: `Line id "${line.lineId}" is used twice.` });
      return;
    }
    seen.add(line.lineId);

    if (line.kind === "ITEM") {
      const item = items.get(line.itemId);
      if (!item) {
        issues.push({ code: "UNKNOWN_ITEM", path: [...path, "itemId"], message: `"${line.itemId}" is not in the catalogue.` });
        return;
      }
      if (!item.active) {
        issues.push({ code: "INACTIVE_ITEM", path: [...path, "itemId"], message: `"${item.name}" is not currently sold.` });
        return;
      }
      const options: ItemOption[] = [];
      for (const optionId of new Set(line.optionIds)) {
        const option = item.options.find((candidate) => candidate.id === optionId);
        if (!option) {
          issues.push({ code: "UNKNOWN_OPTION", path: [...path, "optionIds"], message: `"${optionId}" is not an option of "${item.name}".` });
          return;
        }
        options.push(option);
      }
      if (!quantityWithinBounds(item, line.quantity)) {
        issues.push({
          code: "QUANTITY_OUT_OF_RANGE",
          path: [...path, "quantity"],
          message: `"${item.name}" is sold in quantities from ${item.minQuantity ?? "any"} to ${item.maxQuantity ?? "any"}.`,
        });
        return;
      }
      if (line.parentLineId !== undefined) {
        const parent = inputById.get(line.parentLineId);
        const parentItem = parent && parent.kind === "ITEM" ? items.get(parent.itemId) : undefined;
        if (!parent || parent.lineId === line.lineId || !parentItem || !parentItem.addOnItemIds.includes(item.id)) {
          issues.push({
            code: "INVALID_ADD_ON",
            path: [...path, "parentLineId"],
            message: `"${item.name}" is not an add-on of line "${line.parentLineId}".`,
          });
          return;
        }
      } else if (item.addOnOnly) {
        issues.push({ code: "ADD_ON_NEEDS_PARENT", path, message: `"${item.name}" is sold only as an add-on.` });
        return;
      }

      const quantityMilli = toMilli(line.quantity);
      const price = listPrice(item, quantityMilli, options);
      const discount = discountAmount(price.amountMinor, line.discount);
      if (discount.exceeds) {
        issues.push({ code: "LINE_DISCOUNT_EXCEEDS", path: [...path, "discount"], message: "A line discount cannot exceed the line amount." });
        return;
      }
      const optionNames = options.map((option) => option.name);
      lines.push({
        ...blankLine(),
        lineId: line.lineId,
        sourceLineId: line.lineId,
        parentLineId: line.parentLineId ?? null,
        itemId: item.id,
        description: line.description ?? (optionNames.length ? `${item.name} (${optionNames.join(", ")})` : item.name),
        unit: item.unit,
        chargeType: item.chargeType,
        interval: item.interval ?? null,
        quantityMilli,
        optionIds: options.map((option) => option.id),
        unitPriceMinor: price.unitPriceMinor,
        listMinor: price.amountMinor,
        lineDiscountMinor: discount.minor,
        lineDiscountBps: discount.bps,
        vatRate: item.vatRate,
        costMinor: costAmount(item, quantityMilli, options),
      });
      return;
    }

    // BUNDLE
    const bundle = bundles.get(line.bundleId);
    if (!bundle) {
      issues.push({ code: "UNKNOWN_BUNDLE", path: [...path, "bundleId"], message: `"${line.bundleId}" is not a catalogue bundle.` });
      return;
    }
    if (!bundle.active) {
      issues.push({ code: "INACTIVE_BUNDLE", path: [...path, "bundleId"], message: `"${bundle.name}" is not currently sold.` });
      return;
    }
    const components: CalculatedLine[] = [];
    for (const [j, component] of bundle.components.entries()) {
      const item = items.get(component.itemId);
      if (!item || !item.active) {
        issues.push({ code: "INACTIVE_ITEM", path: [...path, "bundleId"], message: `A component of "${bundle.name}" is not currently sold.` });
        return;
      }
      const quantityMilli = toMilli(component.quantity) * line.quantity;
      const price = listPrice(item, quantityMilli);
      components.push({
        ...blankLine(),
        lineId: `${line.lineId}#${j}`,
        sourceLineId: line.lineId,
        bundleId: bundle.id,
        bundleName: bundle.name,
        itemId: item.id,
        description: `${bundle.name}: ${item.name}`,
        unit: item.unit,
        chargeType: item.chargeType,
        interval: item.interval ?? null,
        quantityMilli,
        unitPriceMinor: price.unitPriceMinor,
        listMinor: price.amountMinor,
        vatRate: item.vatRate,
        costMinor: costAmount(item, quantityMilli),
      });
    }
    const listSum = components.reduce((t, c) => t + c.listMinor, 0);
    let saving: number;
    if (bundle.pricing.type === "FIXED") {
      const price = bundle.pricing.priceMinor * line.quantity;
      if (price > listSum) {
        issues.push({
          code: "BUNDLE_ABOVE_COMPONENTS",
          path: [...path, "quantity"],
          message: `At this quantity "${bundle.name}" would cost more than its components; quote the items instead.`,
        });
        return;
      }
      saving = listSum - price;
    } else {
      saving = percentOf(listSum, bundle.pricing.bps);
    }
    allocate(saving, components.map((c) => c.listMinor)).forEach((share, j) => {
      components[j].bundleDiscountMinor = share;
    });
    const bases = components.map(discountBase);
    const bundleBase = bases.reduce((t, b) => t + b, 0);
    const discount = discountAmount(bundleBase, line.discount);
    if (discount.exceeds) {
      issues.push({ code: "LINE_DISCOUNT_EXCEEDS", path: [...path, "discount"], message: "A line discount cannot exceed the bundle amount." });
      return;
    }
    allocate(discount.minor, bases).forEach((share, j) => {
      components[j].lineDiscountMinor = share;
      components[j].lineDiscountBps = discount.bps;
    });
    lines.push(...components);
  });

  if (issues.length > 0) return fail(issues);

  // Quote discount: once on the in-scope subtotal, then split.
  if (input.quoteDiscount) {
    const scope = input.quoteDiscount.scope;
    const inScope = lines.filter(
      (line) =>
        line.chargeType !== "USAGE" &&
        (scope === "ALL" || (scope === "ONE_OFF" ? line.chargeType === "ONE_OFF" : line.chargeType === "RECURRING")),
    );
    if (input.quoteDiscount.type === "AMOUNT") {
      const groups = new Set(inScope.map((line) => (line.interval ? intervalKey(line.interval) : "ONE_OFF")));
      if (groups.size > 1) {
        return fail([
          {
            code: "AMBIGUOUS_AMOUNT_DISCOUNT",
            path: ["quoteDiscount", "scope"],
            message: "An amount off must apply to one charge group (one-off, or one recurring interval). Narrow the scope or use a percentage.",
          },
        ]);
      }
    }
    const bases = inScope.map(discountBase);
    const base = bases.reduce((t, b) => t + b, 0);
    const discount = discountAmount(base, input.quoteDiscount);
    if (discount.exceeds) {
      return fail([{ code: "QUOTE_DISCOUNT_EXCEEDS", path: ["quoteDiscount"], message: "The quote discount exceeds the discounted subtotal." }]);
    }
    if (inScope.length === 0) {
      return fail([{ code: "QUOTE_DISCOUNT_NO_LINES", path: ["quoteDiscount", "scope"], message: "No lines are in the discount's scope." }]);
    }
    allocate(discount.minor, bases).forEach((share, j) => {
      inScope[j].quoteDiscountMinor = share;
    });
  }

  // Net, VAT (per line), gross, margin.
  for (const line of lines) {
    line.netMinor = discountBase(line) - line.quoteDiscountMinor;
    line.vatBps = input.vatRegistered ? VAT_RATE_BPS[line.vatRate] : 0;
    line.vatMinor = percentOf(line.netMinor, line.vatBps);
    line.grossMinor = line.netMinor + line.vatMinor;
    if (line.costMinor !== null) {
      line.marginMinor = line.netMinor - line.costMinor;
      line.marginBps = ratioBps(line.marginMinor, line.netMinor);
    }
  }

  const oneOffLines = lines.filter((line) => line.chargeType === "ONE_OFF");
  const recurringLines = lines.filter((line) => line.chargeType === "RECURRING");
  const usageLines = lines.filter((line) => line.chargeType === "USAGE");
  const oneOff = subtotalOf(oneOffLines, input.vatRegistered);

  const intervals = new Map<string, BillingInterval>();
  for (const line of recurringLines) if (line.interval) intervals.set(intervalKey(line.interval), line.interval);
  const recurring: RecurringSubtotal[] = [...intervals.values()].sort(intervalOrder).map((interval) => {
    const key = intervalKey(interval);
    return {
      ...subtotalOf(
        recurringLines.filter((line) => line.interval && intervalKey(line.interval) === key),
        input.vatRegistered,
      ),
      interval,
      intervalKey: key,
    };
  });

  // Payment schedule over the one-off gross.
  const payment = input.payment;
  const oneOffGross = oneOff.grossMinor;
  let depositMinor = 0;
  if (payment.deposit) {
    if (oneOffGross === 0) {
      return fail([{ code: "DEPOSIT_WITHOUT_ONE_OFF", path: ["payment", "deposit"], message: "A deposit needs one-off lines to apply to." }]);
    }
    depositMinor = payment.deposit.type === "PERCENT" ? percentOf(oneOffGross, payment.deposit.bps) : payment.deposit.minor;
    if (depositMinor === 0) {
      return fail([{ code: "DEPOSIT_ROUNDS_TO_ZERO", path: ["payment", "deposit"], message: "The deposit rounds to nothing." }]);
    }
    if (depositMinor > oneOffGross) {
      return fail([{ code: "DEPOSIT_EXCEEDS_TOTAL", path: ["payment", "deposit"], message: "The deposit is more than the one-off total." }]);
    }
  }
  const rows: { kind: ScheduleItem["kind"]; due: DueRule; grossMinor: number }[] = [];
  if (depositMinor > 0) rows.push({ kind: "DEPOSIT", due: { type: "ON_ACCEPTANCE" }, grossMinor: depositMinor });
  const remainder = oneOffGross - depositMinor;
  if (remainder > 0) {
    if (payment.remainder.type === "SINGLE") {
      rows.push({ kind: depositMinor > 0 ? "BALANCE" : "FULL", due: payment.remainder.due, grossMinor: remainder });
    } else {
      const { count, firstDueDays, intervalDays } = payment.remainder;
      if (remainder < count) {
        return fail([{ code: "INSTALMENTS_TOO_SMALL", path: ["payment", "remainder", "count"], message: "Too many instalments for the amount." }]);
      }
      const base = Math.floor(remainder / count);
      const extra = remainder - base * count;
      for (let k = 0; k < count; k += 1) {
        const days = firstDueDays + k * intervalDays;
        rows.push({
          kind: "INSTALMENT",
          due: days === 0 ? { type: "ON_ACCEPTANCE" } : { type: "DAYS_AFTER_ACCEPTANCE", days },
          grossMinor: base + (k < extra ? 1 : 0),
        });
      }
    }
  }
  const splits = splitAcrossBuckets(
    rows.map((row) => row.grossMinor),
    oneOff.vatByRate,
  );
  const schedule: ScheduleItem[] = rows.map((row, i) => ({ seq: i + 1, ...row, ...splits[i] }));

  const recurringGross = recurring.reduce((t, r) => t + r.grossMinor, 0);
  const firstPaymentMinor =
    schedule.filter((row) => row.due.type === "ON_ACCEPTANCE").reduce((t, row) => t + row.grossMinor, 0) +
    (payment.recurringBilledUpfront ? recurringGross : 0);

  const priced = [...oneOffLines, ...recurringLines];
  const known = priced.filter((line) => line.costMinor !== null);
  const marginNet = known.reduce((t, l) => t + l.netMinor, 0);
  const marginCost = known.reduce((t, l) => t + (l.costMinor ?? 0), 0);
  const margin = {
    complete: priced.length > 0 && known.length === priced.length,
    costMinor: marginCost,
    netMinor: marginNet,
    marginMinor: marginNet - marginCost,
    marginBps: ratioBps(marginNet - marginCost, marginNet),
  };

  const warnings: string[] = [];
  if (!input.vatRegistered) warnings.push("NOT_VAT_REGISTERED: no VAT is charged or shown.");
  if (usageLines.length > 0) warnings.push("USAGE_ESTIMATE: usage lines are estimates billed in arrears and excluded from totals.");
  if (!margin.complete) warnings.push("MARGIN_INCOMPLETE: some lines have no cost price.");

  const groups = [oneOff, ...recurring];
  const body: Omit<QuoteCalculation, "calculationHash"> = {
    version: CALCULATION_VERSION,
    currency: input.currency,
    vatRegistered: input.vatRegistered,
    lines,
    oneOff,
    recurring,
    usageEstimate: subtotalOf(usageLines, input.vatRegistered),
    totals: {
      listMinor: groups.reduce((t, g) => t + g.listMinor, 0),
      discountMinor: groups.reduce((t, g) => t + g.discountMinor, 0),
      netMinor: groups.reduce((t, g) => t + g.netMinor, 0),
      vatMinor: groups.reduce((t, g) => t + g.vatMinor, 0),
      grossMinor: groups.reduce((t, g) => t + g.grossMinor, 0),
    },
    depositMinor,
    firstPaymentMinor,
    schedule,
    margin,
    warnings,
  };
  return { ok: true, quote: { ...body, calculationHash: hashCanonical(body) } };
}

/** Recompute and compare: true when a stored breakdown still matches its inputs. */
export function verifyCalculation(input: unknown, stored: Pick<QuoteCalculation, "calculationHash">): boolean {
  const result = calculateQuote(input);
  return result.ok && result.quote.calculationHash === stored.calculationHash;
}
