"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check } from "lucide-react";
import {
  submitPrivacyRequest,
  type PrivacyRequestFormResult,
} from "@/app/(marketing)/privacy-request/actions";
import {
  PRIVACY_REQUEST_TYPE_COPY,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestKind,
} from "@/lib/data-rights/types";
import { buttonClass } from "@/components/marketing/public/ui";

/**
 * The public privacy request form. Validation here is a convenience; the
 * server action re-validates everything and decides.
 */
export function PrivacyRequestForm() {
  const [state, action, pending] = useActionState<PrivacyRequestFormResult | null, FormData>(
    submitPrivacyRequest,
    null,
  );
  const [type, setType] = React.useState<PrivacyRequestKind>("ACCESS");
  const errorRef = React.useRef<HTMLDivElement>(null);
  const startedAt = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (startedAt.current) startedAt.current.value = String(Date.now());
  }, []);

  React.useEffect(() => {
    if (state?.ok === false) errorRef.current?.focus();
  }, [state]);

  if (state?.ok === true) {
    return (
      <div className="pub-form-card">
        <div className="pub-form-done" role="status">
          <span className="pub-ring" aria-hidden>
            <Check className="size-5" />
          </span>
          <h2>Check your email to confirm</h2>
          <p>
            We have recorded your request (reference {state.reference}) and sent
            a confirmation link to the address you gave. Open it within 72 hours
            so we know the request came from you. We acknowledge every request
            within 30 days and respond within one month.
          </p>
        </div>
      </div>
    );
  }

  const fieldError = (name: string) =>
    state?.ok === false && state.field === name ? state.error : null;

  return (
    <form action={action} className="pub-form-card" noValidate>
      <h2>Make a request</h2>
      <p className="pub-form-intro">
        Tell us who you are and what you would like us to do. We will email you
        a link to confirm the request is yours before we act on it.
      </p>

      {state?.ok === false && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="pub-form-alert">
          {state.error}
        </div>
      )}

      <label className="pub-field">
        <span>
          What would you like us to do? <em className="pub-req">*</em>
        </span>
        <select
          className="pub-select"
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value as PrivacyRequestKind)}
          aria-invalid={fieldError("type") ? true : undefined}
        >
          {PRIVACY_REQUEST_TYPES.map((value) => (
            <option key={value} value={value}>
              {PRIVACY_REQUEST_TYPE_COPY[value].label}
            </option>
          ))}
        </select>
        <span className="pub-field-hint">{PRIVACY_REQUEST_TYPE_COPY[type].hint}</span>
      </label>

      <div className="pub-field-pair">
        <label className="pub-field">
          <span>
            Your name <em className="pub-req">*</em>
          </span>
          <input
            className="pub-input"
            name="name"
            autoComplete="name"
            required
            maxLength={200}
            aria-invalid={fieldError("name") ? true : undefined}
            aria-describedby={fieldError("name") ? "name-error" : undefined}
          />
          {fieldError("name") && (
            <span id="name-error" className="pub-field-error">
              {fieldError("name")}
            </span>
          )}
        </label>

        <label className="pub-field">
          <span>
            Email address <em className="pub-req">*</em>
          </span>
          <input
            className="pub-input"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={320}
            aria-invalid={fieldError("email") ? true : undefined}
            aria-describedby={fieldError("email") ? "email-error" : undefined}
          />
          {fieldError("email") && (
            <span id="email-error" className="pub-field-error">
              {fieldError("email")}
            </span>
          )}
        </label>
      </div>

      <label className="pub-field">
        <span>Phone number</span>
        <input
          className="pub-input"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={40}
        />
        <span className="pub-field-hint">
          Only if the business contacted you by phone, SMS or WhatsApp.
        </span>
      </label>

      <label className="pub-field">
        <span>Which company contacted you?</span>
        <input className="pub-input" name="context" maxLength={2000} />
        <span className="pub-field-hint">
          ClientTurn is used by other businesses to contact people. Naming the
          business helps us route your request to them quickly.
        </span>
      </label>

      <label className="pub-field">
        <span>Details</span>
        <textarea className="pub-textarea" name="details" rows={4} maxLength={4000} />
        <span className="pub-field-hint">
          For a correction, say what is wrong and what it should say. To
          challenge a decision, say which one.
        </span>
      </label>

      {/* Honeypot: invisible to people, filled by bots. */}
      <input
        type="text"
        name="website_confirm"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
      />
      <input ref={startedAt} type="hidden" name="startedAt" />

      <label className="pub-field flex-row items-start gap-2">
        <input type="checkbox" name="confirm" className="mt-1" required />
        <span>
          This request is about my own personal data. <em className="pub-req">*</em>
        </span>
      </label>
      {fieldError("confirm") && (
        <span className="pub-field-error">{fieldError("confirm")}</span>
      )}

      <button type="submit" className={buttonClass("primary", "md")} disabled={pending}>
        {pending ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
