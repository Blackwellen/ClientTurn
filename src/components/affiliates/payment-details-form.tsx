"use client";

import * as React from "react";
import { Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updatePaymentDetails } from "@/lib/affiliates/actions";

/**
 * Where to send payouts.
 *
 * Deliberately minimal: a method, an account name and one reference string. We
 * do not ask for sort codes or full account numbers — the payout run is carried
 * out by a person against these details, and the less we hold the less there is
 * to leak.
 *
 * Saved values are never read back into the form. The server returns only
 * whether details exist, so a stored reference cannot be recovered from a page
 * payload by anyone who gets hold of the session.
 */
export function PaymentDetailsForm({ hasDetails }: { hasDetails: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(!hasDetails);
  const [pending, setPending] = React.useState(false);
  const [method, setMethod] = React.useState<"BANK_TRANSFER" | "PAYPAL">(
    "BANK_TRANSFER",
  );
  const [accountName, setAccountName] = React.useState("");
  const [reference, setReference] = React.useState("");

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <p className="flex items-center gap-2 text-[13px] text-content-secondary">
          <Check className="size-4 text-success-600" aria-hidden />
          Your payment details are on file.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          Replace them
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 px-4 py-4 sm:px-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        try {
          const result = await updatePaymentDetails({
            method,
            accountName: accountName.trim(),
            reference: reference.trim(),
          });
          if (result.ok) {
            toast({ variant: "success", title: result.message ?? "Saved." });
            setAccountName("");
            setReference("");
            setEditing(false);
          } else {
            toast({ variant: "error", title: result.error });
          }
        } catch {
          toast({ variant: "error", title: "That could not be saved." });
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-content-secondary">
            Method
          </span>
          <select
            value={method}
            onChange={(event) =>
              setMethod(event.target.value as "BANK_TRANSFER" | "PAYPAL")
            }
            className={INPUT}
          >
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="PAYPAL">PayPal</option>
          </select>
        </label>

        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-content-secondary">
            Account name
          </span>
          <input
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            required
            minLength={2}
            maxLength={120}
            autoComplete="off"
            className={INPUT}
          />
        </label>

        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-content-secondary">
            {method === "PAYPAL" ? "PayPal email" : "Payment reference"}
          </span>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            required
            minLength={4}
            maxLength={120}
            autoComplete="off"
            className={INPUT}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11.5px] text-content-subtle">
          <ShieldCheck className="size-3.5" aria-hidden />
          Stored for payouts only. We never ask for a full account number here.
        </p>
        <div className="flex items-center gap-2">
          {hasDetails && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" loading={pending}>
            Save details
          </Button>
        </div>
      </div>
    </form>
  );
}

const INPUT =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-[13px] text-content outline-none transition-colors placeholder:text-content-subtle focus:border-line-strong";
