#!/usr/bin/env node
/**
 * Send a correctly signed Stripe webhook to a locally running app.
 *
 * The Stripe CLI is the usual way to do this, but it needs installing and
 * authenticating, and a tunnel besides. This does the same job with nothing
 * but Node: it builds the event JSON, signs it exactly as Stripe does
 * (`t=<ts>,v1=<hmac-sha256 of "<ts>.<payload>">`) using
 * STRIPE_WEBHOOK_SECRET_LOCAL, and POSTs it to the route.
 *
 * It is a development tool and refuses to target anything but localhost, so a
 * stray argument cannot fire a forged event at production.
 *
 * Usage:
 *   node scripts/stripe-local-event.mjs list
 *   node scripts/stripe-local-event.mjs tokens <purchase_id>
 *   node scripts/stripe-local-event.mjs tokens-expired <purchase_id>
 *   node scripts/stripe-local-event.mjs subscription-created <business_id>
 *
 * `list` prints recent PENDING token purchases so you have an id to use.
 */

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// ----------------------------------------------------------------- config

/** Minimal .env reader: the app loads these through Next, scripts do not. */
function readEnv() {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

// Real environment wins over the files, so a one-off run can target a dev
// server on another port without editing .env.local.
const env = { ...readEnv(), ...process.env };
const secret = env.STRIPE_WEBHOOK_SECRET_LOCAL;
const baseUrl = env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

if (!secret) {
  console.error("STRIPE_WEBHOOK_SECRET_LOCAL is not set in .env.local");
  process.exit(1);
}

// A forged-but-valid signature is only safe against your own machine.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) {
  console.error(
    `Refusing to send: NEXT_PUBLIC_SITE_URL is "${baseUrl}", not localhost.\n` +
      "This script signs events itself and must never target a deployed site.",
  );
  process.exit(1);
}

const endpoint = `${baseUrl}/api/webhooks/stripe`;

// ---------------------------------------------------------------- events

function envelope(type, object) {
  return {
    id: `evt_local_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "event",
    api_version: "2025-01-01",
    created: Math.floor(Date.now() / 1000),
    type,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object },
  };
}

function checkoutSession({ purchaseId, paid }) {
  return envelope(
    paid ? "checkout.session.completed" : "checkout.session.expired",
    {
      id: `cs_test_local_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      object: "checkout.session",
      mode: "payment",
      // The handler keys on exactly these three fields.
      payment_status: paid ? "paid" : "unpaid",
      payment_intent: paid ? `pi_test_local_${Date.now()}` : null,
      metadata: { kind: "ai_tokens", purchase_id: purchaseId },
    },
  );
}

function subscriptionCreated(businessId) {
  const now = Math.floor(Date.now() / 1000);
  return envelope("customer.subscription.created", {
    id: `sub_test_local_${Date.now()}`,
    object: "subscription",
    status: "active",
    customer: `cus_test_local_${Date.now()}`,
    current_period_start: now,
    current_period_end: now + 30 * 24 * 60 * 60,
    cancel_at_period_end: false,
    metadata: { business_id: businessId },
    items: { data: [{ price: { id: env.STRIPE_PRICE_STARTER_MONTHLY ?? "price_unknown" } }] },
  });
}

// ------------------------------------------------------------------ send

async function send(event) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  });

  const body = await response.text();
  console.log(`${event.type} -> ${response.status}`);
  console.log(body.slice(0, 400));

  if (!response.ok) process.exitCode = 1;
}

// ------------------------------------------------------------------ list

async function listPending() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Supabase env vars are not set, so purchases cannot be listed.");
    process.exit(1);
  }

  const response = await fetch(
    `${url}/rest/v1/ai_token_purchases?select=id,pack_key,tokens,status,created_at` +
      `&order=created_at.desc&limit=10`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("No token purchases yet. Start one from Settings > Billing first.");
    return;
  }

  for (const row of rows) {
    console.log(`${row.id}  ${row.status.padEnd(9)} ${row.tokens} tokens  ${row.pack_key}`);
  }
}

// ------------------------------------------------------------------ main

const [command, argument] = process.argv.slice(2);

switch (command) {
  case "list":
    await listPending();
    break;
  case "tokens":
    if (!argument) throw new Error("usage: tokens <purchase_id>");
    await send(checkoutSession({ purchaseId: argument, paid: true }));
    break;
  case "tokens-expired":
    if (!argument) throw new Error("usage: tokens-expired <purchase_id>");
    await send(checkoutSession({ purchaseId: argument, paid: false }));
    break;
  case "subscription-created":
    if (!argument) throw new Error("usage: subscription-created <business_id>");
    await send(subscriptionCreated(argument));
    break;
  default:
    console.log(
      [
        "Send a signed Stripe webhook to the local app.",
        "",
        "  list                            recent token purchases (for an id)",
        "  tokens <purchase_id>            checkout.session.completed, paid",
        "  tokens-expired <purchase_id>    checkout.session.expired",
        "  subscription-created <biz_id>   customer.subscription.created",
        "",
        `Target: ${endpoint}`,
      ].join("\n"),
    );
}
