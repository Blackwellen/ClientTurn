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

/**
 * Chapter C — intent, campaigns and the handover into the warm lead engine.
 *
 * The closing ribbon is a flow rather than four parallel virtues, because the
 * argument of this chapter is sequential: find, reach out, get a reply, promote,
 * convert.
 */
export function ChapterC() {
  return (
    <FlSection id="campaigns" glow="left">
      <ChapterHead
        eyebrow="Intent, campaigns & growth"
        title="Find the right opportunities."
        accent="Take the next step."
        aside="Prioritise in-market prospects, run bounded outreach and move engaged prospects into your lead pipeline with full context."
        action={
          <Link href="#promotion" className="fl-btn fl-btn-ghost">
            See it in action
            <ArrowRight size={14} />
          </Link>
        }
      />

      <div className="fl-cards">
        <ChapterCard
          index="01"
          eyebrow="Buying intent"
          title="Prioritise companies showing a reason to care now."
          body="Named intent categories and permitted signals help prioritise prospects whose business context suggests a more immediate need."
        >
          <IntentPanel />
        </ChapterCard>

        <ChapterCard
          index="02"
          eyebrow="Campaigns"
          title="Coordinate acquisition without building a generic automation maze."
          body="Set the conversion goal, audience, minimum fit, intent requirement, sequence, review mode and limits in one controlled workflow."
        >
          <CampaignPanel />
        </ChapterCard>

        <ChapterCard
          index="03"
          eyebrow="Prospect → Lead"
          title="When a prospect engages, the history moves with them."
          body="Cold outreach and research stay attached to the prospect until promotion. On promotion, the conversation and campaign context come too."
        >
          <div id="promotion">
            <PromotionPanel />
          </div>
        </ChapterCard>
      </div>

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
    </FlSection>
  );
}
