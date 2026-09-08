import {
  Building2,
  Calculator,
  Cpu,
  Megaphone,
  Network,
  Scale,
  ShoppingBag,
  Target,
  type LucideIcon,
} from "lucide-react";

/**
 * The sectors shown in the industries carousel.
 *
 * The section's argument is that the engine is one engine, so every entry
 * here is the same three-stage shape — the enquiry that arrives, what gets
 * qualified, and the action it ends in. Nothing claims a sector-specific
 * feature that does not exist; the difference between rows is the wording of
 * the questions a business configures, which is exactly what the product
 * lets them change.
 *
 * Imagery: the repository ships no sector photography, and a marketing page
 * should not invent it. Each entry carries an optional `image` — set it to a
 * real asset path and the card renders the photograph instead of its tonal
 * motif, with no other change. Until then the motif keeps every card on the
 * dark palette rather than filling it with generic stock.
 */
export type Industry = {
  id: string;
  name: string;
  category: string;
  icon: LucideIcon;
  promise: string;
  /** Real photography, when it exists. Falls back to the tonal motif. */
  image?: string;
  imageAlt?: string;
  /** The motif's two stops. Distinct per sector, all within the dark palette. */
  motif: [string, string];
  /** Enquiry, what is qualified, and the action it ends in. */
  stages: [string, string, string];
  /** The label the third stage carries — usually "Book", sometimes not. */
  finalLabel: string;
};

export const INDUSTRIES: Industry[] = [
  {
    id: "agencies",
    name: "Marketing Agencies",
    category: "Agencies & partners",
    icon: Megaphone,
    promise: "Qualify budget and scope before a pitch call.",
    image: "/industries/agencies.webp",
    imageAlt: "A laptop displaying an analytics dashboard with charts.",
    motif: ["#2c1f33", "#0c070f"],
    stages: ["Inbound brief", "Budget, channels, timeline", "Scoping call"],
    finalLabel: "Book",
  },
  {
    id: "technology",
    name: "Technology & IT",
    category: "Professional services",
    icon: Cpu,
    promise: "Split support requests from new business.",
    image: "/industries/technology.webp",
    imageAlt: "An aisle of server racks in a data centre.",
    motif: ["#1b2438", "#080b14"],
    stages: ["Inbound request", "Company, system, urgency", "Technical call"],
    finalLabel: "Book",
  },
  {
    id: "saas-sales",
    name: "Sales Teams",
    category: "B2B sales",
    icon: Target,
    promise: "Reply in seconds and hand over only what fits.",
    image: "/industries/saas-sales.webp",
    imageAlt: "Colleagues reviewing notes and laptops around a meeting table.",
    motif: ["#182338", "#070a14"],
    stages: ["Demo request", "Company, role, need", "Handover to sales"],
    finalLabel: "Route",
  },
  {
    id: "ecommerce",
    name: "Ecommerce & Retail",
    category: "Ecommerce",
    icon: ShoppingBag,
    promise: "Turn wholesale and trade enquiries into accounts.",
    image: "/industries/ecommerce.webp",
    imageAlt: "A rail of wooden coat hangers in a retail clothing shop.",
    motif: ["#132f30", "#050f10"],
    stages: ["Trade enquiry", "Volume, region, account type", "Account review"],
    finalLabel: "Route",
  },
  {
    id: "accountants",
    name: "Accountants",
    category: "Professional services",
    icon: Calculator,
    promise: "Qualify entity, turnover and services before a call.",
    image: "/industries/accountants.webp",
    imageAlt: "Hands using a calculator beside a laptop showing a ledger.",
    motif: ["#182b33", "#070e12"],
    stages: ["New client enquiry", "Entity, turnover, services", "Discovery call"],
    finalLabel: "Book",
  },
  {
    id: "law-firms",
    name: "Law Firms",
    category: "Professional services",
    icon: Scale,
    promise: "Triage matter type and route to the right team.",
    image: "/industries/law-firms.webp",
    imageAlt: "Rows of bound legal volumes on a wooden bookcase.",
    motif: ["#211f36", "#08070f"],
    stages: ["Case enquiry", "Matter type, jurisdiction", "Consultation"],
    finalLabel: "Book",
  },
  {
    id: "property-services",
    name: "Property Services",
    category: "Property",
    icon: Building2,
    promise: "Separate valuations from viewings automatically.",
    image: "/industries/property-services.webp",
    imageAlt: "A white modern apartment block seen from below.",
    motif: ["#14263a", "#060b14"],
    stages: ["Property enquiry", "Address, intent, timing", "Valuation or viewing"],
    finalLabel: "Book",
  },
  {
    id: "multi-location",
    name: "Multi-location Groups",
    category: "Multi-site",
    icon: Network,
    promise: "Send every enquiry to the right branch, first time.",
    image: "/industries/multi-location.webp",
    imageAlt: "A dense city skyline of high-rise office buildings.",
    motif: ["#1a2c26", "#070f0c"],
    stages: ["Enquiry received", "Location, service, urgency", "Branch handover"],
    finalLabel: "Route",
  },
];


/** The reassurance strip under the carousel. */
export const INDUSTRY_STRIP = [
  "Service businesses",
  "Home improvements",
  "Trade services",
  "Property services",
  "Professional services",
  "Agencies & partners",
];
