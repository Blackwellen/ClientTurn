"use client";

import * as React from "react";
import { Check } from "lucide-react";
import {
  confirmPrivacyRequest,
  type VerifyResult,
} from "@/app/(marketing)/privacy-request/actions";
import { buttonClass } from "@/components/marketing/public/ui";

export function ConfirmRequestButton({ token }: { token: string }) {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<VerifyResult | null>(null);

  if (result?.ok) {
    return (
      <div className="pub-form-card">
        <div className="pub-form-done" role="status">
          <span className="pub-ring" aria-hidden>
            <Check className="size-5" />
          </span>
          <h2>Request {result.reference} confirmed</h2>
          <p>
            Thank you. We will acknowledge it within 30 days and respond within
            one month, by email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {result && !result.ok && (
        <div role="alert" className="pub-form-alert">
          {result.error}
        </div>
      )}
      <button
        type="button"
        className={buttonClass("primary", "md")}
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            setResult(await confirmPrivacyRequest(token));
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Confirming…" : "Confirm my request"}
      </button>
    </div>
  );
}
