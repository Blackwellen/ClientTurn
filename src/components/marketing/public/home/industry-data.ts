import {
  Building2,
  Calculator,
  Cpu,
  HardHat,
  Home,
  Leaf,
  Megaphone,
  Network,
  Scale,
  ShoppingBag,
  Sun,
  Target,
  Wrench,
  Zap,
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
    id: "roofing",
    name: "Roofing",
    category: "Home services",
    icon: Home,
    promise: "Turn roof enquiries into booked surveys.",
    image: "/industries/roofing.webp",
    imageAlt: "Close-up of interlocking clay roof tiles on a pitched roof.",
    motif: ["#16303c", "#071019"],
    stages: ["New roof quote", "Property, scope, timing", "Site survey"],
    finalLabel: "Book",
  },
  {
    id: "kitchens",
    name: "Kitchens",
    category: "Home improvements",
    icon: Building2,
    promise: "Convert kitchen enquiries into design appointments.",
    image: "/industries/kitchens.webp",
    imageAlt: "A fitted modern kitchen with pale units and an island worktop.",
    motif: ["#2a2438", "#0a0d16"],
    stages: ["New kitchen quote", "Budget, style, timeline", "Design appointment"],
    finalLabel: "Book",
  },
  {
    id: "windows-doors",
    name: "Windows & Doors",
    category: "Home improvements",
    icon: Building2,
    promise: "Turn enquiries into measured quotes.",
    image: "/industries/windows-doors.webp",
    imageAlt: "A contemporary building facade of large glazed panels.",
    motif: ["#12303a", "#060f18"],
    stages: ["Window or door quote", "Property type, quantity", "Measure-up"],
    finalLabel: "Book",
  },
  {
    id: "landscaping",
    name: "Landscaping",
    category: "Outdoor services",
    icon: Leaf,
    promise: "Convert garden enquiries into site visits.",
    image: "/industries/landscaping.webp",
    imageAlt: "Two patio chairs on a paved terrace in a planted garden.",
    motif: ["#16321f", "#060f0b"],
    stages: ["Garden project", "Location, scope, budget", "Site visit"],
    finalLabel: "Book",
  },
  {
    id: "plumbing",
    name: "Plumbing",
    category: "Trade services",
    icon: Wrench,
    promise: "Get the right jobs to the right engineer.",
    image: "/industries/plumbing.webp",
    imageAlt: "A chrome mixer tap over a stainless steel kitchen sink.",
    motif: ["#152a3a", "#060d15"],
    stages: ["Plumbing issue", "Urgency, location, job type", "Engineer visit"],
    finalLabel: "Book",
  },
  {
    id: "builders",
    name: "Builders",
    category: "Construction",
    icon: HardHat,
    promise: "Turn build enquiries into qualified projects.",
    image: "/industries/builders.webp",
    imageAlt: "A timber-framed house under construction with a builder on site.",
    motif: ["#33291a", "#100c06"],
    stages: ["Build or extension", "Scope, budget, timeline", "Qualified project"],
    finalLabel: "Handover",
  },
  {
    id: "electricians",
    name: "Electricians",
    category: "Trade services",
    icon: Zap,
    promise: "Route urgent work ahead of quotable work.",
    image: "/industries/electricians.webp",
    imageAlt: "A consumer unit with rows of breakers and coloured wiring.",
    motif: ["#2e2a12", "#0d0c06"],
    stages: ["Electrical enquiry", "Urgency, property, job type", "Engineer visit"],
    finalLabel: "Book",
  },
  {
    id: "solar",
    name: "Solar & Renewables",
    category: "Home improvements",
    icon: Sun,
    promise: "Qualify roof, ownership and timing before a survey.",
    image: "/industries/solar.webp",
    imageAlt: "Solar panels fitted across the roof of a modern detached house.",
    motif: ["#33301a", "#0f0e06"],
    stages: ["Install enquiry", "Property, ownership, timing", "Technical survey"],
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
