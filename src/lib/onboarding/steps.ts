/**
 * Onboarding step definitions for the setup wizard. Pure data and pure
 * helpers only — imported by both the server route and the client wizard, so
 * nothing server-only here.
 *
 * Phase 8.29 made setup shorter. The business step comes first, because it is
 * where the owner names the workspace (nothing else may show a workspace
 * before it has a name, Copilot included), and it is the only step with a
 * required input. Everything after it is optional: each has recommended
 * defaults already filled in, and "Skip to go live" applies them and jumps to
 * the last step. What was skipped is listed on the dashboard afterwards.
 */

export const ONBOARDING_STEPS = [
  "business",
  "copilot",
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
      "Name your workspace and tell us what you sell. Add your website and we will fill in what we can. This is the only step you have to complete.",
  },
  copilot: {
    number: 2,
    title: "Meet Copilot",
    description:
      "Copilot is your in-app assistant. It answers questions from your own data and can act for you, always with your permissions and only after you confirm anything high-impact. Try a question, or carry on.",
  },
  connect_leads: {
    number: 3,
    title: "Connect Leads",
    description:
      "Connect your Meta account and choose which Facebook pages and lead forms to use. New leads then arrive in ClientTurn on their own. You can do this later.",
  },
  follow_up: {
    number: 4,
    title: "Follow-Up",
    description:
      "How ClientTurn chases every new lead. A recommended sequence is already filled in: change anything you like, or keep it.",
  },
  qualify_book: {
    number: 5,
    title: "Qualify & Book",
    description:
      "The questions that decide which leads are worth a meeting, and what happens to the ones that are. Recommended questions are already filled in from your services.",
  },
  test_go_live: {
    number: 6,
    title: "Test & Go Live",
    description:
      "Send a test lead through the whole system to check everything works, then go live. The test is optional.",
  },
};

export const STEP_NAV: { step: OnboardingStep; label: string }[] = [
  { step: "business", label: "Your Business" },
  { step: "copilot", label: "Meet Copilot" },
  { step: "connect_leads", label: "Connect Leads" },
  { step: "follow_up", label: "Follow-Up" },
  { step: "qualify_book", label: "Qualify & Book" },
  { step: "test_go_live", label: "Test & Go Live" },
];

/**
 * Prompts offered in the Copilot step. Each is a read-only question Copilot
 * answers from the workspace itself, so a first question can never change
 * anything — the point is to see an answer grounded in your own data.
 */
export const FIRST_COPILOT_PROMPTS = [
  "What should I set up first?",
  "What does ClientTurn know about my business?",
  "Which leads need attention?",
  "What can you do for me, and what will you always ask before doing?",
] as const;

/**
 * Steps with nothing to fill in: each already holds a working default, so
 * Continue is never blocked and "Skip to go live" is offered.
 */
export const OPTIONAL_STEPS: readonly OnboardingStep[] = ["copilot", "connect_leads", "follow_up", "qualify_book"];

export function isOptionalStep(step: OnboardingStep): boolean {
  return OPTIONAL_STEPS.includes(step);
}

/**
 * Whether "Skip to go live" is offered: on every step but the last. On the
 * business step it saves the business first, so the one required input is
 * never skipped.
 */
export function canSkipToGoLive(step: OnboardingStep): boolean {
  return step !== "test_go_live";
}

/**
 * The step to show. An unknown value starts at the beginning, and a workspace
 * that still has no name always shows the business step, whatever the stored
 * step says: the name is required, and every later step would otherwise show
 * (or let Copilot repeat) the placeholder.
 */
export function resolveOnboardingStep(stored: string | null | undefined, unnamed: boolean): OnboardingStep {
  if (unnamed) return "business";
  return stored && isOnboardingStep(stored) ? stored : ONBOARDING_STEPS[0];
}

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

/** How many of an industry's suggested services are pre-selected for a new workspace. */
export const PRESELECTED_SERVICES = 3;

/** The services a new workspace starts with: the first few suggestions for its industry. */
export function defaultServicesFor(industry: string): string[] {
  return suggestedServicesFor(industry).slice(0, PRESELECTED_SERVICES);
}

export type DefaultQuestion = {
  questionText: string;
  responseType: "single_choice" | "timing";
  required: boolean;
  options: string[];
  rule: { operator: "is_present"; comparisonValue: string[]; result: "review" } | null;
};

/**
 * The recommended B2B qualification set, built from the workspace's own
 * services so it is publishable as it stands: a choice question needs at
 * least two options (`saveQuestion` refuses fewer), so a single service gets
 * "Something else" beside it. Two questions, both answerable in one tap.
 * Only the service question carries a rule, the same `is_present` -> review
 * rule the wizard has always seeded; timing is asked for context, not to
 * disqualify anyone.
 */
export function defaultQualifyQuestions(serviceNames: readonly string[]): DefaultQuestion[] {
  const services = [...new Set(serviceNames.map((name) => name.trim()).filter((name) => name.length > 1))].slice(0, 11);
  const options = services.length >= 2 ? services : [...services, "Something else"];
  if (options.length < 2) options.push("Not sure yet");
  return [
    {
      questionText: "What do you need help with?",
      responseType: "single_choice",
      required: true,
      options,
      rule: { operator: "is_present", comparisonValue: [], result: "review" },
    },
    {
      questionText: "When are you looking to get started?",
      responseType: "timing",
      required: false,
      options: ["As soon as possible", "Within a month", "In 1 to 3 months", "Just researching"],
      rule: null,
    },
  ];
}

export const DEFAULT_QUESTIONS = [
  {
    question_text: "What do you need help with?",
    response_type: "single_choice" as const,
    required: true,
  },
  {
    question_text: "Roughly how many people are in your team?",
    response_type: "number" as const,
    required: false,
  },
  {
    question_text: "When are you looking to get started?",
    response_type: "timing" as const,
    required: true,
  },
  {
    question_text: "Are you the person who decides on this?",
    response_type: "yes_no" as const,
    required: false,
  },
];

/**
 * Popular starting services per industry, shown as one-tap suggestions in the
 * business step. Keyed by the labels in `INDUSTRY_OPTIONS`
 * (src/lib/settings/types.ts); a test checks every option has an entry.
 */
export const SUGGESTED_SERVICES: Record<string, string[]> = {
  "Marketing agency": [
    "Marketing Strategy",
    "Paid Social",
    "Content Marketing",
    "Email Marketing",
    "Monthly Retainer",
    "Marketing Audit",
  ],
  "Advertising / paid media agency": [
    "Google Ads Management",
    "Meta Ads Management",
    "LinkedIn Ads",
    "Paid Media Audit",
    "Creative Production",
  ],
  "SEO agency": [
    "SEO Audit",
    "Technical SEO",
    "Local SEO",
    "Content & Link Building",
    "Monthly SEO Retainer",
  ],
  "Web / design studio": [
    "Website Design",
    "Website Build",
    "Ecommerce Website",
    "Branding & Identity",
    "Website Care Plan",
    "UX Audit",
  ],
  "B2B SaaS": ["Product Demo", "Free Trial", "Annual Plan", "Onboarding Package", "Integration Setup"],
  "Product-led SaaS": ["Free Plan", "Team Plan", "Guided Onboarding", "Upgrade Consultation"],
  "Enterprise software": [
    "Discovery Call",
    "Proof of Concept",
    "Enterprise Licence",
    "Implementation Services",
    "Security Review",
  ],
  "Ecommerce brand": ["Wholesale Enquiries", "Bulk Orders", "Corporate Gifting", "Product Consultation"],
  "Subscription ecommerce": ["Monthly Subscription", "Annual Subscription", "Gift Subscription", "Business Subscription"],
  "Managed IT services (MSP)": [
    "Managed IT Support",
    "Microsoft 365 Setup",
    "Cloud Migration",
    "Backup & Recovery",
    "IT Audit",
  ],
  "IT consultancy": ["IT Strategy", "Systems Integration", "Project Delivery", "Technology Audit"],
  Cybersecurity: [
    "Penetration Testing",
    "Cyber Essentials",
    "Security Audit",
    "Managed Security",
    "Staff Awareness Training",
  ],
  "Management consultancy": ["Strategy Review", "Operational Improvement", "Change Programme", "Workshop"],
  "Accountancy practice": [
    "Annual Accounts",
    "Corporation Tax",
    "VAT Returns",
    "Payroll",
    "Management Accounts",
    "Advisory",
  ],
  Bookkeeping: ["Monthly Bookkeeping", "VAT Returns", "Payroll", "Software Setup"],
  "Law firm": ["Commercial Contracts", "Employment Law", "Company Formation", "Dispute Resolution"],
  "Recruitment agency": ["Permanent Recruitment", "Contract Recruitment", "Executive Search", "Retained Search"],
  Other: ["Discovery Call", "Consultation", "Proposal", "Ongoing Support"],
};

export function suggestedServicesFor(industry: string): string[] {
  return SUGGESTED_SERVICES[industry] ?? SUGGESTED_SERVICES.Other;
}
