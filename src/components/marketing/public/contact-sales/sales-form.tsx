"use client";

import * as React from "react";
import { useActionState } from "react";
import { ArrowRight, Check, Lock } from "lucide-react";
import {
  submitSalesEnquiry,
  type EnquiryResult,
} from "@/app/(marketing)/contact-sales/actions";
import {
  COMPANY_SIZES,
  LEAD_VOLUME_OPTIONS,
  USE_CASES,
  CURRENT_SYSTEMS,
} from "@/lib/marketing/sales-enquiry-options";
import { captureAttribution } from "@/lib/marketing/attribution";
import { trackEngagement } from "@/lib/marketing/track";

/**
 * The sales enquiry form.
 *
 * Every field has a visible label, a required marker where it applies and an
 * autocomplete token, so a browser can fill it and a screen-reader user is
 * never guessing what a control is for. Errors are announced once, at the top,
 * and the offending field is marked `aria-invalid` and pointed at the message
 * with `aria-describedby` — one error, said once, reachable from the field.
 *
 * Validation here is a convenience only. `submitSalesEnquiry` re-validates
 * everything on the server, which is what actually decides.
 */

const MESSAGE_LIMIT = 1000;

export function SalesForm() {
  const [state, action, pending] = useActionState<EnquiryResult | null, FormData>(
    submitSalesEnquiry,
    null,
  );
  const [message, setMessage] = React.useState("");
  const [started, setStarted] = React.useState(false);
  const errorRef = React.useRef<HTMLDivElement>(null);
  const startedAt = React.useRef<HTMLInputElement>(null);

  // Set once on mount: the server compares it against submission time to
  // reject a form filled faster than a person could fill it.
  React.useEffect(() => {
    if (startedAt.current) startedAt.current.value = String(Date.now());
  }, []);

  const attribution = React.useMemo(
    () => (typeof window === "undefined" ? null : captureAttribution()),
    [],
  );

  React.useEffect(() => {
    if (state?.ok === true) trackEngagement("contact_sales_success");
    if (state?.ok === false) {
      trackEngagement("contact_sales_error");
      errorRef.current?.focus();
    }
  }, [state]);

  function onFirstInput() {
    if (started) return;
    setStarted(true);
    trackEngagement("contact_sales_form_start");
  }

  if (state?.ok === true) {
    return (
      <div className="pub-form-card">
        <div className="pub-form-done" role="status">
          <span className="pub-ring" aria-hidden>
            <Check className="size-5" />
          </span>
          <h2>Thank you — your enquiry is with us.</h2>
          <p>
            A member of the team will read it and get back to you by email. If
            it is urgent, or you would rather talk it through now, reply to any
            message from us and it reaches the same place.
          </p>
        </div>
      </div>
    );
  }

  const fieldError = (name: string) =>
    state?.ok === false && state.field === name ? state.error : null;

  const describedBy = (name: string) =>
    fieldError(name) ? `${name}-error` : undefined;

  return (
    <form action={action} className="pub-form-card" onInput={onFirstInput} noValidate>
      <h2>Request a call</h2>
      <p className="pub-form-intro">
        Tell us a bit about your business and we will be in touch to arrange a
        call at a time that suits you.
      </p>

      {state?.ok === false && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="pub-form-alert"
        >
          {state.error}
        </div>
      )}

      <div className="pub-field-pair">
        <label className="pub-field">
          <span>
            First name <em className="pub-req">*</em>
          </span>
          <input
            className="pub-input"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={80}
            aria-invalid={fieldError("firstName") ? true : undefined}
            aria-describedby={describedBy("firstName")}
            placeholder="First name"
          />
          {fieldError("firstName") && (
            <span id="firstName-error" className="pub-field-error">
              {fieldError("firstName")}
            </span>
          )}
        </label>

        <label className="pub-field">
          <span>
            Last name <em className="pub-req">*</em>
          </span>
          <input
            className="pub-input"
            name="lastName"
            autoComplete="family-name"
            required
            maxLength={80}
            aria-invalid={fieldError("lastName") ? true : undefined}
            aria-describedby={describedBy("lastName")}
            placeholder="Last name"
          />
          {fieldError("lastName") && (
            <span id="lastName-error" className="pub-field-error">
              {fieldError("lastName")}
            </span>
          )}
        </label>
      </div>

      <label className="pub-field">
        <span>
          Work email <em className="pub-req">*</em>
        </span>
        <input
          className="pub-input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={200}
          aria-invalid={fieldError("email") ? true : undefined}
          aria-describedby={describedBy("email")}
          placeholder="name@company.com"
        />
        {fieldError("email") && (
          <span id="email-error" className="pub-field-error">
            {fieldError("email")}
          </span>
        )}
      </label>

      <label className="pub-field">
        <span>
          Company <em className="pub-req">*</em>
        </span>
        <input
          className="pub-input"
          name="company"
          autoComplete="organization"
          required
          maxLength={160}
          aria-invalid={fieldError("company") ? true : undefined}
          aria-describedby={describedBy("company")}
          placeholder="Your company name"
        />
        {fieldError("company") && (
          <span id="company-error" className="pub-field-error">
            {fieldError("company")}
          </span>
        )}
      </label>

      <label className="pub-field">
        <span>
          Website <span className="pub-opt">(optional)</span>
        </span>
        <input
          className="pub-input"
          name="website"
          type="url"
          inputMode="url"
          autoComplete="url"
          maxLength={300}
          placeholder="https://"
        />
      </label>

      <div className="pub-field-pair">
        <label className="pub-field">
          <span>
            Company size <em className="pub-req">*</em>
          </span>
          <select
            className="pub-select"
            name="companySize"
            required
            defaultValue=""
            aria-invalid={fieldError("companySize") ? true : undefined}
            aria-describedby={describedBy("companySize")}
          >
            <option value="" disabled>
              Select company size
            </option>
            {COMPANY_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} people
              </option>
            ))}
          </select>
          {fieldError("companySize") && (
            <span id="companySize-error" className="pub-field-error">
              {fieldError("companySize")}
            </span>
          )}
        </label>

        <label className="pub-field">
          <span>
            Monthly lead volume <em className="pub-req">*</em>
          </span>
          <select
            className="pub-select"
            name="leadVolume"
            required
            defaultValue=""
            aria-invalid={fieldError("leadVolume") ? true : undefined}
            aria-describedby={describedBy("leadVolume")}
          >
            <option value="" disabled>
              Select volume
            </option>
            {LEAD_VOLUME_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {fieldError("leadVolume") && (
            <span id="leadVolume-error" className="pub-field-error">
              {fieldError("leadVolume")}
            </span>
          )}
        </label>
      </div>

      <label className="pub-field">
        <span>
          Primary use case <em className="pub-req">*</em>
        </span>
        <select
          className="pub-select"
          name="useCase"
          required
          defaultValue=""
          aria-invalid={fieldError("useCase") ? true : undefined}
          aria-describedby={describedBy("useCase")}
        >
          <option value="" disabled>
            Select an option
          </option>
          {USE_CASES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {fieldError("useCase") && (
          <span id="useCase-error" className="pub-field-error">
            {fieldError("useCase")}
          </span>
        )}
      </label>

      {/*
        A fieldset rather than a multi-select: this is optional context for a
        first conversation, and nobody should have to operate a multi-select on
        a phone to tell us they use a CRM.
      */}
      <fieldset className="pub-field">
        <legend className="mb-1.5 block text-[0.78rem] font-semibold text-[#35405a]">
          Current systems <span className="pub-opt">(optional)</span>
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {CURRENT_SYSTEMS.map((system) => (
            <label
              key={system}
              className="flex items-center gap-2 text-[0.78rem] text-[#4a5568]"
            >
              <input
                type="checkbox"
                name="currentSystems"
                value={system}
                className="size-4 accent-[#5b8f16]"
              />
              {system}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="pub-field">
        <span>
          Message <span className="pub-opt">(optional)</span>
        </span>
        <textarea
          className="pub-textarea"
          name="message"
          maxLength={MESSAGE_LIMIT}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby="message-counter"
          placeholder="Tell us about your goals or any specific requirements."
        />
        <span id="message-counter" className="pub-counter">
          {message.length} / {MESSAGE_LIMIT}
        </span>
      </label>

      {/*
        Separate, unchecked, and not a condition of submitting. Bundling
        marketing consent into a contact request is not consent.
      */}
      <label className="pub-consent">
        <input type="checkbox" name="marketingConsent" />
        <span>
          Send me occasional product updates by email. You can unsubscribe at
          any time, and this is not required to get a reply.
        </span>
      </label>

      {/* Bot trap. Off-screen for sighted users, hidden from assistive tech,
          and never focusable — a person cannot fill it in by accident. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company_website_confirm">Leave this field empty</label>
        <input
          id="company_website_confirm"
          name="company_website_confirm"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <input type="hidden" name="startedAt" ref={startedAt} defaultValue="" />
      <input
        type="hidden"
        name="anonymousId"
        value={attribution?.anonymousId ?? ""}
      />
      <input type="hidden" name="utmSource" value={attribution?.utmSource ?? ""} />
      <input type="hidden" name="utmMedium" value={attribution?.utmMedium ?? ""} />
      <input
        type="hidden"
        name="utmCampaign"
        value={attribution?.utmCampaign ?? ""}
      />
      <input type="hidden" name="utmContent" value={attribution?.utmContent ?? ""} />
      <input type="hidden" name="utmTerm" value={attribution?.utmTerm ?? ""} />
      <input type="hidden" name="referrer" value={attribution?.referrer ?? ""} />
      <input
        type="hidden"
        name="landingPath"
        value={attribution?.landingPath ?? ""}
      />

      <button type="submit" className="pub-submit" disabled={pending}>
        {pending ? "Sending…" : "Request a call"}
        {!pending && <ArrowRight aria-hidden className="size-4" />}
      </button>

      <p className="pub-privacy">
        <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>
          We will only use your information to respond to your enquiry. See our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </span>
      </p>
    </form>
  );
}
