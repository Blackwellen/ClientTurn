import { Section, SectionHeading } from "./section";
import { CtaLink } from "./cta";

const STEPS = [
  {
    title: "Connect Meta",
    body: "Sign in with the Facebook account that owns your ads and pick the pages and lead forms you want covered. Nothing else about your ads changes.",
  },
  {
    title: "A new lead arrives",
    body: "Someone fills in your Facebook or Instagram lead form. ClientTurn picks it up straight away and creates a lead record with their answers.",
  },
  {
    title: "ClientTurn sends the configured message",
    body: "Your first message goes out from your sending number, in your wording, with the opt-out line you chose.",
  },
  {
    title: "Follow-up continues until reply or stop",
    body: "If they do not answer, the follow-up sequence keeps going on your schedule and inside your quiet hours — and stops the moment they reply, opt out, or hit your limit.",
  },
  {
    title: "Qualification questions are asked in order",
    body: "The questions you set are asked one at a time. Answers are matched against the rules you configured. Anything unclear is flagged for a person instead of guessed.",
  },
  {
    title: "Qualified leads get a booking link or a person",
    body: "A qualified lead receives your booking link, or is handed to a named member of your team with the full conversation and every answer attached.",
  },
] as const;

export function HowItWorks() {
  return (
    <Section id="how-it-works" tone="sunken">
      <SectionHeading
        eyebrow="How it works"
        title="Six steps, set up once."
        description="No integrations to build and no jargon to learn. You configure the messages and the questions; ClientTurn runs them the same way every time."
      />

      <ol className="mt-12 grid gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-xl border border-line bg-surface p-6 shadow-xs"
          >
            <span className="lr-tabular flex size-8 items-center justify-center rounded-lg bg-accent-600 text-[13px] font-semibold text-white">
              {index + 1}
            </span>
            <h3 className="mt-4 text-[15px] font-semibold text-content">
              {step.title}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-content-secondary">
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-10">
        <CtaLink placement="how_it_works" size="lg">
          Start Free
        </CtaLink>
      </div>
    </Section>
  );
}
