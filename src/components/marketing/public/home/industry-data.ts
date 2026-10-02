import {
  BriefcaseBusiness,
  Calculator,
  Cpu,
  LayoutTemplate,
  Megaphone,
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
 * Every sector is inside the ICP (CLAUDE.md, resolved conflict 5): UK
 * agencies, web and design studios, SaaS, ecommerce and professional
 * services. Home-service and property sectors were removed on 2026-09-30.
 *
 * Imagery lives in `public/industries/`: CC0 photographs (see CREDITS.json)
 * and, where no fitting photograph exists, original on-brand SVG
 * illustrations. Leave `image` unset and the card renders its tonal motif.
 */
export type Industry = {
  id: string;
  name: string;
  category: string;
  icon: LucideIcon;
  promise: string;
  /** A photograph (.webp) or illustration (.svg). Falls back to the tonal motif. */
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
    id: "web-studios",
    name: "Web & Design Studios",
    category: "Web & design",
    icon: LayoutTemplate,
    promise: "Qualify scope, budget and launch date before a proposal.",
    image: "/industries/web-studios.svg",
    imageAlt: "An illustration of a website wireframe in a browser window, with a colour palette and a cursor.",
    motif: ["#1f2a1a", "#080c06"],
    stages: ["Project enquiry", "Scope, budget, launch date", "Discovery call"],
    finalLabel: "Book",
  },
  {
    id: "saas-sales",
    name: "SaaS Companies",
    category: "SaaS",
    icon: Target,
    promise: "Reply to demo requests in seconds and hand over only what fits.",
    image: "/industries/saas-sales.webp",
    imageAlt: "Colleagues reviewing notes and laptops around a meeting table.",
    motif: ["#182338", "#070a14"],
    stages: ["Demo request", "Company, role, use case", "Handover to sales"],
    finalLabel: "Route",
  },
  {
    id: "technology",
    name: "Technology & IT",
    category: "IT services",
    icon: Cpu,
    promise: "Split support requests from new business.",
    image: "/industries/technology.webp",
    imageAlt: "An aisle of server racks in a data centre.",
    motif: ["#1b2438", "#080b14"],
    stages: ["Inbound request", "Company, system, urgency", "Technical call"],
    finalLabel: "Book",
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
    id: "consultancies",
    name: "Consultancies",
    category: "Professional services",
    icon: BriefcaseBusiness,
    promise: "Qualify the challenge, decision-maker and timing before a discovery call.",
    image: "/industries/consultancies.svg",
    imageAlt: "An illustration of a strategy board with a two-by-two matrix and a rising line chart.",
    motif: ["#1a2c26", "#070f0c"],
    stages: ["Consultancy enquiry", "Challenge, decision-maker, timing", "Discovery call"],
    finalLabel: "Book",
  },
];


/** The reassurance strip under the carousel. */
export const INDUSTRY_STRIP = [
  "Agencies",
  "Web and design studios",
  "SaaS",
  "Ecommerce",
  "Professional services",
];
