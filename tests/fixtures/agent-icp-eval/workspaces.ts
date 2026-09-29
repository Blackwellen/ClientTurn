/**
 * The ICP evaluation's workspaces (text agent QA, 2026-09-29): one per ICP
 * segment (CLAUDE.md resolved conflict 5) plus the roofing test workspace the
 * owner calls. Everything the pipeline reads comes from here: the archetype
 * and motion the engine resolves, the services and published prices the
 * offer card and the validator use, the approved claims, the booking route,
 * the checkout authority. Written as a workspace owner would fill Settings;
 * no figure here is a claim ClientTurn makes.
 */

import type { SalesMotion } from "../../../src/lib/sales-library/types.ts";
import type { CheckoutLink } from "../../../src/lib/commercial/authority.ts";
import type { NbaBookingRoute } from "../../../src/lib/agent/strategy.ts";

export type IcpWorkspace = {
  key: WorkspaceKey;
  name: string;
  archetype: string;
  motion: SalesMotion;
  services: { name: string; description: string; publicPriceText: string | null }[];
  /** Approved claims (Settings, proof points): the only facts a reply may state about the business. */
  proof: string[];
  /** What the owner said never to claim. */
  prohibited: string[];
  booking: NbaBookingRoute;
  bookingUrl: string | null;
  /** Calendar slots a tool returns on a turn that offers times (SLOTS only). */
  slots: string[];
  commercial: { enabled: boolean; maxDiscountPercent: number; checkoutLinks: CheckoutLink[] } | null;
  conversionGoalType?: "BOOK_APPOINTMENT" | "BOOK_DEMO" | "REQUEST_QUOTE" | "DIRECT_SIGNUP" | "DIRECT_PURCHASE" | "BOOK_SITE_VISIT" | null;
};

export type WorkspaceKey = "AGENCY" | "STUDIO" | "SAAS" | "ECOM" | "PRO" | "ROOFER";

export const WORKSPACES: Record<WorkspaceKey, IcpWorkspace> = {
  AGENCY: {
    key: "AGENCY",
    name: "Brightside Digital",
    archetype: "MARKETING_AGENCY",
    motion: "BOOK_MEETING_B2B",
    services: [
      { name: "Paid social management", description: "LinkedIn and Meta ads for B2B firms, creative included.", publicPriceText: "from £1,500 a month" },
      { name: "SEO retainer", description: "Technical SEO and content for B2B sites.", publicPriceText: null },
    ],
    proof: ["We run paid social for 30 UK B2B brands", "Monthly reporting on pipeline, not just clicks"],
    prohibited: ["guaranteed results"],
    booking: "LINK",
    bookingUrl: "https://cal.brightside.example/intro",
    slots: [],
    commercial: null,
    conversionGoalType: "BOOK_APPOINTMENT",
  },
  STUDIO: {
    key: "STUDIO",
    name: "Northlight Studio",
    archetype: "CREATIVE_WEB_STUDIO",
    motion: "BOOK_MEETING_B2B",
    services: [
      { name: "Website rebuild", description: "Webflow and Next.js sites for B2B firms.", publicPriceText: null },
      { name: "Webflow care plan", description: "Hosting, updates and small changes each month.", publicPriceText: "£250 a month" },
    ],
    proof: ["Every site ships with a performance budget", "The same designer from kickoff to launch"],
    prohibited: ["fastest in the UK"],
    booking: "SLOTS",
    bookingUrl: null,
    slots: ["Wed 30 Sep, 10:00am", "Thu 1 Oct, 2:00pm"],
    commercial: null,
    conversionGoalType: "BOOK_APPOINTMENT",
  },
  SAAS: {
    key: "SAAS",
    name: "Ledgerly",
    archetype: "PLG_SAAS",
    motion: "SAAS_SELF_SERVE",
    services: [{ name: "Ledgerly Team plan", description: "Shared expense tracking for finance teams.", publicPriceText: "£12 per user per month" }],
    proof: ["14-day free trial, no card needed", "Set up in an afternoon"],
    prohibited: [],
    booking: "LINK",
    bookingUrl: "https://cal.ledgerly.example/demo",
    slots: [],
    commercial: {
      enabled: true,
      maxDiscountPercent: 0,
      checkoutLinks: [
        { id: "team", label: "Team plan", product: "Ledgerly Team plan", url: "https://buy.ledgerly.example/team", price_text: "£12 per user per month", currency: "GBP" },
      ],
    },
    conversionGoalType: "DIRECT_SIGNUP",
  },
  ECOM: {
    key: "ECOM",
    name: "Kiln & Co",
    archetype: "ECOMMERCE",
    motion: "ECOMMERCE_DIRECT",
    services: [{ name: "Stoneware dinner set", description: "Handmade 12 piece stoneware set for four.", publicPriceText: "£180" }],
    proof: ["Free UK delivery on orders over £100", "Handmade in Stoke-on-Trent"],
    prohibited: [],
    booking: "TEAM_FOLLOW_UP",
    bookingUrl: null,
    slots: [],
    commercial: {
      enabled: true,
      maxDiscountPercent: 10,
      checkoutLinks: [{ id: "dinner-set", label: "Dinner set", product: "Stoneware dinner set", url: "https://shop.kiln.example/dinner-set", price_text: "£180", currency: "GBP" }],
    },
    conversionGoalType: "DIRECT_PURCHASE",
  },
  PRO: {
    key: "PRO",
    name: "Harbour Accountants",
    archetype: "ACCOUNTING",
    motion: "BOOK_MEETING_B2B",
    services: [
      { name: "Year-end accounts", description: "Statutory accounts and corporation tax for limited companies.", publicPriceText: "from £650 plus VAT" },
      { name: "Payroll", description: "Monthly payroll and RTI for small teams.", publicPriceText: null },
    ],
    proof: ["ICAEW chartered accountants", "A named accountant, not a call centre"],
    prohibited: ["we guarantee no HMRC penalties"],
    booking: "LINK",
    bookingUrl: "https://cal.harbour.example/meet",
    slots: [],
    commercial: null,
    conversionGoalType: "BOOK_APPOINTMENT",
  },
  ROOFER: {
    key: "ROOFER",
    name: "Blackwellen Roofing",
    archetype: "ROOFER",
    motion: "LOCAL_SERVICE",
    services: [
      { name: "Roof replacement", description: "Full strip and re-roof: slate, concrete or clay tile.", publicPriceText: null },
      { name: "Flat roof / GRP", description: "GRP and EPDM rubber flat roofs replacing blistered felt.", publicPriceText: null },
    ],
    proof: ["10-year workmanship guarantee on full roof replacements", "Fully insured (public liability)", "A free survey and a written, itemised quote"],
    prohibited: ["cheapest", "best in London"],
    booking: "ASK_PREFERRED_TIME",
    bookingUrl: null,
    slots: [],
    commercial: null,
    conversionGoalType: "BOOK_SITE_VISIT",
  },
};
