"use client";

import * as React from "react";
import { CATEGORY_TEMPLATES } from "@/lib/intent/types";
import { trackEngagement } from "@/lib/marketing/track";
import {
  fadeUp,
  motion,
  stagger,
  useSequence,
  T,
} from "../motion";
import { INTENT_EVENTS, INTENT_FILTERS } from "../data";
import {
  AppSurface,
  Badge,
  Bolt,
  Building,
  ChevronDown,
  ChevronRight,
  Chart,
  Clock,
  Doc,
  Globe,
  Shield,
  Trend,
  Users,
} from "../pieces";

/**
 * Buying intent.
 *
 * The category names are `CATEGORY_TEMPLATES` — the starting points the real
 * category builder offers — so this section cannot advertise a signal family
 * the product has no monitor for. Each category carries its own freshness
 * window, which is the honest version of "intent": a signal counts while it is
 * current and stops counting when it is not.
 *
 * One event pulses once when the feed first comes into view. There is no
 * looping ticker: a feed that flashes forever implies a firehose nobody has.
 */

const EVENT_ICONS = [Doc, Users, Building, Globe, Chart];
const CATEGORY_ICONS = [Trend, Doc, Building, Users, Globe, Bolt];

export function IntentPanel() {
  // One pulse on the newest signal, once, when the feed is first seen.
  const { ref, step, reduced } = useSequence<HTMLUListElement>(1, 500);
  const [filter, setFilter] = React.useState("All signals");

  const events =
    filter === "High intent"
      ? INTENT_EVENTS.filter((e) => e.strength === "High")
      : filter === "New this week"
        ? INTENT_EVENTS.slice(0, 3)
        : INTENT_EVENTS;

  return (
    <AppSurface
      title="Intent signals"
      subtitle="Live signals inside their freshness window"
      actions={
        <span className="fl-mini-btn">
          <Clock size={11} />
          Last 30 days
          <ChevronDown size={10} />
        </span>
      }
      footer={
        <div className="fl-app-foot">
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: "var(--fl-lime-soft)",
            }}
          >
            <Shield size={13} />
            Licensed providers, permitted public sources and your own data.
          </span>
          <span className="fl-mini-btn">
            View categories
            <ChevronRight size={11} />
          </span>
        </div>
      }
    >
      <motion.ul
        className="fl-filters"
        aria-label="Intent signal filters"
        initial={reduced ? "shown" : "hidden"}
        whileInView="shown"
        viewport={{ once: true, amount: 0.4 }}
        variants={stagger(reduced ? 0 : 0.04)}
      >
        {INTENT_FILTERS.map((item) => (
          <motion.li key={item.label} variants={fadeUp}>
            <motion.button
              type="button"
              className="fl-filter"
              whileTap={reduced ? undefined : { scale: 0.96 }}
              transition={T.fast}
              aria-pressed={filter === item.label}
              onClick={() => {
                setFilter(item.label);
                trackEngagement("find_leads_intent_interaction", item.label);
              }}
            >
              {item.label}
              <b>{item.count}</b>
            </motion.button>
          </motion.li>
        ))}
      </motion.ul>

      <motion.ul
        className="fl-events"
        ref={ref}
        aria-label="Recent intent signals"
        initial={reduced ? "shown" : "hidden"}
        whileInView="shown"
        viewport={{ once: true, amount: 0.2 }}
        variants={stagger(reduced ? 0 : 0.06)}
      >
        {events.map((event, index) => {
          const EventIcon = EVENT_ICONS[index] ?? Doc;
          return (
            <motion.li
              className="fl-event"
              key={event.title}
              layout={!reduced}
              variants={fadeUp}
              data-new={index === 0 && !reduced && step > 0}
            >
              <span aria-hidden className="fl-event-icon">
                <EventIcon size={14} />
              </span>
              <div>
                <strong>{event.title}</strong>
                <small>{event.detail}</small>
              </div>
              <Badge tone={event.strength === "High" ? "green" : "lime"}>
                {event.strength}
              </Badge>
              <span className="fl-event-age">{event.age}</span>
            </motion.li>
          );
        })}
      </motion.ul>

      {/* --------------------------------------------- signal categories */}
      <div className="fl-block">
        <p className="fl-sublabel">Signal categories</p>
        <motion.ul
          className="fl-cats"
          initial={reduced ? "shown" : "hidden"}
          whileInView="shown"
          viewport={{ once: true, amount: 0.25 }}
          variants={stagger(reduced ? 0 : 0.05)}
        >
          {CATEGORY_TEMPLATES.map((template, index) => {
            const CategoryIcon = CATEGORY_ICONS[index] ?? Trend;
            return (
              <motion.li className="fl-cat" key={template.name} variants={fadeUp}>
                <div className="fl-cat-top">
                  <CategoryIcon size={13} />
                  <strong>{template.name}</strong>
                </div>
                <small>
                  Monitoring · {template.freshnessDays}-day freshness window
                </small>
              </motion.li>
            );
          })}
        </motion.ul>
      </div>

      <p className="fl-note-line">
        Intent is bounded and it expires. A fresh signal can lift a good-fit
        prospect over a threshold; it can never carry a poor-fit one there on
        its own.
      </p>
    </AppSurface>
  );
}
