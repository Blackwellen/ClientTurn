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
            Before sourcing, ClientTurn builds a reviewable acquisition profile
            from your website and the information you give it.
          </p>
        </div>
      </div>

      <div className="fl-split">
        {/* --------------------------------------------- website analysis */}
        <AppSurface
          title="Analyse your business"
          subtitle="Interface demonstration"
          actions={<Badge tone="lime">Website</Badge>}
        >
          <div className="fl-fields" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
            <div className="fl-field">
              <span>Website URL</span>
              <div className="fl-field-box">
                <b>https://example-roofing.co.uk</b>
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
            Review and edit what ClientTurn learns before it is used for
            sourcing. Nothing is stored as hidden model memory — every fact is
            listed with the source it came from.
          </p>
        </AppSurface>

        {/* ------------------------------------------ acquisition profile */}
        <AppSurface
          title="Acquisition profile"
          subtitle="Editable, and attributed to a source"
          actions={<Badge tone="green">Reviewed</Badge>}
        >
          <dl className="fl-deflist">
            {LEARNED_PROFILE.map((row, index) => {
              const RowIcon = PROFILE_ICONS[index] ?? Briefcase;
              return (
                <div className="fl-def" key={row.label}>
                  <span aria-hidden className="fl-def-icon">
                    <RowIcon size={13} />
                  </span>
                  <div>
                    <dt>{row.label}</dt>
                    <dd>{row.value.join(", ")}</dd>
                  </div>
                </div>
              );
            })}
          </dl>
        </AppSurface>
      </div>

      {/* --------------------------------------- knowledge source callouts */}
      <ul
        className="fl-cats"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          marginTop: 22,
        }}
      >
        {KNOWLEDGE_SOURCES.map((source) => (
          <li key={source.title} className="fl-cat" style={{ padding: "16px 16px 15px" }}>
            <div className="fl-cat-top">
              <Check size={14} />
              <strong style={{ fontSize: 13 }}>{source.title}</strong>
            </div>
            <small style={{ fontSize: 12, lineHeight: 1.55 }}>{source.body}</small>
          </li>
        ))}
      </ul>
    </FlSection>
  );
}
