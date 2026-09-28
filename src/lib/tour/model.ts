/**
 * The product-tour step model (Phase 8.4).
 *
 * A tour is a list of steps. Each step names the element it explains by a
 * `data-tour="…"` key rather than a CSS selector, so markup can be restyled or
 * moved without breaking the tour, and a grep for the key finds both ends.
 *
 * `targets` is an ordered list of candidates: the first one that is actually
 * visible wins. That is how one step works at every screen size — the sidebar
 * link on desktop, the menu button on a phone where the sidebar is hidden —
 * and a step whose targets are all missing still shows, as a floating caption,
 * rather than stalling the tour.
 *
 * The exception is `requiresTarget`: a step about a plan-gated destination
 * (Find Leads, Analytics are hidden from the sidebar on trial) is skipped
 * outright when that element is not in the document, so the tour never
 * describes a page the workspace cannot open. Presence, not visibility: the
 * desktop rail stays in the DOM on a phone, only hidden.
 *
 * Pure: no imports.
 */

export type TourPlacement = "auto" | "top" | "bottom" | "left" | "right";

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /**
   * `data-tour` keys, most specific first. Every step names at least one: a
   * caption floats only when none of them is on screen, never by design.
   */
  targets: string[];
  /** Navigate here first when the current page is not this route. */
  route?: string;
  placement?: TourPlacement;
  /**
   * Skip this step when no element carries this `data-tour` key. For steps
   * about something the plan may hide; other steps fall back to a caption.
   */
  requiresTarget?: string;
};

export type TourDefinition = {
  id: string;
  /** Bump when the tour changes enough to be worth showing again. */
  version: number;
  steps: TourStep[];
};

export const FIRST_USE_TOUR: TourDefinition = {
  id: "first-use",
  version: 1,
  steps: [
    {
      id: "welcome",
      title: "Welcome to ClientTurn",
      body: "This is your workspace. A two-minute tour of where everything lives: use the arrow keys to move, or Esc to leave at any time. You can replay it from Help.",
      targets: ["workspace-card", "open-nav"],
      placement: "right",
    },
    {
      id: "nav-dashboard",
      title: "Dashboard",
      body: "Your day at a glance: new leads, what needs attention, bookings and how each source is performing.",
      targets: ["nav-dashboard", "open-nav"],
      placement: "right",
    },
    {
      id: "nav-agents",
      title: "Agents",
      body: "Agents work in the background within the limits you set: finding businesses that fit, booking replies in, or re-engaging leads that went quiet. Each one starts in draft and only runs when you start it.",
      targets: ["nav-agents", "open-nav"],
      placement: "right",
    },
    {
      id: "nav-leads",
      title: "Leads",
      body: "Every enquiry and its whole history — messages, qualification answers and bookings — in one list.",
      targets: ["nav-leads", "open-nav"],
      placement: "right",
    },
    {
      id: "nav-find-leads",
      title: "Find Leads",
      body: "Search for new businesses that match your ideal customer, check each contact before it is used, and approve the ones worth reaching out to.",
      targets: ["nav-find-leads", "open-nav"],
      placement: "right",
      requiresTarget: "nav-find-leads",
    },
    {
      id: "nav-follow-up",
      title: "Follow-Up",
      body: "The automatic follow-up sequence, your qualification questions and rules, quiet hours and booking behaviour.",
      targets: ["nav-follow-up", "open-nav"],
      placement: "right",
    },
    {
      id: "nav-reactivation",
      title: "Reactivation",
      body: "Re-engage older enquiries that went quiet. Opt-outs and suppression are applied before anything is sent.",
      targets: ["nav-reactivation", "open-nav"],
      placement: "right",
    },
    {
      id: "nav-analytics",
      title: "Analytics",
      body: "Lead and conversion trends across the whole journey, and how each source, channel and campaign is performing.",
      targets: ["nav-analytics", "open-nav"],
      placement: "right",
      requiresTarget: "nav-analytics",
    },
    {
      id: "nav-settings",
      title: "Settings",
      body: "Your business profile, team, messaging and every connection to your other tools.",
      targets: ["nav-settings", "open-nav"],
      placement: "right",
    },
    {
      id: "revenue-control",
      title: "Revenue control",
      body: "These cards show where value is being won or lost across your pipeline. Each one links to the leads behind the number.",
      targets: ["dashboard-revenue-control"],
      route: "/app",
      placement: "top",
    },
    {
      id: "leads-list",
      title: "Your leads",
      body: "Filter, sort and search every lead. Quick filters along the top take you straight to the ones that need a reply.",
      targets: ["leads-list"],
      route: "/app/leads",
      placement: "top",
    },
    {
      id: "lead-drawer",
      title: "The lead drawer",
      body: "Click any lead to open its drawer: the conversation, the qualification result and the next action, without leaving the list.",
      targets: ["lead-drawer", "leads-list"],
      route: "/app/leads",
      placement: "left",
    },
    {
      id: "inbox",
      title: "Inbox",
      body: "Replies from every channel in one place. Anything handed over to a person lands here.",
      targets: ["inbox"],
      route: "/app/inbox",
      placement: "top",
    },
    {
      id: "copilot",
      title: "Copilot",
      body: "Ask anything about your workspace in plain English. Copilot acts with your permissions, and high-impact actions wait for you to confirm.",
      targets: ["copilot-button"],
      placement: "bottom",
    },
    {
      id: "help",
      title: "Help is always here",
      body: "Search the help centre, raise a support ticket or check system status without leaving the page you are on.",
      targets: ["help-launcher"],
      placement: "top",
    },
    {
      id: "connections",
      title: "Connect your tools",
      body: "Connect your lead sources, mailbox, calendar and CRM here. Each card shows its health and what to do if it needs attention.",
      targets: ["settings-connections", "nav-settings", "open-nav"],
      route: "/app/settings?section=connections",
      placement: "top",
    },
    {
      id: "done",
      title: "You are all set",
      body: "That is the tour. Replay it any time from Help, or press Tour this page at the top of any section for a closer look.",
      targets: ["help-launcher"],
      placement: "top",
    },
  ],
};

export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), total - 1);
}

export function stepCounter(index: number, total: number): string {
  return `Step ${clampStep(index, total) + 1} of ${total}`;
}

export function isLastStep(index: number, total: number): boolean {
  return total > 0 && index >= total - 1;
}

export function tourSelector(key: string): string {
  // Keys are authored in code, but escape anyway so a stray quote cannot
  // turn into a selector syntax error.
  return `[data-tour="${key.replace(/["\\]/g, "\\$&")}"]`;
}

/**
 * Whether the browser is already on a step's route. The path must match
 * exactly and every query parameter the route names must be present with the
 * same value; extra parameters on the page (a filter, a lead id) are allowed.
 */
export function routeMatches(route: string, pathname: string, search: string): boolean {
  const [routePath, routeQuery = ""] = route.split("?");
  const normalise = (value: string) => (value.length > 1 ? value.replace(/\/+$/, "") : value);
  if (normalise(routePath) !== normalise(pathname)) return false;
  const want = new URLSearchParams(routeQuery);
  const have = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [key, value] of want) {
    if (have.get(key) !== value) return false;
  }
  return true;
}

/** Every `data-tour` key a tour depends on, for the wiring test. */
export function tourTargetKeys(tour: TourDefinition): string[] {
  return [...new Set(tour.steps.flatMap((step) => step.targets))];
}

/* ------------------------------------------------------ skipping steps */

/** Whether a step can be shown, given which `data-tour` keys are present. */
export function isStepAvailable(step: TourStep, isPresent: (key: string) => boolean): boolean {
  return !step.requiresTarget || isPresent(step.requiresTarget);
}

/**
 * The next (direction 1) or previous (-1) step that can be shown, or null when
 * there is none — for "next", null means the tour is over.
 */
export function adjacentStepIndex(
  steps: readonly TourStep[],
  from: number,
  direction: 1 | -1,
  isPresent: (key: string) => boolean,
): number | null {
  for (let index = from + direction; index >= 0 && index < steps.length; index += direction) {
    if (isStepAvailable(steps[index], isPresent)) return index;
  }
  return null;
}

/**
 * Where a step sits among the ones that will be shown, for "Step 3 of 12".
 * Counting skipped steps would make the counter jump and never reach its total.
 */
export function availablePosition(
  steps: readonly TourStep[],
  index: number,
  isPresent: (key: string) => boolean,
): { index: number; total: number } {
  const available = steps
    .map((step, position) => ({ step, position }))
    .filter(({ step }) => isStepAvailable(step, isPresent));
  const at = available.findIndex(({ position }) => position === index);
  return { index: Math.max(0, at), total: Math.max(1, available.length) };
}

/* ------------------------------------------------------ section tours */

/**
 * One short tour per destination (Phase 8.29).
 *
 * The first-use tour is a map of the whole product; these are a closer look at
 * one page each: three to six steps over the components you actually use
 * there, in the order they sit on screen. Each starts on its own the first
 * time you open that page after the first-use tour is finished or skipped,
 * and can be replayed from "Tour this page" in the top bar or from Help.
 *
 * Copy rules: say what to do, use the label that is on the screen, and never
 * describe a feature the page does not have. Steps about something only some
 * roles or plans see carry `requiresTarget`, so they are skipped rather than
 * shown as a caption about nothing.
 */

export const SECTION_KEYS = [
  "dashboard",
  "leads",
  "follow-up",
  "reactivation",
  "settings",
  "find-leads",
  "agents",
  "analytics",
  "inbox",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionTour = TourDefinition & {
  section: SectionKey;
  /** What the "Tour this page" button and Help call it. */
  label: string;
  /** The page the tour belongs to. Auto-start only fires on this exact path. */
  path: string;
};

function sectionTour(
  section: SectionKey,
  label: string,
  path: string,
  steps: TourStep[],
  version = 1,
): SectionTour {
  return { id: `section:${section}`, version, section, label, path, steps };
}

export const SECTION_TOURS: readonly SectionTour[] = [
  sectionTour("dashboard", "Dashboard", "/app", [
    {
      id: "setup-checklist",
      title: "Finish setting up",
      body: "Anything you skipped during setup waits here. Do them in any order: each one opens the page where it is done.",
      targets: ["dashboard-setup-checklist"],
      requiresTarget: "dashboard-setup-checklist",
      placement: "bottom",
    },
    {
      id: "date-range",
      title: "Choose the period",
      body: "Every number on this page follows this range: Last 7, 30 or 90 days, or Custom.",
      targets: ["dashboard-date-range"],
      placement: "bottom",
    },
    {
      id: "health",
      title: "Check the health tiles",
      body: "Lead source, Messaging, Booking destination and Follow-up. Amber or red means leads cannot be contacted or booked, so click the tile to fix it.",
      targets: ["dashboard-health"],
      placement: "bottom",
    },
    {
      id: "kpis",
      title: "Read your numbers",
      body: "New Leads through to Estimated Pipeline, each compared with the previous period.",
      targets: ["dashboard-kpis"],
      placement: "bottom",
    },
    {
      id: "funnel",
      title: "Open the leads behind a stage",
      body: "Click any stage in the Lead funnel to see exactly which leads are sitting in it.",
      targets: ["dashboard-funnel"],
      placement: "right",
    },
    {
      id: "needs-attention",
      title: "Start with Needs attention",
      body: "The leads and system issues that need a person first. Work down this list at the start of each day.",
      targets: ["dashboard-needs-attention"],
      placement: "left",
    },
  ]),
  sectionTour("leads", "Leads", "/app/leads", [
    {
      id: "add",
      title: "Add or import leads",
      body: "Add lead creates one record by hand and Import brings in a CSV file. Leads from your connected forms and tools arrive here on their own.",
      targets: ["leads-add"],
      placement: "bottom",
    },
    {
      id: "quick-filters",
      title: "Jump to what needs you",
      body: "All, Active, Needs Attention, Qualified and Booked. Start with Needs Attention: those leads are waiting on a person.",
      targets: ["leads-quick-filters"],
      placement: "bottom",
    },
    {
      id: "toolbar",
      title: "Search and filter",
      body: "Search by name, phone, email or service, narrow the list with Filters, and switch between card and table view.",
      targets: ["leads-toolbar"],
      placement: "bottom",
    },
    {
      id: "list",
      title: "Open a lead",
      body: "Click any lead to open its drawer: the conversation, the qualification answers and the next step, without losing your place.",
      targets: ["leads-list"],
      placement: "top",
    },
  ]),
  sectionTour("follow-up", "Follow-Up", "/app/follow-up", [
    {
      id: "view-switch",
      title: "Two jobs, one page",
      body: "Follow-Up is how every new lead is chased. Qualification decides which leads are worth a meeting. Switch between them here.",
      targets: ["follow-up-view-switch"],
      placement: "bottom",
    },
    {
      id: "status",
      title: "Check it is live",
      body: "This shows whether your sequence is published and running. Admins can pause it here at any time.",
      targets: ["follow-up-status"],
      route: "/app/follow-up?view=follow-up",
      placement: "bottom",
    },
    {
      id: "sequence",
      title: "Edit the sequence",
      body: "Each step is a timed message. Use Add step for another; nothing changes for your leads until you publish.",
      targets: ["follow-up-sequence"],
      route: "/app/follow-up?view=follow-up",
      placement: "top",
    },
    {
      id: "tabs",
      title: "Settings, rules and results",
      body: "Sequence, Settings for quiet hours, Enrolment rules for who gets chased, and Performance to see what it produced.",
      targets: ["follow-up-tabs"],
      route: "/app/follow-up?view=follow-up",
      placement: "bottom",
    },
    {
      id: "qualification",
      title: "Set your qualifying questions",
      body: "Write the questions a lead answers and the rule for each. The rules decide, and anything unclear goes to review. Publish changes when you are happy.",
      targets: ["qualification-questions"],
      route: "/app/follow-up?view=qualification",
      placement: "top",
    },
  ]),
  sectionTour("reactivation", "Reactivation", "/app/reactivation", [
    {
      id: "create",
      title: "Start a campaign",
      body: "Create campaign picks a group of older leads and a message. Opt-outs, suppressions and quiet hours are applied before anything is sent.",
      targets: ["reactivation-create", "reactivation-actions"],
      placement: "bottom",
    },
    {
      id: "summary",
      title: "See what came back",
      body: "Eligible leads, replies, qualified, booked and revenue across every campaign.",
      targets: ["reactivation-summary"],
      requiresTarget: "reactivation-summary",
      placement: "bottom",
    },
    {
      id: "toolbar",
      title: "Find a campaign",
      body: "Search campaigns and filter by Status, Audience or Date range.",
      targets: ["reactivation-toolbar"],
      requiresTarget: "reactivation-toolbar",
      placement: "bottom",
    },
    {
      id: "campaigns",
      title: "Open a campaign",
      body: "Open any campaign to see who was contacted, who replied and what was booked.",
      targets: ["reactivation-campaigns"],
      requiresTarget: "reactivation-campaigns",
      placement: "top",
    },
  ]),
  sectionTour("settings", "Settings", "/app/settings", [
    {
      id: "nav",
      title: "Everything in one place",
      body: "Eight areas, from Workspace to Billing & Usage. Pick a card to open that area.",
      targets: ["settings-nav"],
      placement: "bottom",
    },
    {
      id: "workspace",
      title: "Keep your details current",
      body: "Business info, services and hours. Follow-up and qualification use these, so check them whenever something changes.",
      targets: ["settings-workspace"],
      requiresTarget: "settings-workspace",
      placement: "top",
    },
    {
      id: "connections",
      title: "Connect your tools",
      body: "Lead forms, mailbox, calendar and CRM. Each connection shows its health and what to do if it needs attention.",
      targets: ["settings-nav-connections"],
      placement: "bottom",
    },
    {
      id: "business-profile",
      title: "Describe who you sell to",
      body: "What we know about your business, your ideal customer profiles and your goals.",
      targets: ["settings-nav-business-profile"],
      placement: "bottom",
    },
    {
      id: "team",
      title: "Invite your team",
      body: "Add colleagues and choose the role each one has.",
      targets: ["settings-nav-team"],
      placement: "bottom",
    },
    {
      id: "billing",
      title: "Plan and usage",
      body: "Your plan, what you have used this period and your invoices. Only the workspace owner can change billing.",
      targets: ["settings-nav-billing"],
      placement: "bottom",
    },
  ]),
  sectionTour("find-leads", "Find Leads", "/app/find-leads", [
    {
      id: "views",
      title: "Choose how to find prospects",
      body: "Discover, Prospects, Intent, Campaigns and Social. Start in Discover.",
      targets: ["find-leads-views"],
      requiresTarget: "find-leads-views",
      placement: "bottom",
    },
    {
      id: "profile",
      title: "Set up your business profile first",
      body: "Searches are aimed using your acquisition profile. Complete it and the matches get better.",
      targets: ["find-leads-profile"],
      requiresTarget: "find-leads-profile",
      placement: "left",
    },
    {
      id: "chat",
      title: "Describe who you want",
      body: "Tell ClientTurn AI which businesses or people you want to find, in plain English. Each contact is checked before it can be used.",
      targets: ["find-leads-chat"],
      requiresTarget: "find-leads-chat",
      placement: "left",
    },
    {
      id: "sessions",
      title: "Pick up where you left off",
      body: "Earlier searches are kept under Search sessions. Use New search to start a fresh one.",
      targets: ["find-leads-sessions"],
      requiresTarget: "find-leads-sessions",
      placement: "right",
    },
  ]),
  sectionTour("agents", "Agents", "/app/agents", [
    {
      id: "summary",
      title: "Agent health at a glance",
      body: "How many agents are running, need attention or are still in draft. Every agent runs inside your limits and contact rules.",
      targets: ["agents-summary"],
      placement: "bottom",
    },
    {
      id: "new",
      title: "Create an agent",
      body: "New agent sets one up in draft. It only runs once you start it.",
      targets: ["agents-new"],
      requiresTarget: "agents-new",
      placement: "left",
    },
    {
      id: "sourcing",
      title: "Sourcing agents",
      body: "Find new businesses that fit what you sell.",
      targets: ["agents-sourcing"],
      placement: "top",
    },
    {
      id: "booking",
      title: "Closing agents",
      body: "Chase qualified leads that have not booked, bought or signed up yet.",
      targets: ["agents-booking"],
      placement: "top",
    },
    {
      id: "reengagement",
      title: "Re-engagement agents",
      body: "Recover value from leads that went quiet.",
      targets: ["agents-reengagement"],
      placement: "top",
    },
  ]),
  sectionTour("analytics", "Analytics", "/app/analytics", [
    {
      id: "range",
      title: "Pick a period",
      body: "From Last 7 days to Last 12 months. Export downloads the view you are looking at.",
      targets: ["analytics-range"],
      placement: "bottom",
    },
    {
      id: "views",
      title: "Change the lens",
      body: "Overview, Acquisition, Outreach, Conversion and Source funnels each answer a different question.",
      targets: ["analytics-views"],
      placement: "bottom",
    },
    {
      id: "metrics",
      title: "Headline numbers",
      body: "The key figures for this view and period.",
      targets: ["analytics-metrics"],
      requiresTarget: "analytics-metrics",
      placement: "bottom",
    },
    {
      id: "breakdown",
      title: "Break it down",
      body: "Slice the results by source or campaign to see what is actually working.",
      targets: ["analytics-breakdown"],
      requiresTarget: "analytics-breakdown",
      placement: "top",
    },
  ]),
  sectionTour("inbox", "Inbox", "/app/inbox", [
    {
      id: "channels",
      title: "Filter by channel",
      body: "All messages, or one channel at a time: Email, WhatsApp, SMS and the rest.",
      targets: ["inbox-channels"],
      placement: "right",
    },
    {
      id: "conversations",
      title: "Triage conversations",
      body: "Received, Interested, Unread or All, plus search. Anything handed over to a person lands here.",
      targets: ["inbox-conversations"],
      placement: "right",
    },
    {
      id: "thread",
      title: "Read and reply",
      body: "Open a conversation to read it, reply, mark it read or archive it.",
      targets: ["inbox-thread"],
      placement: "left",
    },
    {
      id: "manage-channels",
      title: "Add another channel",
      body: "Manage channels takes you to Connections, where you connect another inbox.",
      targets: ["inbox-manage-channels"],
      placement: "bottom",
    },
  ]),
];

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && (SECTION_KEYS as readonly string[]).includes(value);
}

export function sectionTourFor(section: SectionKey): SectionTour {
  const tour = SECTION_TOURS.find((candidate) => candidate.section === section);
  if (!tour) throw new Error(`No section tour for ${section}`);
  return tour;
}

/**
 * The section tour for the page the browser is on, or null. Exact path only:
 * `/app/leads/123` is a lead, not the Leads page, and a tour about the list
 * would describe things that page does not have.
 */
export function sectionTourForPath(pathname: string): SectionTour | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return SECTION_TOURS.find((tour) => tour.path === path) ?? null;
}

/** The first step that can be shown, or null when none can (a plan-gated page, say). */
export function firstAvailableIndex(
  steps: readonly TourStep[],
  isPresent: (key: string) => boolean,
): number | null {
  return adjacentStepIndex(steps, -1, 1, isPresent);
}
