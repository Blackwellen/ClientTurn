/**
 * Onboarding step definitions for the five-step wizard. Pure data and pure
 * helpers only — imported by both the server route and the client wizard, so
 * nothing server-only here.
 */

export const ONBOARDING_STEPS = [
  "business",
  "connect_leads",
  "follow_up",
  "qualify_book",
  "test_go_live",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const STEP_META: Record<
  OnboardingStep,
  { number: number; title: string; description: string }
> = {
  business: {
    number: 1,
    title: "Your Business",
    description:
      "Tell us about your business and the services you offer. This helps ClientTurn tailor your follow-ups, qualify leads correctly, and book the right jobs.",
  },
  connect_leads: {
    number: 2,
    title: "Connect Leads",
    description:
      "Connect your Meta account and choose which Facebook pages and lead forms to use. We'll automatically pull new leads and get them into ClientTurn.",
  },
  follow_up: {
    number: 3,
    title: "Follow-Up",
    description:
      "Set up how ClientTurn will follow up with your leads. We'll send automated messages, so you can respond quicker, book more jobs, and never miss a lead.",
  },
  qualify_book: {
    number: 4,
    title: "Qualify & Book",
    description:
      "Ask the right questions, qualify your leads, and send them to the right place. Set up your qualification questions and choose how qualified leads should be booked or handled.",
  },
  test_go_live: {
    number: 5,
    title: "Test & Go Live",
    description:
      "Send a test lead through your full ClientTurn system to make sure everything is working as expected. Once successful, you can go live and start receiving real leads.",
  },
};

export const STEP_NAV: { step: OnboardingStep; label: string }[] = [
  { step: "business", label: "Your Business" },
  { step: "connect_leads", label: "Connect Leads" },
  { step: "follow_up", label: "Follow-Up" },
  { step: "qualify_book", label: "Qualify & Book" },
  { step: "test_go_live", label: "Test & Go Live" },
];

export function stepIndex(step: string): number {
  const index = ONBOARDING_STEPS.indexOf(step as OnboardingStep);
  return index === -1 ? 0 : index;
}

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const index = stepIndex(step);
  return index < ONBOARDING_STEPS.length - 1
    ? ONBOARDING_STEPS[index + 1]
    : null;
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const index = stepIndex(step);
  return index > 0 ? ONBOARDING_STEPS[index - 1] : null;
}

export const DEFAULT_QUESTIONS = [
  {
    question_text: "What service do you need?",
    response_type: "single_choice" as const,
    required: true,
  },
  {
    question_text: "What's your property postcode?",
    response_type: "postcode" as const,
    required: true,
  },
  {
    question_text: "When would you like the work done?",
    response_type: "timing" as const,
    required: true,
  },
  {
    question_text: "Do you own the property?",
    response_type: "yes_no" as const,
    required: true,
  },
];

/** Popular starting services per industry, shown as one-tap suggestions in Step 1. */
export const SUGGESTED_SERVICES: Record<string, string[]> = {
  Roofing: [
    "Roof Installation",
    "Roof Repairs",
    "Flat Roofing",
    "Guttering & Fascias",
    "Roof Inspections",
    "Chimney Repairs",
    "Emergency Callouts",
    "Roof Cleaning",
    "Moss Removal",
    "Solar Panel Installation",
  ],
  "Windows & doors": [
    "Window Installation",
    "Door Installation",
    "Double Glazing",
    "Conservatories",
    "Composite Doors",
    "Window Repairs",
    "Velux Window Installation",
  ],
  "Kitchens & bathrooms": [
    "Kitchen Installation",
    "Bathroom Installation",
    "Kitchen Design",
    "Bathroom Renovation",
    "Tiling",
    "Wet Rooms",
  ],
  "Driveways & landscaping": [
    "Driveway Installation",
    "Patios",
    "Landscaping",
    "Fencing",
    "Artificial Grass",
    "Resin Driveways",
  ],
  "Heating & plumbing": [
    "Boiler Installation",
    "Boiler Repairs",
    "Central Heating",
    "Emergency Plumbing",
    "Bathroom Plumbing",
    "Power Flushing",
  ],
  Electrical: [
    "Rewiring",
    "Consumer Unit Upgrades",
    "Electrical Inspections",
    "Emergency Callouts",
    "Lighting Installation",
    "EV Charger Installation",
  ],
  "Solar & renewables": [
    "Solar Panel Installation",
    "Battery Storage",
    "Heat Pump Installation",
    "EV Charger Installation",
    "Solar Maintenance",
  ],
  "Damp & insulation": [
    "Damp Proofing",
    "Cavity Wall Insulation",
    "Loft Insulation",
    "Timber Treatment",
    "Condensation Control",
  ],
  Cleaning: [
    "End of Tenancy Cleaning",
    "Carpet Cleaning",
    "Window Cleaning",
    "Gutter Cleaning",
    "Pressure Washing",
  ],
  "Other home services": [
    "Emergency Callouts",
    "Free Site Survey",
    "Maintenance Contracts",
    "Lead Work",
  ],
};

export function suggestedServicesFor(industry: string): string[] {
  return SUGGESTED_SERVICES[industry] ?? SUGGESTED_SERVICES["Other home services"];
}
