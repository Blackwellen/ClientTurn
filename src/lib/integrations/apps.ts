/**
 * The inbound connector catalogue.
 *
 * Read this before adding an entry: every connector here is the *same*
 * transport — a signed inbound HTTP endpoint that ClientTurn hosts and the
 * other system posts contacts to. ClientTurn never calls out to Pipedrive or
 * Attio, holds no OAuth grant, and cannot read or write anything in them. The
 * catalogue exists to name the systems people actually send from, not to
 * imply an integration that does not exist, which is why every entry carries
 * `kind: "inbound_webhook"` and the UI says so on every card.
 *
 * That shape also decides the credential model. For an inbound endpoint the
 * credentials are not the provider's — there is no provider API to
 * authenticate against — they are the ones the *sender* must present to us.
 * So the required fields follow the chosen authentication method, and a
 * connector declares which methods it can be configured with. Inventing an
 * "API key" field for a system we never call would be a lie in a form.
 */

export type CredentialFieldType =
  | "secret"
  | "text"
  | "url"
  | "number"
  | "boolean"
  | "select";

export type CredentialField = {
  key: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  /** Shown under the input. Say what the value is for, not what it is. */
  help?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  options?: readonly { value: string; label: string }[];
};

/**
 * How a sender proves an inbound request is really from them.
 *
 * HMAC is the default and the only one that survives a leaked log line: the
 * request is signed over its own body and a timestamp, so a captured request
 * cannot be replayed after five minutes and a captured *header* is useless on
 * its own. The bearer/API-key/basic modes exist because plenty of automation
 * tools cannot compute an HMAC in a no-code step, and a static credential
 * over TLS is meaningfully better than the "no auth" those tools would
 * otherwise push people towards. They are labelled as weaker in the UI rather
 * than presented as equivalent.
 */
export type AuthMethod = "hmac_sha256" | "bearer" | "api_key_header" | "basic";

export const AUTH_METHODS: Record<
  AuthMethod,
  {
    label: string;
    summary: string;
    /** Replay-resistant. Drives the "weaker" warning in the install form. */
    signed: boolean;
    fields: readonly CredentialField[];
  }
> = {
  hmac_sha256: {
    label: "Signed request (HMAC-SHA256)",
    summary:
      "Each request is signed over its own body and a timestamp. Recommended: a captured request cannot be replayed.",
    signed: true,
    fields: [
      {
        key: "signing_secret",
        label: "Signing secret",
        type: "secret",
        required: true,
        minLength: 32,
        maxLength: 200,
        placeholder: "At least 32 random characters",
        help: "Generate one here or paste your own. It is stored encrypted and never shown again.",
      },
    ],
  },
  bearer: {
    label: "Bearer token",
    summary:
      "The sender presents a fixed token in the Authorization header. Simpler to configure, but a leaked token stays valid until you rotate it.",
    signed: false,
    fields: [
      {
        key: "bearer_token",
        label: "Bearer token",
        type: "secret",
        required: true,
        minLength: 32,
        maxLength: 200,
        placeholder: "At least 32 random characters",
        help: "Sent as: Authorization: Bearer <token>",
      },
    ],
  },
  api_key_header: {
    label: "API key header",
    summary:
      "The sender presents a fixed key in a header you name. For tools that cannot set an Authorization header.",
    signed: false,
    fields: [
      {
        key: "header_name",
        label: "Header name",
        type: "text",
        required: true,
        maxLength: 64,
        placeholder: "x-api-key",
        help: "Lower-case letters, digits and hyphens.",
      },
      {
        key: "api_key",
        label: "API key",
        type: "secret",
        required: true,
        minLength: 32,
        maxLength: 200,
        placeholder: "At least 32 random characters",
      },
    ],
  },
  basic: {
    label: "Basic authentication",
    summary:
      "Username and password in the Authorization header. Accepted for legacy tools; prefer a signed request wherever the sender supports it.",
    signed: false,
    fields: [
      {
        key: "username",
        label: "Username",
        type: "text",
        required: true,
        maxLength: 100,
      },
      {
        key: "password",
        label: "Password",
        type: "secret",
        required: true,
        minLength: 24,
        maxLength: 200,
      },
    ],
  },
};

export const AUTH_METHOD_KEYS = Object.keys(AUTH_METHODS) as AuthMethod[];

/**
 * Configuration every connector takes regardless of how it authenticates.
 * These are not credentials and are stored in the clear, so nothing that
 * needs protecting belongs here.
 */
export const CONNECTOR_SETTINGS: readonly CredentialField[] = [
  {
    key: "label",
    label: "Connection name",
    type: "text",
    required: false,
    maxLength: 60,
    placeholder: "e.g. Pipedrive — UK pipeline",
    help: "Shown in Connections and against every contact this endpoint imports.",
  },
  {
    key: "source_id",
    label: "Source identifier",
    type: "text",
    required: false,
    maxLength: 40,
    placeholder: "Defaults to the connector name",
    help: "Recorded against each imported contact so Analytics can attribute it.",
  },
];

export type Connector = {
  readonly id: string;
  readonly name: string;
  readonly domain: string | null;
  readonly category: string;
  readonly description: string;
  /** The only transport this product offers today. See the module note. */
  readonly kind: "inbound_webhook";
  readonly authMethods: readonly AuthMethod[];
};

/** Every connector supports the same set today; declared per entry so a
 *  future connector that genuinely cannot sign is expressible without a
 *  rewrite of the form. */
const ALL_AUTH: readonly AuthMethod[] = [
  "hmac_sha256",
  "bearer",
  "api_key_header",
  "basic",
];

export const INSTALLABLE_APPS: readonly Connector[] = [
  { id: "pipedrive", name: "Pipedrive", domain: "pipedrive.com", category: "CRM", description: "Post selected CRM contacts into prospect review.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "instantly", name: "Instantly", domain: "instantly.ai", category: "Outreach", description: "Post selected outreach contacts into ClientTurn.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "clay", name: "Clay", domain: "clay.com", category: "Data", description: "Post enriched contacts from a Clay workflow.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "folk", name: "folk", domain: "folk.app", category: "CRM", description: "Post selected contacts from your relationship workspace.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "smartlead", name: "Smartlead", domain: "smartlead.ai", category: "Outreach", description: "Post outreach contacts into a shared review queue.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "breakcold", name: "Breakcold", domain: "breakcold.com", category: "CRM", description: "Post contacts from your relationship workflow.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "webhooks", name: "Custom webhook", domain: null, category: "Automation", description: "Post signed contact events from your own systems.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "zapier", name: "Zapier", domain: "zapier.com", category: "Automation", description: "Map contacts from a Zap into the inbound endpoint.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "heyreach", name: "HeyReach", domain: "heyreach.io", category: "Outreach", description: "Post selected contacts from your automation workflow.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "smartreach", name: "SmartReach", domain: "smartreach.io", category: "Outreach", description: "Post selected campaign contacts into ClientTurn.", kind: "inbound_webhook", authMethods: ALL_AUTH },
  { id: "attio", name: "Attio", domain: "attio.com", category: "CRM", description: "Post selected records from your Attio workspace.", kind: "inbound_webhook", authMethods: ALL_AUTH },
];

export function connectorFor(id: string): Connector | undefined {
  return INSTALLABLE_APPS.find((a) => a.id === id);
}

/** The credential fields an install form must render for a chosen method. */
export function fieldsFor(method: AuthMethod): readonly CredentialField[] {
  return AUTH_METHODS[method].fields;
}

/**
 * The connection's operational state, which is deliberately not the same
 * question as "has a secret been saved". A stored credential proves only that
 * someone filled in a form; until a request actually arrives and verifies,
 * the honest answer is that the connection is configured but unproven — so
 * the UI must never render "Connected" off the back of a successful save.
 */
export type ConnectorStatus =
  | "not_configured"
  | "configured"
  | "healthy"
  | "warning"
  | "failed"
  | "disabled";

export const CONNECTOR_STATUS_COPY: Record<
  ConnectorStatus,
  {
    label: string;
    tone: "neutral" | "success" | "warning" | "danger";
    detail: string;
  }
> = {
  not_configured: {
    label: "Not configured",
    tone: "neutral",
    detail: "No endpoint has been created yet.",
  },
  configured: {
    label: "Configured",
    tone: "neutral",
    detail: "Endpoint created. No verified request has arrived yet.",
  },
  healthy: {
    label: "Healthy",
    tone: "success",
    detail: "Recent requests verified and queued.",
  },
  warning: {
    label: "Warning",
    tone: "warning",
    detail: "Requests are arriving, but some were rejected.",
  },
  failed: {
    label: "Failed",
    tone: "danger",
    detail: "The most recent requests were all rejected.",
  },
  disabled: {
    label: "Disabled",
    tone: "neutral",
    detail: "Uninstalled. Further requests are refused.",
  },
};

/**
 * Derives the status from what the endpoint has actually done, never from
 * what was saved. `lastFailureAt` winning a tie is deliberate: if the most
 * recent thing that happened was a rejection, the connection is not healthy
 * no matter how many requests succeeded before it.
 */
export function statusFor(install: {
  active: boolean;
  lastReceivedAt: string | null;
  lastFailureAt: string | null;
} | null): ConnectorStatus {
  if (!install) return "not_configured";
  if (!install.active) return "disabled";

  const received = install.lastReceivedAt ? Date.parse(install.lastReceivedAt) : 0;
  const failed = install.lastFailureAt ? Date.parse(install.lastFailureAt) : 0;

  if (!received && !failed) return "configured";
  if (!received) return "failed";
  if (failed >= received) return "warning";
  return "healthy";
}
