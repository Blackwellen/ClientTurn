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
} as const;

/* --------------------------------------------------------- mega menus --- */

const PRODUCT_MENU: MegaColumn[] = [
  {
    heading: "Convert leads",
    links: [
      {
        label: "Lead Conversion",
        href: "/product/lead-conversion",
        description: "Respond, follow up, qualify and route every warm enquiry.",
      },
      {
        label: "Lead Management",
        href: ANCHORS.capabilities,
        description: "Every warm lead and its history in one operational inbox.",
      },
      {
        label: "Follow-Up",
        href: ANCHORS.capabilities,
        description: "Coordinated email, SMS and WhatsApp follow-up.",
      },
      {
        label: "Qualification",
        href: ANCHORS.capabilities,
        description: "Your questions and rules applied to every enquiry.",
      },
      {
        label: "Booking",
        href: ANCHORS.howItWorks,
        description: "Route a qualified lead to an appointment or a person.",
      },
      {
        label: "Reactivation",
        href: ANCHORS.capabilities,
        description: "Re-engage older eligible leads with suppression built in.",
      },
    ],
  },
  {
    heading: "Find customers",
    links: [
      {
        label: "Find Leads",
        href: "/product/find-leads",
        description: "A verified prospect pipeline from a plain-language target.",
      },
      {
        label: "Prospecting",
        href: "/product/find-leads",
        description: "Source and verify contact data before you reach out.",
      },
      {
        label: "Acquisition campaigns",
        href: ANCHORS.proof,
        description: "Coordinate permitted outbound outreach in one place.",
      },
    ],
  },
  {
    heading: "Understand performance",
    links: [
      {
        label: "Analytics",
        href: ANCHORS.capabilities,
        description: "Acquisition, outreach and conversion performance together.",
      },
      {
        label: "Integrations",
        href: ANCHORS.integrations,
        description: "Connect the tools already around your pipeline.",
      },
    ],
  },
];

const SOLUTIONS_MENU: MegaColumn[] = [
  {
    heading: "Home improvement",
    links: [
      { label: "Roofing", href: ANCHORS.industries },
      { label: "Kitchens", href: ANCHORS.industries },
      { label: "Windows & doors", href: ANCHORS.industries },
    ],
  },
  {
    heading: "Trade & property",
    links: [
      { label: "Landscaping", href: ANCHORS.industries },
      { label: "Plumbing", href: ANCHORS.industries },
      { label: "Builders", href: ANCHORS.industries },
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
      { label: "FAQ", href: ANCHORS.faq, description: "The questions people ask before starting." },
      { label: "Results", href: "/results", description: "What ClientTurn measures, end to end." },
      { label: "Contact sales", href: "/contact-sales", description: "Talk to us about a larger rollout." },
      { label: "System status", href: "/status", description: "Live availability of the platform." },
    ],
  },
  {
    heading: "Trust",
    links: [
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
  { label: "Roofing", href: ANCHORS.industries },
  { label: "Kitchens", href: ANCHORS.industries },
  { label: "Windows & doors", href: ANCHORS.industries },
  { label: "Landscaping", href: ANCHORS.industries },
  { label: "Plumbing", href: ANCHORS.industries },
  { label: "Builders", href: ANCHORS.industries },
  { label: "All industries", href: ANCHORS.industries },
];

export const FOOTER_RESOURCES: NavLink[] = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Results", href: "/results" },
  { label: "For developers", href: "/developers" },
  { label: "FAQ", href: ANCHORS.faq },
  { label: "System status", href: "/status" },
];

export const FOOTER_COMPANY: NavLink[] = [
  { label: "Pricing", href: "/pricing" },
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
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Cookie policy", href: "/cookies" },
  { label: "Sub-processors", href: "/sub-processors" },
];
