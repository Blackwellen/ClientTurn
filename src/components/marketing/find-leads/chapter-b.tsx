import Link from "next/link";
import { ProspectsPanel } from "./prospects/prospects-panel";
import { ScoringPanel } from "./scoring/scoring-panel";
import { SourcingAgentChat } from "./sourcing/sourcing-agent-chat";
import {
  ArrowRight,
  ChapterCard,
  ChapterHead,
  Eye,
  FlSection,
  Filter,
  Ribbon,
  Send,
  Shield,
} from "./pieces";

/**
 * Chapter B — from prompt to prospects.
 *
 * Three cards read left to right as one argument: the run is inspectable, the
 * result is reviewable, and the score explains itself. Each card owns the
 * heading the page's H2 sequence requires, so the outline stays legible to a
 * crawler and to a screen reader moving by heading.
 */
export function ChapterB() {
  return (
    <FlSection id="sourcing" glow="centre">
      <ChapterHead
        eyebrow="From prompt to prospects"
        title="Transparent sourcing."
        accent="Higher quality opportunities."
        aside="See the work, review the results and understand why each prospect is a good fit before you act on it."
        action={
          <Link href="#prospects" className="fl-btn fl-btn-ghost">
            Learn more about sourcing
            <ArrowRight size={14} />
          </Link>
        }
      />

      <div className="fl-cards">
        <ChapterCard
          index="1"
          eyebrow="Sourcing run"
          title="See what ClientTurn is doing while it builds the list."
          body="Sourcing runs in the background, but you should still know which stage the system is in, how far it has got and whether anything needs attention."
        >
          <SourcingAgentChat />
        </ChapterCard>

        <ChapterCard
          index="2"
          eyebrow="Prospects"
          title="Review sourced prospects before they become leads."
          body="Prospects stay separate from warm leads until they engage or you approve a promotion step, so cold research never lands in your live pipeline."
        >
          <div id="prospects">
            <ProspectsPanel />
          </div>
        </ChapterCard>

        <ChapterCard
          index="3"
          eyebrow="Explainable scoring"
          title="A score should explain itself."
          body="ClientTurn combines deterministic scoring with evidence drawn from company fit, role relevance, geography, need, intent and data quality."
        >
          <ScoringPanel />
        </ChapterCard>
      </div>

      <Ribbon
        items={[
          {
            icon: <Shield size={19} />,
            title: "Verified data",
            body: "Checked against your configured deliverability threshold.",
          },
          {
            icon: <Filter size={19} />,
            title: "Clear scoring",
            body: "Every factor carries its weight, evidence and freshness.",
          },
          {
            icon: <Eye size={19} />,
            title: "Full transparency",
            body: "Twelve named stages, in the product's own words.",
          },
          {
            icon: <Send size={19} />,
            title: "Controlled outreach",
            body: "Approved prospects only, inside your campaign limits.",
          },
        ]}
      />
    </FlSection>
  );
}
