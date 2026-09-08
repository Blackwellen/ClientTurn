import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { PLATFORM_SCOPES, SCOPE_DESCRIPTIONS } from "@/lib/platform/scopes";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";

export const dynamic = "force-dynamic";

/**
 * The API index.
 *
 * Unauthenticated on purpose: it describes the shape of the API and nothing
 * about any workspace. A developer with a key that is not working needs to be
 * able to see that the service is up and what it expects, without that being
 * the thing their key is failing at.
 *
 * It is generated from the same catalogues the runtime enforces, so it cannot
 * describe a permission that does not exist or omit one that does.
 */
export function GET() {
  return NextResponse.json({
    name: "ClientTurn API",
    version: "v1",
    // Built from the deployment's own origin rather than hard-coded. The
    // previous value was a guess at a domain and a path that does not exist —
    // a dead link in the one response a developer reads when nothing else is
    // working yet.
    documentation: `${serverEnv.siteUrl.replace(/\/$/, "")}/developers`,
    authentication: {
      scheme: "Bearer",
      header: "Authorization: Bearer ct_live_…",
      note: "Keys are created in Settings → Developer. Server-to-server only — a key must never be used from a browser.",
    },
    scopes: PLATFORM_SCOPES.map((scope) => ({
      scope,
      description: SCOPE_DESCRIPTIONS[scope],
    })),
    endpoints: [
      { method: "GET", path: "/api/v1/me", scope: "business:read" },
      { method: "GET", path: "/api/v1/leads", scope: "leads:read" },
      { method: "GET", path: "/api/v1/leads/{id}", scope: "leads:read" },
      { method: "PATCH", path: "/api/v1/leads/{id}", scope: "leads:write" },
      { method: "GET", path: "/api/v1/events", scope: "business:read" },
    ],
    webhook_events: WEBHOOK_EVENTS.map((event) => ({
      type: event.type,
      description: event.description,
    })),
    rate_limits: {
      per_key: "300 requests per minute",
    },
  });
}
