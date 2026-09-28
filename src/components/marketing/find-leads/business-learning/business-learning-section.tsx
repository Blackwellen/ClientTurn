import { ANALYSIS_STEPS, KNOWLEDGE_SOURCES, LEARNED_PROFILE } from "../data";
import {
  AppSurface,
  Badge,
  Briefcase,
  Check,
  ChevronRight,
  FlSection,
  Globe,
  Pin,
  Spinner,
  Target,
  Users,
  Wrench,
} from "../pieces";
import { StaggerItem, StaggerReveal, panelEnter } from "../motion";

const PROFILE_ICONS = [Briefcase, Wrench, Pin, Users, Target];

/**
 * Business Learning.
 *
 * The point of the section is the *reviewability*, not the cleverness: the
 * profile is shown as a set of editable facts with a visible source, because
 * §54 forbids hidden memory. The trust line under the panel is therefore load
 * bearing copy, not reassurance.
 */
export function BusinessLearningSection() {
  return (
    <FlSection id="business-context" glow="left">
      <div className="fl-chapter-head">
        <div>
          <p className="fl-eyebrow">Business context</p>
          <h2 className="fl-h2">
            ClientTurn learns what your business <em>actually sells.</em>
          </h2>
        </div>
        <div className="fl-chapter-aside">
          <p>
            A reviewable acquisition profile, built from your website and what
            you tell it.
          </p>
        </div>
      </div>

      <StaggerReveal className="fl-split" step={0.12}>
        {/* --------------------------------------------- website analysis */}
        <StaggerItem as="div" variants={panelEnter}>
        <AppSurface
          title="Analyse your business"
          subtitle="Interface demonstration"
          actions={<Badge tone="lime">Website</Badge>}
        >
          <div className="fl-fields" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
            <div className="fl-field">
              <span>Website URL</span>
              <div className="fl-field-box">
                <b>https://example-studio.co.uk</b>
                <Globe size={13} />
              </div>
            </div>
            <div className="fl-field">
              <span aria-hidden>&nbsp;</span>
              <span className="fl-field-box" style={{ borderColor: "rgb(183 243 74 / 0.45)", color: "var(--fl-lime-soft)" }}>
                <b>Analyse business</b>
                <ChevronRight size={13} />
              </span>
            </div>
          </div>

          <ul className="fl-stages" style={{ marginTop: 18 }}>
            {ANALYSIS_STEPS.map((step, index) => {
              const running = index === ANALYSIS_STEPS.length - 1;
              return (
                <li
                  key={step}
                  className="fl-stage"
                  data-status={running ? "RUNNING" : "COMPLETED"}
                >
                  <span aria-hidden className="fl-stage-mark">
                    {running ? <Spinner size={11} /> : <Check size={11} />}
                  </span>
                  <span className="fl-stage-name">{step}</span>
                  <span className="fl-stage-status">
                    {running ? "Running" : "Done"}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="fl-note-line">
            Edit anything before sourcing. No hidden model memory: every fact
            shows its source.
          </p>
        </AppSurface>
        </StaggerItem>

        {/* ------------------------------------------ acquisition profile */}
        <StaggerItem as="div" variants={panelEnter}>
        <AppSurface
          title="Acquisition profile"
          subtitle="Editable, and attributed to a source"
          actions={<Badge tone="green">Reviewed</Badge>}
        >
          <div role="list" className="fl-deflist">
            {LEARNED_PROFILE.map((row, index) => {
              const RowIcon = PROFILE_ICONS[index] ?? Briefcase;
              return (
                <div role="listitem" className="fl-def" key={row.label}>
                  <span aria-hidden className="fl-def-icon">
                    <RowIcon size={13} />
                  </span>
                  <div>
                    <span className="fl-def-term">{row.label}</span>
                    <span className="fl-def-desc">{row.value.join(", ")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </AppSurface>
        </StaggerItem>
      </StaggerReveal>

      {/* --------------------------------------- knowledge source callouts */}
      <StaggerReveal
        as="ul"
        className="fl-cats"
        step={0.06}
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          marginTop: 22,
        }}
      >
        {KNOWLEDGE_SOURCES.map((source) => (
          <StaggerItem as="li" key={source.title} className="fl-cat" style={{ padding: "16px 16px 15px" }}>
            <div className="fl-cat-top">
              <Check size={14} />
              <strong style={{ fontSize: 13 }}>{source.title}</strong>
            </div>
            <small style={{ fontSize: 12, lineHeight: 1.55 }}>{source.body}</small>
          </StaggerItem>
        ))}
      </StaggerReveal>
    </FlSection>
  );
}
