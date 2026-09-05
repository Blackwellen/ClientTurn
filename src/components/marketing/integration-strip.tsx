"use client";

import Image from "next/image";
import { CalendarDays, CalendarClock, Megaphone, MessageCircle, MessageSquare, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Container } from "./section";
import { MarketingSection, SectionIntro } from "./sections/shell";

type Tool = { name: string; detail: string; icon: LucideIcon };

/**
 * Read left to right, this is the integration story: a lead arrives from somewhere, ClientTurn runs
 * the conversation, and a qualified lead lands in a calendar. Grouping the tools by the job they do
 * says more than scattering five logos around a hub.
 */
const SOURCES: Tool[] = [
  { name: "Meta Lead Ads", detail: "Facebook & Instagram lead forms", icon: Megaphone },
];
const CHANNELS: Tool[] = [
  { name: "SMS", detail: "Every plan", icon: MessageSquare },
  { name: "WhatsApp", detail: "Growth and above", icon: MessageCircle },
];
const DESTINATIONS: Tool[] = [
  { name: "Google Calendar", detail: "Booked straight into your diary", icon: CalendarDays },
  { name: "Calendly", detail: "Or your existing booking link", icon: CalendarClock },
];

function ToolRow({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  return (
    <li className="ct-tool">
      <span className="ct-tool-icon"><Icon className="size-[18px]" aria-hidden /></span>
      <span className="ct-tool-text">
        <strong>{tool.name}</strong>
        <small>{tool.detail}</small>
      </span>
    </li>
  );
}

function Stage({ label, tools, index }: { label: string; tools: Tool[]; index: number }) {
  return (
    <motion.div
      className="ct-stage ct-panel"
      initial={{ opacity: 0.55, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.55, delay: index * 0.1, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <p className="ct-stage-label">{label}</p>
      <ul>{tools.map(tool => <ToolRow key={tool.name} tool={tool} />)}</ul>
    </motion.div>
  );
}

/** The powered link between stages, using the same dark-conduit-with-lime-core language as the 3D rail. */
function Link({ index }: { index: number }) {
  return (
    <motion.div
      className="ct-link" aria-hidden
      initial={{ opacity: 0.4 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.5, delay: 0.3 + index * 0.12 }}
    >
      <span className="ct-link-core" style={{ animationDelay: `${index * 1.1}s` }} />
    </motion.div>
  );
}

export function IntegrationStrip() {
  return (
    <MarketingSection id="integrations" depth={0} glow="centre" labelledBy="integrations-heading">
      <SectionIntro
        id="integrations-heading"
        eyebrow="Integrations"
        title={<>Connect the tools<br />you already use.</>}
        lead="Your lead source, your messaging and your calendar stay where they are. ClientTurn sits between them."
      />
      <Container>
        <div className="ct-flow">
          <Stage label="Lead source" tools={SOURCES} index={0} />
          <Link index={0} />

          <motion.div
            className="ct-stage ct-stage-hub"
            initial={{ opacity: 0.55, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="ct-hub-brand">
              <Image src="/Favicon.png" alt="" width={128} height={128} />
              <div>
                <strong>ClientTurn</strong>
                <small>Replies, follow-up and qualification</small>
              </div>
            </div>
            <p className="ct-stage-label">Conversation</p>
            <ul>{CHANNELS.map(tool => <ToolRow key={tool.name} tool={tool} />)}</ul>
          </motion.div>

          <Link index={1} />
          <Stage label="Booking" tools={DESTINATIONS} index={2} />
        </div>
      </Container>
    </MarketingSection>
  );
}
