"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import { CheckCircle2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input } from "@/components/ui/form";
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, SIGNATURE_NOTICE, SIGNATURE_TYPE_LABEL } from "@/lib/esign/notice";

type NextStep = { kind: "PAY"; label: string; url: string } | { kind: "NONE"; message: string };

/**
 * Accept and sign, on the public quote page. The POST carries the page's
 * form nonce, a custom header (so a cross-site form cannot send it), and one
 * idempotency key per page load, so a double click or a retry records one
 * signature. The server re-validates everything (public-sign.ts).
 *
 * With e-signature on the workspace's plan the customer types their name
 * and/or draws, ticks the consent box, and a sealed signature is recorded.
 * Without it, they accept with their name and the consent box.
 */
export function SignPanel({
  token,
  nonce,
  esign,
  requireDrawn,
  initialNextStep,
  signedAlready,
}: {
  token: string;
  nonce: string;
  esign: boolean;
  requireDrawn: boolean;
  initialNextStep: NextStep | null;
  signedAlready: boolean;
}) {
  const idempotencyKey = React.useMemo(() => crypto.randomUUID(), []);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [path, setPath] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ status: string; nextStep: NextStep | null } | null>(signedAlready ? { status: "SIGNED", nextStep: initialNextStep } : null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!consent) return setError("Tick the box to confirm you agree to sign electronically.");
    if (esign && !typed.trim() && !path) return setError("Type your name or draw your signature.");
    if (esign && requireDrawn && !path) return setError("Draw your signature in the box.");
    setBusy(true);
    try {
      const response = await fetch(`/q/${encodeURIComponent(token)}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-clientturn-quote": "1" },
        credentials: "same-origin",
        body: JSON.stringify({
          nonce,
          idempotencyKey,
          signerName: name,
          signerEmail: email,
          ...(title.trim() ? { signerTitle: title } : {}),
          ...(esign && typed.trim() ? { typedName: typed } : {}),
          ...(esign && path ? { drawn: { format: "SVG_PATH", data: path } } : {}),
          consent: true,
          consentVersion: CONSENT_TEXT_VERSION,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; status?: string; nextStep?: NextStep };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "That did not go through. Please try again.");
        return;
      }
      setDone({ status: body.status ?? "SIGNED", nextStep: body.nextStep ?? null });
    } catch {
      setError("You appear to be offline. Nothing was recorded; please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="rounded-2xl border border-success-100 bg-success-50 px-5 py-6 sm:px-8" aria-live="polite">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-600" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-content">{done.status === "ACCEPTED" ? "Quote accepted" : "Quote signed"}</h2>
            <p className="mt-1 text-[13.5px] text-content-secondary">
              {done.nextStep?.kind === "PAY"
                ? "Thank you. The next step is payment."
                : (done.nextStep?.message ?? "Thank you. We have your acceptance and will be in touch about the next steps.")}
            </p>
            {done.nextStep?.kind === "PAY" && (
              <Button asChild className="mt-4">
                <a href={done.nextStep.url} rel="noopener noreferrer" referrerPolicy="no-referrer">
                  {done.nextStep.label}
                </a>
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface px-5 py-6 shadow-sm sm:px-8" aria-labelledby="sign-heading" noValidate>
      <div>
        <h2 id="sign-heading" className="text-[16px] font-semibold text-content">{esign ? "Accept and sign" : "Accept this quote"}</h2>
        {esign && <p className="mt-0.5 text-[12.5px] text-content-muted">{SIGNATURE_TYPE_LABEL}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Your full name" htmlFor="sign-name" required>
          <Input id="sign-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </FormField>
        <FormField label="Work email" htmlFor="sign-email" required>
          <Input id="sign-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required />
        </FormField>
        <FormField label="Job title" htmlFor="sign-title" hint="Optional" className="sm:col-span-2">
          <Input id="sign-title" autoComplete="organization-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </FormField>
      </div>
      {esign && (
        <>
          <FormField label={requireDrawn ? "Type your name to sign (optional)" : "Type your name to sign"} htmlFor="sign-typed">
            <Input id="sign-typed" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={120} className="font-[cursive] text-[18px]" />
          </FormField>
          <SignaturePad value={path} onChange={setPath} required={requireDrawn} />
        </>
      )}
      <label className="flex items-start gap-2.5 text-[13px] text-content">
        <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" required />
        <span>{CONSENT_TEXT}</span>
      </label>
      <p className="text-[11.5px] leading-5 text-content-muted">{SIGNATURE_NOTICE}</p>
      <FormError message={error} />
      <Button type="submit" loading={busy} fullWidth>
        {esign ? "Sign and accept" : "Accept quote"}
      </Button>
    </form>
  );
}

/** A drawn signature as an SVG path (the format sealSignature stores and hashes). */
function SignaturePad({ value, onChange, required }: { value: string; onChange: (path: string) => void; required: boolean }) {
  const ref = React.useRef<SVGSVGElement>(null);
  const drawing = React.useRef(false);

  function point(event: React.PointerEvent<SVGSVGElement>) {
    const rect = ref.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 600;
    const y = ((event.clientY - rect.top) / rect.height) * 160;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-content">
          Draw your signature{required ? <span className="ml-0.5 text-danger-600" aria-hidden>*</span> : <span className="text-content-muted"> (optional)</span>}
        </span>
        {value && (
          <button type="button" onClick={() => onChange("")} className="inline-flex items-center gap-1 text-[12.5px] text-content-accent">
            <Eraser className="size-3.5" aria-hidden /> Clear
          </button>
        )}
      </div>
      <svg
        ref={ref}
        viewBox="0 0 600 160"
        role="img"
        aria-label="Signature drawing area"
        className="mt-1.5 h-32 w-full touch-none rounded-lg border border-dashed border-line-strong bg-surface-sunken"
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          onChange(`${value}${value ? " " : ""}M ${point(e)}`);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || value.length > 150_000) return;
          onChange(`${value} L ${point(e)}`);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerLeave={() => {
          drawing.current = false;
        }}
      >
        {value && <path d={value} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-content" />}
      </svg>
    </div>
  );
}
