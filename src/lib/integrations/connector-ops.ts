import "server-only";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSecret, sealSecret } from "@/lib/security/secret-box";
import { recordAudit } from "@/lib/audit";
import { serverEnv } from "@/lib/env";
import { examplePayload } from "./connector-docs";

export { examplePayload, exampleCurl } from "./connector-docs";

/**
 * Operating an inbound connector after it has been installed (Programme §5).
 *
 * Installing a connector was the whole of what the product supported: a URL and
 * a secret. Everything a person actually needs *afterwards* — rotating the
 * secret, seeing what arrived, seeing what was lost, replaying it, and checking
 * the thing works at all — lives here.
 *
 * The rule that shapes this file: **a connector's health is measured by what it
 * delivered, not by whether a secret was saved.** A green tick that means "a
 * credential exists" is worse than no tick, because it is believed.
 */

/* ------------------------------------------------------------- endpoints */

export function connectorEndpoint(installId: string): string {
  return `${serverEnv.siteUrl}/api/apps/${installId}/events`;
}

/* ------------------------------------------------------------- rotation */

/**
 * Issues a new signing secret and returns it once.
 *
 * Rotation exists because the alternative when a secret leaks is uninstalling
 * and reinstalling, which loses the installation id — and the installation id
 * is in the URL the customer has already configured in someone else's product.
 *
 * Only HMAC installs rotate here. A bearer token or an API key is a credential
 * the *sending* system issues; ClientTurn cannot mint a new one on its behalf,
 * and pretending to would leave the customer with a secret their sender has
 * never heard of.
 */
export async function rotateSigningSecret(input: {
  businessId: string;
  userId: string;
  installId: string;
}): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const db = createAdminClient();

  const { data: install } = await db
    .from("workspace_app_installs")
    .select("id, app_key, auth_method")
    .eq("id", input.installId)
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!install) return { ok: false, error: "That connection could not be found." };

  if ((install.auth_method ?? "hmac_sha256") !== "hmac_sha256") {
    return {
      ok: false,
      error:
        "This connection authenticates with a credential issued by the sending system, so it has to be changed there and re-entered here.",
    };
  }

  const secret = randomBytes(32).toString("base64url");

  let sealed: string;
  let sealedCredentials: string;
  try {
    sealed = sealSecret(secret);
    sealedCredentials = sealSecret(JSON.stringify({ signing_secret: secret }));
  } catch {
    return { ok: false, error: "Credential encryption is not configured." };
  }

  const { error } = await db
    .from("workspace_app_installs")
    .update({
      secret_ciphertext: sealed,
      credentials_ciphertext: sealedCredentials,
      rotated_at: new Date().toISOString(),
      // The old credential's rejection history says nothing about the new one,
      // and leaving it would show a healthy connection as broken.
      last_failure_at: null,
      last_failure_reason: null,
    })
    .eq("id", input.installId)
    .eq("business_id", input.businessId);

  if (error) return { ok: false, error: "The secret could not be rotated." };

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "integration.connected",
    entityType: "workspace_app_install",
    entityId: input.installId,
    metadata: { app_key: install.app_key, rotated: true },
  });

  return { ok: true, secret };
}

/* ----------------------------------------------------------- test events */

/**
 * Sends a correctly-signed synthetic event through the real endpoint.
 *
 * Deliberately over the network to the actual route rather than by calling the
 * handler directly: the thing a customer wants proved is that *this URL, with
 * this credential, through whatever sits in front of it* accepts an event. A
 * test that bypasses the route proves the part that was never in doubt.
 *
 * The event carries an obviously synthetic id and a reserved example address,
 * so a test can be told apart from a real contact in the events list.
 */
export async function sendTestEvent(input: {
  businessId: string;
  installId: string;
}): Promise<{ ok: boolean; status: number; message: string }> {
  const db = createAdminClient();

  const { data: install } = await db
    .from("workspace_app_installs")
    .select("id, auth_method, secret_ciphertext, credentials_ciphertext, active")
    .eq("id", input.installId)
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!install) {
    return { ok: false, status: 404, message: "That connection could not be found." };
  }
  if (!install.active) {
    return { ok: false, status: 409, message: "That connection is switched off." };
  }
  if ((install.auth_method ?? "hmac_sha256") !== "hmac_sha256") {
    return {
      ok: false,
      status: 400,
      message:
        "A test can only be sent for signed connections. For the others, send an event from the system itself.",
    };
  }

  const opened = openSecret(install.secret_ciphertext);
  if (!opened) {
    return { ok: false, status: 500, message: "The signing secret could not be read." };
  }

  const payload = {
    ...examplePayload(),
    eventId: `clientturn-test-${randomUUID()}`,
    email: "test@example.com",
    phone: undefined,
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", opened)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  try {
    const response = await fetch(connectorEndpoint(input.installId), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ClientTurn-Timestamp": timestamp,
        "X-ClientTurn-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    return {
      ok: response.ok,
      status: response.status,
      message: response.ok
        ? "The endpoint accepted a signed test event."
        : `The endpoint refused the test with status ${response.status}.`,
    };
  } catch {
    // Almost always the site URL being wrong or unreachable from the server,
    // which is exactly the misconfiguration this button exists to surface.
    return {
      ok: false,
      status: 0,
      message: "The endpoint could not be reached from the server.",
    };
  }
}

/* --------------------------------------------------------------- replay */

/**
 * Puts a lost event back through processing.
 *
 * Only a failure whose payload was kept can be replayed, and a payload is only
 * kept when the sender authenticated — see `0065_connector_event_failures.sql`.
 * Replaying is idempotent through the same `external_event_id` uniqueness the
 * live path uses, so replaying an event that did eventually arrive is a no-op
 * rather than a duplicate lead.
 */
export async function replayFailedEvent(input: {
  businessId: string;
  userId: string;
  failureId: string;
}): Promise<{ ok: boolean; message: string }> {
  const db = createAdminClient();

  const { data: failure } = await db
    .from("connector_event_failures")
    .select("id, install_id, payload, external_event_id, status")
    .eq("id", input.failureId)
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!failure) return { ok: false, message: "That event could not be found." };
  if (failure.status !== "OPEN") {
    return { ok: false, message: "That event has already been dealt with." };
  }
  if (!failure.payload) {
    return {
      ok: false,
      message:
        "This event was refused before it was authenticated, so its contents were not kept and it cannot be replayed.",
    };
  }

  const eventId = failure.external_event_id ?? `replay-${failure.id}`;

  const { error } = await db.rpc("receive_workspace_app_event", {
    p_install_id: failure.install_id,
    p_event_id: eventId,
    p_payload: failure.payload,
  });

  if (error) return { ok: false, message: "The event could not be queued again." };

  await db
    .from("connector_event_failures")
    .update({
      status: "REPLAYED",
      replayed_at: new Date().toISOString(),
      resolved_by: input.userId,
    })
    .eq("id", input.failureId)
    .eq("business_id", input.businessId);

  return { ok: true, message: "The event has been queued." };
}

export async function dismissFailedEvent(input: {
  businessId: string;
  userId: string;
  failureId: string;
}): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db
    .from("connector_event_failures")
    .update({ status: "DISMISSED", resolved_by: input.userId })
    .eq("id", input.failureId)
    .eq("business_id", input.businessId)
    .eq("status", "OPEN")
    .select("id")
    .maybeSingle();

  return Boolean(data);
}

/* -------------------------------------------------------------- activity */

export type ConnectorActivity = {
  installId: string;
  /** Events accepted, ever. What the connection has actually delivered. */
  importedCount: number;
  lastImportAt: string | null;
  openFailures: number;
  recentFailures: {
    id: string;
    reason: string;
    externalEventId: string | null;
    replayable: boolean;
    createdAt: string;
  }[];
};

export async function loadConnectorActivity(
  businessId: string,
  installIds: string[],
): Promise<Map<string, ConnectorActivity>> {
  const activity = new Map<string, ConnectorActivity>();
  if (installIds.length === 0) return activity;

  const db = createAdminClient();

  for (const installId of installIds) {
    activity.set(installId, {
      installId,
      importedCount: 0,
      lastImportAt: null,
      openFailures: 0,
      recentFailures: [],
    });
  }

  const [{ data: totals }, { data: failures }] = await Promise.all([
    // Counted in SQL. This used to fetch up to 2,000 event rows and increment
    // a counter here, so `importedCount` -- documented as "events accepted,
    // ever" -- plateaued at 2,000 and stayed there, on exactly the connectors
    // busy enough for the number to matter.
    db.rpc("connector_install_activity", {
      p_business_id: businessId,
      p_install_ids: installIds,
    }),
    // Still rows, because these are shown individually. The count no longer
    // comes from here: 200 failures ordered by time can all belong to one
    // install, which reported zero open failures for a second connector that
    // was quietly failing.
    db
      .from("connector_event_failures")
      .select("id, install_id, reason, external_event_id, payload, created_at")
      .eq("business_id", businessId)
      .in("install_id", installIds)
      .eq("status", "OPEN")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  for (const row of totals ?? []) {
    const entry = activity.get(row.install_id);
    if (!entry) continue;
    entry.importedCount = Number(row.imported_count);
    entry.lastImportAt = row.last_import_at;
    entry.openFailures = Number(row.open_failures);
  }

  for (const failure of failures ?? []) {
    const entry = activity.get(failure.install_id);
    if (!entry) continue;
    if (entry.recentFailures.length < 5) {
      entry.recentFailures.push({
        id: failure.id,
        reason: failure.reason,
        externalEventId: failure.external_event_id,
        replayable: failure.payload !== null,
        createdAt: failure.created_at,
      });
    }
  }

  return activity;
}
