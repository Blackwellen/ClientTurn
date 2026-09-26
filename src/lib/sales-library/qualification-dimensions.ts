/**
 * The qualification-dimension catalogue (design doc 04 §3).
 *
 * Every archetype and motion refers to dimensions by key; the attributes and a
 * default question live here once. An archetype may reword a question (the
 * deep ICP archetypes do) or retune an attribute, but it cannot invent a
 * dimension the engine does not know about.
 *
 * How to read the attributes (all 0..1, static library judgements):
 *   informationGain   how much the answer narrows what happens next
 *   decisionRelevance how directly it bears on the close action
 *   commercialValue   how much it tells us about deal value / priority
 *   friction          how much effort or discomfort it costs the buyer
 *   prematurity       how wrong it feels to ask early. High for budget before
 *                     the problem is stated, and authority before engagement.
 */

import type {
  QualificationDimension,
  QualificationDimensionKey,
  QualificationSpec,
} from "./types.ts";

type Attrs = Omit<QualificationDimension, "key">;

export const QUALIFICATION_CATALOGUE: Record<QualificationDimensionKey, Attrs> = {
  PROBLEM: {
    label: "The problem or goal",
    informationGain: 0.9,
    decisionRelevance: 0.9,
    commercialValue: 0.8,
    friction: 0.2,
    prematurity: 0,
    question: "What's prompted you to look at this now?",
  },
  USE_CASE: {
    label: "Main use case",
    informationGain: 0.85,
    decisionRelevance: 0.9,
    commercialValue: 0.7,
    friction: 0.15,
    prematurity: 0,
    question: "What would you mainly want it to do for you?",
  },
  SERVICE_NEEDED: {
    label: "Service needed",
    informationGain: 0.9,
    decisionRelevance: 0.9,
    commercialValue: 0.7,
    friction: 0.1,
    prematurity: 0,
    question: "Which of our services are you looking for?",
  },
  PROJECT_SCOPE: {
    label: "Project scope",
    informationGain: 0.8,
    decisionRelevance: 0.85,
    commercialValue: 0.85,
    friction: 0.3,
    prematurity: 0.15,
    question: "Roughly what does the project involve?",
  },
  LOCATION: {
    label: "Location",
    informationGain: 0.7,
    decisionRelevance: 0.9,
    commercialValue: 0.4,
    friction: 0.1,
    prematurity: 0,
    question: "What's the postcode where the work would be?",
  },
  PROPERTY_TYPE: {
    label: "Property type",
    informationGain: 0.6,
    decisionRelevance: 0.7,
    commercialValue: 0.5,
    friction: 0.15,
    prematurity: 0.1,
    question: "What type of property is it?",
  },
  TIMING: {
    label: "Timing",
    informationGain: 0.75,
    decisionRelevance: 0.8,
    commercialValue: 0.7,
    friction: 0.15,
    prematurity: 0.15,
    question: "When are you hoping to have this in place?",
  },
  TEAM_SIZE: {
    label: "Team size",
    informationGain: 0.6,
    decisionRelevance: 0.7,
    commercialValue: 0.75,
    friction: 0.15,
    prematurity: 0.2,
    question: "How many people would be using it?",
  },
  COMPANY_SIZE: {
    label: "Company size",
    informationGain: 0.55,
    decisionRelevance: 0.65,
    commercialValue: 0.75,
    friction: 0.15,
    prematurity: 0.2,
    question: "Roughly how many people work at the company?",
  },
  CURRENT_SOLUTION: {
    label: "Current solution",
    informationGain: 0.7,
    decisionRelevance: 0.7,
    commercialValue: 0.6,
    friction: 0.25,
    prematurity: 0.3,
    question: "How are you handling this at the moment?",
  },
  AUTHORITY: {
    label: "Decision authority",
    informationGain: 0.6,
    decisionRelevance: 0.8,
    commercialValue: 0.6,
    friction: 0.45,
    prematurity: 0.6,
    question: "Is anyone else involved in deciding on this?",
  },
  BUDGET: {
    label: "Budget",
    informationGain: 0.6,
    decisionRelevance: 0.8,
    commercialValue: 0.9,
    friction: 0.6,
    prematurity: 0.8,
    question: "Do you have a budget range in mind for this?",
  },
  VOLUME: {
    label: "Volume",
    informationGain: 0.6,
    decisionRelevance: 0.7,
    commercialValue: 0.85,
    friction: 0.25,
    prematurity: 0.3,
    question: "Roughly what volumes are we talking about each month?",
  },
  PRODUCT_INTEREST: {
    label: "Product interest",
    informationGain: 0.85,
    decisionRelevance: 0.85,
    commercialValue: 0.6,
    friction: 0.1,
    prematurity: 0,
    question: "Which product were you looking at?",
  },
  SUITABILITY: {
    label: "Suitability",
    informationGain: 0.8,
    decisionRelevance: 0.9,
    commercialValue: 0.7,
    friction: 0.3,
    prematurity: 0.1,
    question: "Can you tell me a little about what you're hoping to achieve?",
  },
  STAKEHOLDERS: {
    label: "Stakeholders",
    informationGain: 0.6,
    decisionRelevance: 0.8,
    commercialValue: 0.7,
    friction: 0.45,
    prematurity: 0.55,
    question: "Who else would need to be involved in evaluating this?",
  },
  SUCCESS_METRICS: {
    label: "Success metrics",
    informationGain: 0.65,
    decisionRelevance: 0.7,
    commercialValue: 0.8,
    friction: 0.35,
    prematurity: 0.4,
    question: "How would you measure whether this has worked?",
  },
  DECISION_PROCESS: {
    label: "Decision process",
    informationGain: 0.55,
    decisionRelevance: 0.8,
    commercialValue: 0.7,
    friction: 0.45,
    prematurity: 0.65,
    question: "What does the decision process usually look like on your side?",
  },
  COMPLIANCE_REQUIREMENTS: {
    label: "Compliance requirements",
    informationGain: 0.5,
    decisionRelevance: 0.7,
    commercialValue: 0.5,
    friction: 0.35,
    prematurity: 0.4,
    question: "Are there any compliance or security requirements we'd need to meet?",
  },
  HIRING_NEED: {
    label: "Hiring need",
    informationGain: 0.85,
    decisionRelevance: 0.9,
    commercialValue: 0.8,
    friction: 0.15,
    prematurity: 0,
    question: "Which roles are you looking to fill?",
  },
};

/** Expands an archetype's shorthand into full dimension objects. */
export function resolveQualification(specs: QualificationSpec[]): QualificationDimension[] {
  return specs.map((spec) => {
    if (typeof spec === "string") return { key: spec, ...QUALIFICATION_CATALOGUE[spec] };
    return { ...QUALIFICATION_CATALOGUE[spec.key], ...spec };
  });
}
