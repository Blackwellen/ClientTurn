import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

function testModeStripeKey(value: string): string {
  if (/^(sk|rk)_live_/.test(value)) {
    throw new Error(
      "STRIPE_SECRET_KEY_TEST holds a live-mode key. ClientTurn runs against Stripe test mode only.",
    );
  }
  return value;
}

/**
 * Server-only configuration. Importing this from a client component is a build
 * error, which is the point: none of these values may reach the browser.
 */
export const serverEnv = {
  supabase: {
    url: required("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },
  stripe: {
    /**
     * Only ever the TEST secret. `.env` also holds a live key for a different
     * product (CLAUDE.md, "Stripe safety"); nothing reads it, and a live key
     * pasted into this variable by mistake is refused rather than used.
     */
    secretKey: testModeStripeKey(required("STRIPE_SECRET_KEY_TEST")),
    /**
     * Stripe now splits deliveries into two destination kinds, and each signs
     * with its own secret:
     *
     *   snapshot -- the classic v1 events this product actually acts on
     *               (customer.subscription.*, invoice.*, checkout.session.*,
     *               charge.refunded)
     *   thin     -- the v2 `v2.core.*` family. Nothing here consumes them, but
     *               a destination that exists must still be verified and
     *               acknowledged or Stripe retries it indefinitely.
     *
     * Both point at the same route; the route verifies against whichever
     * secret matches. `legacy` is the pre-split secret, kept so an environment
     * that has not been migrated yet keeps working.
     */
    webhookSecrets: {
      snapshot: optional("STRIPE_WEBHOOK_SECRET_SNAPSHOT"),
      thin: optional("STRIPE_WEBHOOK_SECRET_THIN"),
      legacy: optional("STRIPE_WEBHOOK_SECRET_CLIENTTURN"),
      /**
       * Local development only: either the secret `stripe listen` prints, or
       * the one `scripts/stripe-local-event.mjs` signs with. Kept as its own
       * variable so a developer never has to overwrite the deployed test
       * secret to exercise the handler, and so forgetting to remove it cannot
       * silently authorise anything in production -- it simply will not be set
       * there.
       */
      local: optional("STRIPE_WEBHOOK_SECRET_LOCAL"),
    },
    /** Destination ids, for identifying a delivery in the Stripe dashboard. */
    webhookDestinations: {
      snapshot: optional("STRIPE_WEBHOOK_DESTINATION_ID_SNAPSHOT"),
      thin: optional("STRIPE_WEBHOOK_DESTINATION_ID_THIN"),
    },
    prices: {
      starter: {
        month: optional("STRIPE_PRICE_STARTER_MONTHLY"),
        year: optional("STRIPE_PRICE_STARTER_YEARLY"),
      },
      growth: {
        month: optional("STRIPE_PRICE_GROWTH_MONTHLY"),
        year: optional("STRIPE_PRICE_GROWTH_YEARLY"),
      },
      pro: {
        month: optional("STRIPE_PRICE_PRO_MONTHLY"),
        year: optional("STRIPE_PRICE_PRO_YEARLY"),
      },
      /**
       * Voice (OD-2), Stripe TEST prices the owner creates by hand; nothing
       * in the codebase creates Stripe objects. All optional: a missing id
       * makes the matching purchase refuse with an integration-required
       * message rather than throw.
       */
      voice: {
        /** The Pro £100/month voice item (200 minutes plus the number). */
        addonMonthly: optional("STRIPE_PRICE_VOICE_ADDON_MONTHLY"),
        /** The £11.99/month dedicated-number item. */
        numberMonthly: optional("STRIPE_PRICE_VOICE_NUMBER_MONTHLY"),
        /** One-off minute packs, by minutes. */
        packs: {
          100: optional("STRIPE_PRICE_VOICE_PACK_100"),
          250: optional("STRIPE_PRICE_VOICE_PACK_250"),
          500: optional("STRIPE_PRICE_VOICE_PACK_500"),
          1000: optional("STRIPE_PRICE_VOICE_PACK_1000"),
        } as Record<number, string | undefined>,
      },
    },
  },
  r2: {
    endpoint: optional("R2_ENDPOINT"),
    accessKeyId: optional("R2_ACCESS_KEY_ID"),
    secretAccessKey: optional("R2_SECRET_ACCESS_KEY"),
    bucket: process.env.R2_BUCKET || "clientturn",
  },
  azure: {
    endpoint: optional("AZURE_OPENAI_ENDPOINT"),
    apiKey: optional("AZURE_OPENAI_API_KEY"),
    apiVersion: optional("AZURE_OPENAI_API_VERSION"),
    deploymentDefault: optional("AZURE_OPENAI_DEPLOYMENT_DEFAULT"),
    deploymentFast: optional("AZURE_OPENAI_DEPLOYMENT_FAST"),
  },
  /**
   * Twilio. `TWILIO_SID` / `TWILIO_CLIENT_SECRET` are the names already present
   * in this environment; the canonical names win when both are set.
   */
  twilio: {
    /**
     * The **Account** SID — `AC…`. It is the path segment in every REST call
     * (`/Accounts/{AC…}/Messages.json`), and Twilio requires it there even when
     * the request authenticates with an API key.
     *
     * Distinct from `apiKeySid` on purpose. An API key SID (`SK…`) authenticates
     * perfectly well and is the safer credential to hold — it can be revoked
     * without rotating the account's own auth token — but putting one in the
     * path returns `20404 The requested resource was not found`. That is
     * exactly what was happening: `TWILIO_ACCOUNT_SID` held an `SK…` value, so
     * every SMS and WhatsApp send 404'd while the credentials themselves were
     * valid.
     */
    accountSid: optional("TWILIO_ACCOUNT_SID") ?? optional("TWILIO_SID"),
    /**
     * `SK…`, when authenticating with an API key rather than the account's own
     * auth token. Optional: with it, `TWILIO_ACCOUNT_SID` must still hold the
     * `AC…` value, because that is what every REST path is built from.
     */
    apiKeySid: optional("TWILIO_API_KEY_SID"),
    authToken: optional("TWILIO_AUTH_TOKEN") ?? optional("TWILIO_CLIENT_SECRET"),
    smsFrom: optional("TWILIO_SMS_FROM") ?? optional("TWILIO_PHONE_NUMBER"),
    messagingServiceSid: optional("TWILIO_MESSAGING_SERVICE_SID"),
    whatsappFrom: optional("TWILIO_WHATSAPP_FROM"),
    /** Public URL Twilio posts inbound messages to; used for signature checks. */
    webhookUrl: optional("TWILIO_WEBHOOK_URL"),
  },
  /**
   * Retell, the conversational layer of the voice sales agent (phase P2,
   * docs/VOICE.md). Absent key = voice is `integration-required` everywhere:
   * nothing dials, nothing throws. The same key verifies Retell webhooks
   * (only a key with the webhook badge does, research §2).
   */
  retell: {
    apiKey: optional("RETELL_API_KEY"),
    /** The platform's default Retell agent; a workspace may override it (voice_settings.provider_agent_id). */
    agentId: optional("RETELL_AGENT_ID"),
  },
  /** Voice runtime settings. */
  voice: {
    /**
     * The public origin Twilio and Retell call back to (voice webhooks, the
     * bundle status callback). Twilio signs the exact URL it posted to, so this
     * must be the public https origin. Falls back to NEXT_PUBLIC_SITE_URL.
     */
    webhookBaseUrl: optional("VOICE_WEBHOOK_BASE_URL"),
    /** Platform kill switch: "1"/"true" stops every AI call on every workspace. */
    callsDisabled: /^(1|true|yes)$/i.test(process.env.VOICE_CALLS_DISABLED ?? ""),
    /** Where Twilio emails regulatory bundle status (a platform ops mailbox). */
    bundleNotificationEmail: optional("VOICE_BUNDLE_NOTIFICATION_EMAIL"),
  },
  /**
   * Key used to encrypt credentials this product holds on a customer's
   * behalf (mailbox SMTP/IMAP passwords). Absent in development, in which
   * case email account setup reports itself as unavailable rather than
   * storing a password in the clear.
   */
  credentialEncryptionKey: optional("CREDENTIAL_ENCRYPTION_KEY"),
  resend: {
    apiKey: optional("RESEND_API_KEY"),
    from: process.env.RESEND_FROM || "Client Turn <notifications@clientturn.com>",
  },
  /** Force a messaging provider in development. "stub" | "twilio". */
  messagingProvider: optional("MESSAGING_PROVIDER"),
  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
  },
  googleAds: {
    clientId: optional("GOOGLE_ADS_CLIENT_ID") ?? optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_ADS_CLIENT_SECRET") ?? optional("GOOGLE_CLIENT_SECRET"),
    developerToken: optional("GOOGLE_ADS_DEVELOPER_TOKEN"),
  },
  /**
   * TikTok calls these `client_key` / `client_secret`, and that is how they
   * are provisioned in this environment. The older `TIKTOK_APP_ID` /
   * `TIKTOK_APP_SECRET` spelling is still accepted so an existing deployment
   * keeps working; TikTok's own naming wins when both are set.
   */
  tiktokAds: {
    appId: optional("TIKTOK_CLIENT_KEY") ?? optional("TIKTOK_APP_ID"),
    appSecret: optional("TIKTOK_CLIENT_SECRET") ?? optional("TIKTOK_APP_SECRET"),
  },
  linkedinAds: {
    clientId: optional("LINKEDIN_CLIENT_ID"),
    clientSecret: optional("LINKEDIN_CLIENT_SECRET"),
  },
  /**
   * Meta Lead Ads. One app covers both placements — a lead submitted from an
   * Instagram ad arrives through the same Page form edge as a Facebook one, so
   * there is no separate Instagram credential to hold.
   */
  meta: {
    appId: optional("META_APP_ID"),
    appSecret: optional("META_APP_SECRET"),
    /**
     * The token Meta echoes back during the webhook subscription handshake.
     * Separate from the app secret because it is typed into Meta's dashboard by
     * hand and is therefore the more likely of the two to leak; it authenticates
     * only the handshake, never a delivery, which `META_APP_SECRET` signs.
     */
    webhookVerifyToken: optional("META_WEBHOOK_VERIFY_TOKEN"),
    /**
     * The Embedded Signup configuration Meta generates when the WhatsApp use
     * case is set up. Without it the connect dialog is an ordinary Facebook
     * login that grants scopes and creates no WhatsApp account — so its absence
     * makes the provider unavailable rather than silently broken.
     */
    whatsappConfigId: optional("META_WHATSAPP_CONFIG_ID"),
  },
  slack: {
    clientId: optional("SLACK_CLIENT_ID"),
    clientSecret: optional("SLACK_CLIENT_SECRET"),
    signingSecret: optional("SLACK_SIGNING_SECRET"),
  },
  hubspot: {
    // HubSpot private-app tokens are pasted by the customer, not held by the
    // platform, so there is nothing platform-level to configure here — the
    // integration is always offerable.
  },
  zohoCrm: {
    clientId: optional("ZOHO_CLIENT_ID"),
    // The base secret. Used for the "us" DC, and as the fallback for every
    // other DC (including one with no dedicated var below) when the API
    // Console client has "use the same OAuth credentials for all data
    // centers" enabled. See the header comment on zoho-crm.ts.
    clientSecret: optional("ZOHO_CLIENT_SECRET"),
    clientSecretEu: optional("ZOHO_CLIENT_SECRET_EU"),
    clientSecretIn: optional("ZOHO_CLIENT_SECRET_IN"),
    clientSecretAu: optional("ZOHO_CLIENT_SECRET_AU"),
    clientSecretJp: optional("ZOHO_CLIENT_SECRET_JP"),
    clientSecretCn: optional("ZOHO_CLIENT_SECRET_CN"),
    clientSecretCa: optional("ZOHO_CLIENT_SECRET_CA"),
  },
  /**
   * Calendly OAuth app, for connecting a *customer's* own calendar. Distinct
   * from `CALENDLY_API_KEY` (a personal token for the platform's own account,
   * read directly from `process.env` by `admin/providers.ts`'s health probe)
   * -- that token can never stand in for this app, because it authenticates
   * the platform's own Calendly account, not a customer's. Named to match the
   * pair already documented in `catalog.ts` and `docs/INTEGRATION_SETUP.md`.
   */
  calendly: {
    clientId: optional("CALENDLY_CLIENT_ID"),
    clientSecret: optional("CALENDLY_CLIENT_SECRET"),
    /**
     * One key for the whole OAuth app, not per subscription or per workspace.
     * Confirmed against developer.calendly.com/api-docs/overview/webhooks/webhook-signatures:
     * "When you create an OAuth 2.0 app, a webhook signing key will
     * automatically be generated for all webhooks related to your
     * application" -- the per-subscription caller-supplied signing key
     * documented elsewhere applies only to personal-access-token auth, which
     * this integration does not use. Shown once, at app-creation time, in the
     * Calendly developer console; lost afterward without contacting
     * support+developer@calendly.com.
     */
    webhookSigningKey: optional("CALENDLY_WEBHOOK_SIGNING_KEY"),
  },
  salesforce: {
    clientId: optional("SALESFORCE_CLIENT_ID"),
    clientSecret: optional("SALESFORCE_CLIENT_SECRET"),
  },
  /**
   * Sourcing data providers (Find Leads). All optional: an absent key makes
   * that adapter report itself unconfigured, and the waterfall skips it. A run
   * with no configured provider for a cost-bearing stage fails with a visible
   * issue rather than inventing records.
   */
  sourcing: {
    apolloApiKey: optional("APOLLO_API_KEY"),
    hunterApiKey: optional("HUNTER_API_KEY"),
    /**
     * Companies House. Free, and issued instantly from their developer portal.
     *
     * Worth having even in a workspace that buys no enrichment at all: it is
     * what turns "this looks like a company" into a register match, which is
     * the difference between asserting the corporate-subscriber exemption and
     * assuming it.
     */
    companiesHouseApiKey: optional("COMPANIES_HOUSE_API_KEY"),
    clearbitApiKey: optional("CLEARBIT_API_KEY"),
    googlePlacesApiKey: optional("GOOGLE_PLACES_API_KEY") ?? optional("GOOGLE_MAPS_API_KEY"),
    /** Meta Ad Library. A public-data token, not the Lead Ads app secret. */
    metaAdLibraryToken: optional("META_AD_LIBRARY_TOKEN"),
    /** TikTok Commercial Content Library (DSA transparency data). */
    tiktokCommercialToken: optional("TIKTOK_COMMERCIAL_CONTENT_TOKEN"),
    /**
     * TikTok organic engagement (comments on the workspace's own videos).
     *
     * A release gate rather than a credential — the credential is the
     * customer's own connected account. TikTok's `business/comment/list`
     * response shape could not be confirmed from any fetchable source, so the
     * adapter ships complete but switched off; one sandbox call confirming it
     * returns a commenter id is what should flip this on.
     */
    tiktokEngagementEnabled: optional("TIKTOK_ENGAGEMENT_ENABLED") === "1",
    /** Timeout applied to every outbound provider call, in milliseconds. */
    timeoutMs: Number(process.env.SOURCING_PROVIDER_TIMEOUT_MS || 15000),
  },
  /**
   * Social outreach that happens without a person clicking.
   *
   * An allow-list rather than a boolean, and empty by default. Automating a
   * customer's own social account is only defensible where a partner agreement
   * exists, and that agreement is per platform -- so the permission is granted
   * per platform too. See `lib/outreach/social-partners.ts` for why the
   * default is nothing.
   */
  social: {
    partnerSenders: (process.env.SOCIAL_PARTNER_SENDERS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  },
  cronSecret: optional("CRON_SECRET"),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
} as const;
