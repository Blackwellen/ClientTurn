import "server-only";
import { INSTALLABLE_APPS } from "@/lib/integrations/apps";
import { PROVIDERS, type ProviderDefinition } from "@/lib/integrations/catalog";
import { brandMarkSrc } from "@/lib/integrations/brand-marks";
import { providerCategoryLabel } from "./integration-types";
import type {
  MarketingAvailability,
  ShowcaseConnector,
  ShowcaseProvider,
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

function providerAvailability(definition: ProviderDefinition): MarketingAvailability {
  const configured = platformConfigured(definition);

  // Resend is infrastructure ClientTurn runs on the customer's behalf. It is
  // never something they install, so it can only ever be "built in".
  if (definition.connection === "platform") {
    return configured ? "platform_managed" : "coming_soon";
  }

  // A workspace connection needs both the credentials and a way to start the
  // flow: an OAuth redirect, or a customer-pasted token.
  const connectable =
    definition.connectionMethod === "token" || Boolean(definition.connectPath);

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
    logo: brandMarkSrc(definition.id),
    availability: providerAvailability(definition),
  }));
}
