import Link from "next/link";
import { CampaignPanel } from "./campaigns/campaign-panel";
import { IntentPanel } from "./intent/intent-panel";
import { PromotionPanel } from "./promotion/promotion-panel";
import {
  ArrowRight,
  ChapterCard,
  ChapterHead,
  Chart,
  Chat,
  FlSection,
  Ribbon,
  Search,
  Send,
  Users,
} from "./pieces";
import { Reveal, StaggerItem, StaggerReveal, panelEnter } from "./motion";

/**
 * Chapter C — intent, campaigns and the handover into the warm lead engine.
 *
 * The closing ribbon is a flow rather than four parallel virtues, because the
 * argument of this chapter is sequential: find, reach out, get a reply, promote,
 * convert.
 */
export function ChapterC() {
  return (
    <FlSection
      id="campaigns"
      glow="left"
      aria-label="Intent, campaigns and growth"
    >
      <ChapterHead
        heading={false}
        eyebrow="Intent, campaigns & growth"
        title="Find the right opportunities."
        accent="Take the next step."
        aside="Prioritise in-market prospects, run bounded outreach and promote the ones who engage."
        action={
          <Link href="#promotion" className="fl-btn fl-btn-ghost">
            See it in action
            <ArrowRight size={14} />
          </Link>
        }
      />

      <StaggerReveal className="fl-cards" step={0.12}>
        <StaggerItem as="div" variants={panelEnter}>
        <ChapterCard
          id="fl-intent-title"
          index="01"
          eyebrow="Buying intent"
          title="Prioritise companies showing a reason to care now."
          body="Permitted signals flag prospects with a more immediate need."
        >
          <IntentPanel />
        </ChapterCard>
        </StaggerItem>

        <StaggerItem as="div" variants={panelEnter}>
        <ChapterCard
          id="fl-campaigns-title"
          index="02"
          eyebrow="Campaigns"
          title="Coordinate acquisition without an automation maze."
          body="Goal, audience, minimum fit, intent, sequence, review mode and limits in one workflow."
        >
          <CampaignPanel />
        </ChapterCard>
        </StaggerItem>

        <StaggerItem as="div" variants={panelEnter}>
        <ChapterCard
          id="fl-promotion-title"
          index="03"
          eyebrow="Prospect → Lead"
          title="When a prospect engages, the history moves with them."
          body="On promotion, the conversation and campaign context move with them."
        >
          <div id="promotion">
            <PromotionPanel />
          </div>
        </ChapterCard>
        </StaggerItem>
      </StaggerReveal>

      <Reveal>
      <Ribbon
        arrows
        items={[
          {
            icon: <Search size={19} />,
            title: "Find",
            body: "In-market prospects",
          },
          {
            icon: <Send size={19} />,
            title: "Outreach",
            body: "Start conversations",
          },
          {
            icon: <Chat size={19} />,
            title: "Engage",
            body: "Prospects reply",
          },
          {
            icon: <Users size={19} />,
            title: "Promote",
            body: "Move to leads with full context",
          },
          {
            icon: <Chart size={19} />,
            title: "Convert",
            body: "Track to booked business",
          },
        ]}
      />
      </Reveal>
    </FlSection>
  );
}
