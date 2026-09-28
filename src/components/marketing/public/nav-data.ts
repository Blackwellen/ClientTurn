/**
 * Public site navigation.
 *
 * Every href here resolves to something that actually exists today: a real
 * route in `src/app`, or a section anchor on the homepage. The approved V2
 * navigation names surfaces (Lead Management, Prospecting, Guides, Blog,
 * Comparisons, per-industry pages, …) that have no route yet, and shipping a
 * menu full of 404s is worse than shipping a menu that lands the visitor on
 * the part of the homepage that answers the same question — so each of those
 * entries points at its homepage section until the destination page is built.
 *
 * When a destination route ships, change the href here and nowhere else: the
 * header, the mega menus, the mobile drawer and the footer all read this file.
 */

export type NavLink = {
  label: string;
  href: string;
  /** Shown under the label in mega menus. Omit for plain link lists. */
  description?: string;
};

export type MegaColumn = {
  heading: string;
  links: NavLink[];
};

export type NavItem =
  | { kind: "link"; label: string; href: string }
  | { kind: "mega"; label: string; id: string; columns: MegaColumn[]; footer?: NavLink };

/* ------------------------------------------------------------- anchors --- */

export const ANCHORS = {
  growthPaths: "/#growth-paths",
  howItWorks: "/#how-it-works",
  capabilities: "/#capabilities",
  proof: "/#proof",
  integrations: "/#integrations",
  industries: "/#industries",
  faq: "/#faq",
  revenueJourney: "/#revenue-journey",
  voiceAgent: "/#voice-agent",
  quotesPayments: "/#quotes-and-payments",
} as const;

/* --------------------------------------------------------- mega menus --- */

const PRODUCT_MENU: MegaColumn[] = [
  {
    heading: "Sell and close",
    links: [
      {
        label: "AI Voice Sales Agent",
        href: ANCHORS.voiceAgent,
        description: "Calls leads who asked, then qualifies, quotes or books.",
      },
      {
        label: "Quotes and payments",
        href: ANCHORS.quotesPayments,
        description: "Branded quotes, e-signature and Stripe invoices.",
      },
      {
        label: "The revenue journey",
        href: ANCHORS.revenueJourney,
        description: "From first enquiry to paid invoice.",
      },
    ],
  },
  {
    heading: "Convert leads",
    links: [
      {
        label: "Lead Conversion",
        href: "/product/lead-conversion",
        description: "Respond, follow up, qualify and route enquiries.",
      },
      {
        label: "Lead Management",
        href: ANCHORS.capabilities,
        description: "Every lead and its history in one inbox.",
      },
      {
        label: "Follow-Up",
        href: ANCHORS.capabilities,
        description: "Email, SMS and WhatsApp follow-up.",
      },
      {
        label: "Qualification",
        href: ANCHORS.capabilities,
        description: "Your questions and rules on every enquiry.",
      },
      {
        label: "Booking",
        href: ANCHORS.howItWorks,
        description: "Qualified leads to an appointment or person.",
      },
      {
        label: "Reactivation",
        href: ANCHORS.capabilities,
        description: "Re-engage older leads, with suppression built in.",
      },
    ],
  },
  {
    heading: "Find customers",
    links: [
      {
        label: "Find Leads",
        href: "/product/find-leads",
        description: "Verified prospects from a plain-English target.",
      },
      {
        label: "Prospecting",
        href: "/product/find-leads",
        description: "Verify contact data before you reach out.",
      },
      {
        label: "Acquisition campaigns",
        href: ANCHORS.proof,
        description: "Permitted outbound outreach in one place.",
      },
    ],
  },
  {
    heading: "Understand performance",
    links: [
      {
        label: "Analytics",
        href: ANCHORS.capabilities,
        description: "Acquisition, outreach and conversion in one view.",
      },
      {
        label: "Integrations",
        href: ANCHORS.integrations,
        description: "Connect the tools you already use.",
      },
    ],
  },
];

const SOLUTIONS_MENU: MegaColumn[] = [
  {
    heading: "Digital & technology",
    links: [
      { label: "Agencies", href: ANCHORS.industries },
      { label: "Web & design studios", href: ANCHORS.industries },
      { label: "SaaS & technology", href: ANCHORS.industries },
    ],
  },
  {
    heading: "Commerce & services",
    links: [
      { label: "Ecommerce", href: ANCHORS.industries },
      { label: "Accountants", href: ANCHORS.industries },
      { label: "Law firms", href: ANCHORS.industries },
    ],
  },
  {
    heading: "Teams",
    links: [
      { label: "Sales teams", href: ANCHORS.proof },
      { label: "Multi-location", href: "/enterprise" },
      { label: "Agencies & partners", href: "/affiliates" },
    ],
  },
];

const RESOURCES_MENU: MegaColumn[] = [
  {
    heading: "Get answers",
    links: [
      { label: "Help centre", href: "/help", description: "Step-by-step guides for ClientTurn." },
      { label: "FAQ", href: ANCHORS.faq, description: "Common questions before you start." },
      { label: "Results", href: "/results", description: "What ClientTurn measures, end to end." },
      {
        label: "SDR cost calculator",
        href: "/sdr-cost-calculator",
        description: "AI SDR vs hiring an SDR, on your numbers.",
      },
      { label: "Contact sales", href: "/contact-sales", description: "Talk to us about a larger rollout." },
      { label: "System status", href: "/status", description: "Live availability of the platform." },
    ],
  },
  {
    heading: "Trust",
    links: [
      { label: "Compliance", href: "/compliance", description: "How PECR and UK GDPR apply." },
      { label: "AI call compliance", href: "/compliance#voice-calls", description: "Consent, disclosure and calling hours." },
      { label: "Privacy notice", href: "/privacy", description: "What we process, and why." },
      { label: "Sub-processors", href: "/sub-processors", description: "Every third party in the chain." },
      { label: "Terms of service", href: "/terms", description: "The contract behind a subscription." },
    ],
  },
];

/* ------------------------------------------------------- primary nav --- */

export const PRIMARY_NAV: NavItem[] = [
  { kind: "mega", label: "Product", id: "product", columns: PRODUCT_MENU },
  { kind: "mega", label: "Solutions", id: "solutions", columns: SOLUTIONS_MENU },
  { kind: "link", label: "How It Works", href: "/how-it-works" },
  { kind: "link", label: "Results", href: "/results" },
  { kind: "mega", label: "Resources", id: "resources", columns: RESOURCES_MENU },
  { kind: "link", label: "Pricing", href: "/pricing" },
  { kind: "link", label: "Enterprise", href: "/enterprise" },
  { kind: "link", label: "Partners", href: "/affiliates" },
];

/* ------------------------------------------------------------- footer --- */

export const FOOTER_PRODUCT: NavLink[] = [
  { label: "AI Voice Sales Agent", href: ANCHORS.voiceAgent },
  { label: "Quotes and payments", href: ANCHORS.quotesPayments },
  { label: "Lead Conversion", href: "/product/lead-conversion" },
  { label: "Lead Management", href: ANCHORS.capabilities },
  { label: "Find Leads", href: "/product/find-leads" },
  { label: "Follow-Up", href: ANCHORS.capabilities },
  { label: "Qualification", href: ANCHORS.capabilities },
  { label: "Booking", href: ANCHORS.howItWorks },
  { label: "Reactivation", href: ANCHORS.capabilities },
  { label: "Analytics", href: ANCHORS.capabilities },
  { label: "Integrations", href: ANCHORS.integrations },
];

export const FOOTER_SOLUTIONS: NavLink[] = [
  { label: "Agencies", href: ANCHORS.industries },
  { label: "Web & design studios", href: ANCHORS.industries },
  { label: "SaaS & technology", href: ANCHORS.industries },
  { label: "Ecommerce", href: ANCHORS.industries },
  { label: "Accountants", href: ANCHORS.industries },
  { label: "Law firms", href: ANCHORS.industries },
  { label: "All industries", href: ANCHORS.industries },
];

export const FOOTER_RESOURCES: NavLink[] = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Results", href: "/results" },
  { label: "SDR cost calculator", href: "/sdr-cost-calculator" },
  { label: "For developers", href: "/developers" },
  { label: "Help centre", href: "/help" },
  { label: "FAQ", href: ANCHORS.faq },
  { label: "System status", href: "/status" },
];

export const FOOTER_COMPANY: NavLink[] = [
  { label: "Pricing", href: "/pricing" },
  { label: "Voice pricing", href: "/pricing#voice-pricing" },
  { label: "Enterprise", href: "/enterprise" },
  { label: "Contact sales", href: "/contact-sales" },
  { label: "Log in", href: "/login" },
  { label: "Start free", href: "/signup" },
];

export const FOOTER_PARTNERS: NavLink[] = [
  { label: "Affiliate programme", href: "/affiliates" },
  { label: "Apply to become an affiliate", href: "/affiliates/signup" },
  { label: "Affiliate login", href: "/affiliates/login" },
];

export const FOOTER_LEGAL: NavLink[] = [
  { label: "Compliance", href: "/compliance" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Cookie policy", href: "/cookies" },
  { label: "Sub-processors", href: "/sub-processors" },
  { label: "Privacy request", href: "/privacy-request" },
];
