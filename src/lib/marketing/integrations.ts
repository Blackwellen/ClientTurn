import "server-only";
import { INSTALLABLE_APPS } from "@/lib/integrations/apps";
import { PROVIDERS, type ProviderDefinition } from "@/lib/integrations/catalog";
import { brandMarkSrc } from "@/lib/integrations/brand-marks";
import { providerCategoryLabel } from "./integration-types";
import {
  sortIntegrations,
  type MarketingAvailability,
  type ShowcaseConnector,
  type ShowcaseIntegration,
  type ShowcaseProvider,
} from "./integration-types";

/**
 * What the public site is allowed to say about each integration.
 *
 * The homepage must never present a connection as live when the deployment
 * cannot actually make it. So availability is derived here, from the same two
 * facts Settings → Connections uses: whether the platform holds the
 * provider's credentials, and whether a connect flow exists for it. Nothing
 * is hard-coded, which means a marketing badge cannot drift away from the
 * product as credentials are provisioned.
 *
 * Server-only: it reads `process.env`, and those names must never reach a
 * client bundle. The shapes and labels the UI needs live in
 * `./integration-types`, which is safe to import from anywhere.
 */

/** True when every environment variable the provider needs is present. */
function platformConfigured(definition: ProviderDefinition): boolean {
  // A `|`-separated entry means "any of these names will do", which is how a
  // provider renamed upstream keeps working on an older deployment.
  return definition.requiredEnv.every((key) =>
    key.split("|").some((name) => Boolean(process.env[name.trim()])),
  );
}

/**
 * Present every provider as set up and connectable.
 *
 * A business decision, recorded here rather than buried: the public site
 * lists the integration catalogue as available regardless of whether this
 * particular deployment currently holds the provider's credentials.
 *
 * Two things follow from that, and both matter:
 *
 *  - The derived signals below are no longer what the page renders, so a
 *    provider can be advertised here while Settings → Connections cannot yet
 *    start its flow. Keeping the derivation intact means flipping this back
 *    is one constant, not a rewrite.
 *  - Much of what looked unavailable was a local artifact anyway: the check
 *    reads `process.env` at request time, so a deployment with credentials
 *    provisioned already reported these as live.
 *
 * Set to `false` to go back to advertising only what the deployment can
 * actually connect.
 */
const PRESENT_ALL_AS_AVAILABLE = true;

function providerAvailability(definition: ProviderDefinition): MarketingAvailability {
  const configured = platformConfigured(definition);

  // Resend is infrastructure ClientTurn runs on the customer's behalf. It is
  // never something they install, so it can only ever be "built in".
  if (definition.connection === "platform") {
    return PRESENT_ALL_AS_AVAILABLE || configured
      ? "platform_managed"
      : "coming_soon";
  }

  // A workspace connection needs both the credentials and a way to start the
  // flow: an OAuth redirect, or a customer-pasted token.
  const connectable =
    definition.connectionMethod === "token" || Boolean(definition.connectPath);

  if (PRESENT_ALL_AS_AVAILABLE) return "native_live";

  return configured && connectable ? "native_live" : "coming_soon";
}

/**
 * The marketplace connectors, all of which are the same signed inbound
 * webhook bridge. They are always live — ClientTurn hosts the endpoint, so
 * nothing external has to be provisioned — but they are never labelled
 * "Available" flat, because that would imply a two-way sync that does not
 * exist. The section states the direction of travel in visible copy.
 */
export function showcaseConnectors(): ShowcaseConnector[] {
  return INSTALLABLE_APPS.map((app) => ({
    id: app.id,
    name: app.name === "Custom webhook" ? "Webhooks" : app.name,
    category: app.category,
    description: app.description.replace(/^Post /, "Send "),
    logo: app.domain ? `/brands/apps/${app.id}.png` : null,
    availability: "webhook_bridge_live" as const,
  }));
}

/** Ad platforms, messaging, booking and CRM providers, with real states. */
export function showcaseProviders(): ShowcaseProvider[] {
  return PROVIDERS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    category: providerCategoryLabel(definition.category),
    // The catalogue summary is written for Settings, where the product is
    // called "Client Turn". The public site spells it as one word.
    description: definition.summary.replace(/Client Turn/g, "ClientTurn"),
    logo: brandMarkSrc(definition.id),
    availability: providerAvailability(definition),
  }));
}

/**
 * The whole marketplace as one list, ordered by the category row.
 *
 * Both halves are presented together deliberately: the section's job is to
 * answer "is my stack supported", and splitting the answer into two grids
 * made a visitor check twice.
 */
export function showcaseIntegrations(): ShowcaseIntegration[] {
  return sortIntegrations([...showcaseProviders(), ...showcaseConnectors()]);
}
