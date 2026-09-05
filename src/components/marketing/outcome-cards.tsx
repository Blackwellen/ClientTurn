import { CalendarCheck, Filter, Repeat, Zap } from "lucide-react";
import { Section, SectionHeading } from "./section";

const OUTCOMES = [
  {
    icon: Zap,
    title: "Respond faster",
    body: "The first message goes out as soon as the lead form is submitted, day or night, without anyone checking a notification.",
  },
  {
    icon: Repeat,
    title: "Follow up consistently",
    body: "Non-responders get your follow-up sequence on schedule, inside quiet hours, until they reply or a stop condition is met.",
  },
  {
    icon: Filter,
    title: "Qualify before calling",
    body: "Your questions are asked in order — service, postcode, timing, ownership — so you only phone people worth phoning.",
  },
  {
    icon: CalendarCheck,
    title: "Book more quotes",
    body: "Qualified leads get your booking link or go straight to a named person, with the whole conversation attached.",
  },
] as const;

export function OutcomeCards() {
  return (
    <Section id="outcomes">
      <SectionHeading
        eyebrow="What changes"
        title="Four things start working the day you connect Meta."
      />

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {OUTCOMES.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-xl border border-line bg-surface p-6 shadow-xs"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent-50 text-content-accent">
              <Icon className="size-5" aria-hidden />
            </span>
            <h3 className="mt-5 text-[15px] font-semibold text-content">
              {title}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-content-secondary">
              {body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
