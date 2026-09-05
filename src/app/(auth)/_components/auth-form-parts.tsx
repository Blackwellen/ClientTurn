"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { scorePassword } from "@/lib/validation/auth";

export function AuthError({ message }: { message?: string }) {
  return (
    <div role="alert" aria-live="assertive" className="empty:hidden">
      {message ? (
        <div
          className="mb-5 flex items-start gap-2.5 rounded-[10px] px-3.5 py-3"
          style={{ background: "rgba(255,95,100,0.08)", border: "1px solid rgba(255,95,100,0.28)" }}
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--auth-danger)]" aria-hidden />
          <p className="text-[13px] text-[var(--auth-danger-text)]">{message}</p>
        </div>
      ) : null}
    </div>
  );
}

export function AuthSuccess({ message }: { message?: string }) {
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {message ? (
        <div
          className="mb-5 flex items-start gap-2.5 rounded-[10px] px-3.5 py-3"
          style={{ background: "rgba(168,255,31,0.08)", border: "1px solid rgba(168,255,31,0.28)" }}
        >
          <Check className="mt-0.5 size-4 shrink-0 text-[var(--auth-lime)]" aria-hidden />
          <p className="text-[13px] text-[var(--auth-text)]">{message}</p>
        </div>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "group relative flex h-[56px] w-full items-center justify-center gap-2 overflow-hidden rounded-[11px] text-[16px] font-bold",
        "bg-[var(--auth-lime)] text-[var(--auth-on-lime)] transition-all duration-200",
        "hover:-translate-y-px hover:shadow-[0_14px_38px_rgba(168,255,31,0.28)]",
        "active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]",
      )}
      style={{ background: "linear-gradient(135deg, var(--auth-lime-hover), var(--auth-lime))" }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/35 opacity-0 transition-[transform,opacity] duration-700 ease-out group-hover:translate-x-[340%] group-hover:opacity-100"
      />
      <span className="relative flex items-center gap-2">
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {pendingLabel ?? "Working…"}
          </>
        ) : (
          <>
            {children}
            <ArrowRight className="size-4.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </>
        )}
      </span>
    </button>
  );
}

function fieldDescribedBy(id: string, error?: string, hint?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) {
    return (
      <p id={`${id}-error`} className="mt-1.5 text-[12.5px] text-[var(--auth-danger-text)]">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={`${id}-hint`} className="mt-1.5 text-[12.5px] text-[var(--auth-text-subtle)]">
        {hint}
      </p>
    );
  }
  return null;
}

const INPUT_BASE = cn(
  "h-[56px] w-full rounded-[var(--auth-radius-input)] text-[15.5px]",
  "bg-[var(--auth-input-bg)] text-[#e8edf4] placeholder:text-[#768499] shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]",
  "border transition-[border-color,box-shadow] duration-150 outline-none",
  "focus:border-[rgba(168,255,31,0.75)] focus:ring-[4px] focus:ring-[rgba(168,255,31,0.12)]",
  "aria-[invalid=true]:border-[var(--auth-danger)]",
);

export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  error,
  hint,
  value,
  onChange,
  required,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  error?: string;
  hint?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14.5px] font-semibold text-[#f6f8fb]">
        {label}
      </label>
      <div className="relative">
        <Lock
          className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-[var(--auth-text-subtle)]"
          aria-hidden
        />
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          placeholder={label === "New password" ? "Choose a strong password" : "Enter your password"}
          className={cn(INPUT_BASE, "border-[var(--auth-input-border)] pr-12 pl-12")}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(id, error, hint)}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[var(--auth-text-subtle)] transition-opacity duration-150 hover:text-[var(--auth-text)]"
        >
          {visible ? <EyeOff className="size-4.5" aria-hidden /> : <Eye className="size-4.5" aria-hidden />}
        </button>
      </div>
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

export function PasswordStrength({ value }: { value: string }) {
  const { score } = scorePassword(value);
  if (!value) return null;

  return (
    <div className="mt-2.5 flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              step <= score ? "bg-[var(--auth-lime)]" : "bg-white/10",
            )}
          />
        ))}
      </div>
      <p className="shrink-0 text-[12.5px] font-medium text-[var(--auth-text-muted)]" aria-live="polite">
        {STRENGTH_LABELS[score]}
      </p>
    </div>
  );
}

export function TextField({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  placeholder,
  error,
  hint,
  required,
  inputMode,
  icon: Icon,
}: {
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  icon?: LucideIcon;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14.5px] font-semibold text-[#f6f8fb]">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-[var(--auth-text-subtle)]"
            aria-hidden
          />
        )}
        <input
          id={id}
          name={name}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          className={cn(INPUT_BASE, "border-[var(--auth-input-border)]", Icon ? "pl-12" : "pl-4", "pr-4")}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(id, error, hint)}
        />
      </div>
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

const REQUIREMENTS: { label: string; test: (v: string) => boolean }[] = [
  { label: "At least 8 characters", test: (v) => v.length >= 8 },
  { label: "One uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { label: "One lowercase letter", test: (v) => /[a-z]/.test(v) },
  { label: "One number", test: (v) => /[0-9]/.test(v) },
  { label: "One special character", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

/** Visual guidance only — the binding rule remains `passwordSchema` (8+
 * chars, a letter and a number); this checklist never gates submission. */
export function PasswordRequirements({ value }: { value: string }) {
  return (
    <ul
      className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 rounded-[12px] px-4 py-3.5 sm:grid-cols-2"
      style={{
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {REQUIREMENTS.map((req) => {
        const met = req.test(value);
        return (
          <li
            key={req.label}
            className={cn(
              "flex items-center gap-2 text-[12.5px] transition-colors duration-200",
              met ? "text-[var(--auth-text)]" : "text-[var(--auth-text-subtle)]",
            )}
          >
            <Check
              className={cn(
                "size-3.5 shrink-0 transition-colors duration-200",
                met ? "text-[var(--auth-lime)]" : "text-[#3a4453]",
              )}
              strokeWidth={3}
              aria-hidden
            />
            {req.label}
          </li>
        );
      })}
    </ul>
  );
}

export function AuthSuccessState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className="mt-6 flex items-start gap-3.5 rounded-[14px] p-4"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(168,255,31,0.1)] text-[var(--auth-lime)]">
        <Mail className="size-4.5" aria-hidden />
      </span>
      <div>
        <p className="text-[14.5px] font-semibold text-[var(--auth-text)]">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--auth-text-muted)]">{description}</p>
      </div>
    </div>
  );
}

export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6 space-y-1.5">
      <h1 className="text-xl font-semibold tracking-tight text-content">{title}</h1>
      {description && <p className="text-[13px] text-content-secondary">{description}</p>}
    </div>
  );
}
