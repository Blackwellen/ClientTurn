# Security headers

Set for every path in `next.config.ts` (`headers()`). Gap audit §3 and quick win 4.

| Header | Value | Enforced |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | yes |
| `X-Content-Type-Options` | `nosniff` | yes |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | yes |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | yes |
| `X-Frame-Options` | `DENY` | yes |
| `Content-Security-Policy` | `frame-ancestors 'none'; object-src 'none'; base-uri 'self'` | yes |
| `Content-Security-Policy-Report-Only` | the full policy below | no, reports only |

## Why the full CSP is report-only

A `script-src` worth enforcing needs per-request nonces threaded through the Next.js
runtime (its inline bootstrap scripts) and the GSAP / Motion landing animations. A guessed
policy enforced today risks a blank landing page or a broken checkout. Report-only
blocks nothing and shows every violation in the browser console, and in Sentry's security
endpoint when `SENTRY_DSN` is set (`report-uri` is derived from the DSN). Tighten on that
evidence, then move it to the enforced header.

The report-only policy:

```
default-src 'self';
script-src 'self' 'unsafe-inline'            ('unsafe-eval' added in development only)
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;           R2 signed URLs, QR codes, upload previews
font-src 'self' data:;                       next/font self-hosts Geist
media-src 'self' blob: https:;               voice recordings via signed URLs
connect-src 'self' <supabase> <supabase wss> <sentry ingest>;
worker-src 'self' blob:;
frame-src 'self';
manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';
form-action 'self' <supabase> https://accounts.google.com https://checkout.stripe.com https://billing.stripe.com;
report-uri <sentry security endpoint, when a DSN is set>
```

`form-action` is report-only on purpose. Chrome applies it to the redirect chain after a
form post, and several flows leave the origin that way: Google sign-in (via Supabase),
Stripe Checkout and the Billing Portal, and about 15 integration OAuth connect flows
(HubSpot, Zoho, Calendly, Google, Meta, Slack, LinkedIn, TikTok...). Enforcing it would
need every one listed and kept up to date.

## Flows checked against the enforced headers

The enforced directives are the three that cannot break a working page:

| Flow | How it works | Affected by the enforced CSP? |
|---|---|---|
| Stripe Checkout / Billing Portal | server action returns a Stripe-hosted URL; the browser navigates to it | No: top-level navigation, no Stripe.js on our pages, no framing |
| Google sign-in | Supabase OAuth redirect to accounts.google.com and back | No: top-level navigation |
| Retell voice | calls are placed by Retell over the phone network; no browser SDK is used | No (and `microphone=()` stays denied; allow `microphone=(self)` on one route if a web SDK is ever added) |
| Landing page (GSAP / Motion, no WebGL since 2026-09-30) | scripts from our own origin | No: `object-src` and `base-uri` only |
| Public quote page `/q/[token]` and its PDF | our own origin; PDF opened as a download/new tab | No |
| Admin maintenance preview | `<iframe srcdoc sandbox>` inside our own page | No: `frame-ancestors` restricts who frames *us*; a srcdoc child inherits our policy and runs no script (sandbox) |
| Integration OAuth connect flows | top-level redirects | No |

`frame-ancestors 'none'` and `X-Frame-Options: DENY` were already live before this change.

## Next step

Watch the report-only violations for a week of real traffic (Sentry, Security reports),
then add nonces (`middleware`/`proxy` generating one per request and passing it to Next),
drop `'unsafe-inline'` from `script-src`, and move the policy to the enforced header.
