import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { showcaseConnectors, showcaseProviders } from "@/lib/marketing/integrations";
import { activeCategories } from "@/lib/marketing/integration-types";
import { Arc, Glow, GridTexture, PublicContainer, PublicSection, buttonClass } from "../ui";
import { IntegrationFlow, IntegrationFlowStack } from "./integration-flow";
import { ScrollDraw } from "./scroll-draw";
import { IntegrationGrid } from "./integration-grid";

/**
 * "Connect the tools around your pipeline."
 *
 * A Server Component, because availability is read from the deployment's own
 * environment — see `@/lib/marketing/integrations`. The section therefore
 * describes the connections this build can actually make, not a wish list.
 *
 * The primary action points at the catalogue further down this same section:
 * there is no standalone `/integrations` page yet, and sending a visitor to a
 * 404 to satisfy a button label would be worse than landing them on the list
 * itself.
 */
export function IntegrationsSection() {
  const connectors = showcaseConnectors();
  const providers = showcaseProviders();
  const categories = activeCategories(connectors, providers);

  return (
    <PublicSection
      id="integrations"
      labelledBy="integrations-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="bl" />
          <Glow x="centre" y="top" />
        </>
      }
    >
      <PublicContainer>
        <div className="grid items-center gap-12 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.35fr)]">
          <div>
            <p className="pub-eyebrow">Integrations</p>
            <h2
              id="integrations-heading"
              className="pub-h2 mt-5 !text-[clamp(2rem,3.3vw,3rem)]"
            >
              Connect the tools around <span className="pub-accent">your pipeline.</span>
            </h2>
            <p className="pub-lead mt-6 max-w-lg">
              Bring supported lead sources, communication, booking and CRM systems into the same
              operating flow.
            </p>
            <Link href="#integration-catalogue" className={buttonClass("primary", "lg", "mt-9")}>
              View all integrations
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>

          <ScrollDraw>
            <IntegrationFlow className="hidden xl:block" />
            <IntegrationFlowStack className="xl:hidden" />
          </ScrollDraw>
        </div>

        <div id="integration-catalogue" className="scroll-mt-28">
          <IntegrationGrid
            connectors={connectors}
            categories={categories}
            providers={providers}
          />
        </div>
      </PublicContainer>
    </PublicSection>
  );
}
