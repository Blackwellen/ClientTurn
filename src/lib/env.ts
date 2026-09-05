import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
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
    secretKey: required("STRIPE_SECRET_KEY_TEST"),
    webhookSecret: optional("STRIPE_WEBHOOK_SECRET_CLIENTTURN"),
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
    accountSid: optional("TWILIO_ACCOUNT_SID") ?? optional("TWILIO_SID"),
    authToken: optional("TWILIO_AUTH_TOKEN") ?? optional("TWILIO_CLIENT_SECRET"),
    smsFrom: optional("TWILIO_SMS_FROM") ?? optional("TWILIO_PHONE_NUMBER"),
    messagingServiceSid: optional("TWILIO_MESSAGING_SERVICE_SID"),
    whatsappFrom: optional("TWILIO_WHATSAPP_FROM"),
    /** Public URL Twilio posts inbound messages to; used for signature checks. */
    webhookUrl: optional("TWILIO_WEBHOOK_URL"),
  },
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
  microsoftAds: {
    clientId: optional("MICROSOFT_ADS_CLIENT_ID"),
    clientSecret: optional("MICROSOFT_ADS_CLIENT_SECRET"),
    developerToken: optional("MICROSOFT_ADS_DEVELOPER_TOKEN"),
  },
  tiktokAds: {
    appId: optional("TIKTOK_APP_ID"),
    appSecret: optional("TIKTOK_APP_SECRET"),
  },
  linkedinAds: {
    clientId: optional("LINKEDIN_CLIENT_ID"),
    clientSecret: optional("LINKEDIN_CLIENT_SECRET"),
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
    clientSecret: optional("ZOHO_CLIENT_SECRET"),
  },
  cronSecret: optional("CRON_SECRET"),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
} as const;
