/**
 * The Admin → System views. A plain module (not "use client") so the System
 * page, a Server Component, reads the real values: imported from the client
 * switch component they arrived as client references and every ?view= fell
 * back to Health.
 */
export const SYSTEM_VIEWS = [
  "health",
  "events",
  "errors",
  "jobs",
  "compliance",
  "readiness",
  "lead-ops",
  "ai-spend",
  "domain-events",
  "audit",
  "voice",
] as const;
export type SystemView = (typeof SYSTEM_VIEWS)[number];

export const SYSTEM_VIEW_LABEL: Record<SystemView, string> = {
  health: "Health",
  events: "Events",
  errors: "Errors",
  jobs: "Jobs",
  compliance: "Compliance",
  readiness: "Readiness",
  "lead-ops": "Lead ops",
  "ai-spend": "AI spend",
  "domain-events": "Domain events",
  audit: "Audit log",
  voice: "Voice ops",
};

export const SYSTEM_VIEW_DESCRIPTION: Record<SystemView, string> = {
  health: "Monitor platform health, jobs and degraded workspaces.",
  events: "Inspect operational events, retries and webhook activity across the platform.",
  errors: "Review platform errors, investigate impact, and triage issues quickly.",
  jobs: "Monitor and manage background jobs across the ClientTurn platform.",
  compliance:
    "Manage communication policies, regional requirements and compliance controls.",
  readiness:
    "Release readiness, measured from the running system rather than ticked by hand.",
  "lead-ops": "Stuck leads across every workspace, and the duplicate queue with reversible merges.",
  "ai-spend": "AI spend per workspace and task, budget refusals, and provider quota usage.",
  "domain-events": "The domain event outbox: what happened, and whether it has been dispatched.",
  audit: "The platform audit log: every recorded write, filterable by action, actor and period.",
  voice: "AI calling across the platform: live calls, minutes, spend, margin, numbers, failures and emergency controls.",
};

