import * as React from "react";
import {
  Bot,
  Calendar,
  CircleHelp,
  CreditCard,
  GraduationCap,
  ListChecks,
  Phone,
  Plug,
  Radar,
  Repeat,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import type { HelpIconKey } from "@/lib/help/categories";

/** Category icon keys to components. One map for every help surface. */
export const HELP_ICONS: Record<HelpIconKey, React.ComponentType<{ className?: string }>> = {
  rocket: Rocket,
  radar: Radar,
  "list-checks": ListChecks,
  calendar: Calendar,
  repeat: Repeat,
  sparkles: Sparkles,
  bot: Bot,
  phone: Phone,
  settings: Settings,
  plug: Plug,
  terminal: Terminal,
  shield: ShieldCheck,
  "credit-card": CreditCard,
  "graduation-cap": GraduationCap,
  "circle-help": CircleHelp,
  wrench: Wrench,
};

export function helpIcon(key: string | null | undefined) {
  return HELP_ICONS[(key ?? "") as HelpIconKey] ?? CircleHelp;
}

/** A category icon by key, as a static component (lint-safe: no component is created during render). */
export function HelpIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  return React.createElement(HELP_ICONS[(icon ?? "") as HelpIconKey] ?? CircleHelp, { className });
}
