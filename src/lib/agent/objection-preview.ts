/**
 * "Try it": the objection library editor's offline preview (Settings -> AI &
 * selling -> Objections). Pure, and spends nothing.
 *
 * There is no fake model in this codebase, so the preview uses a
 * deterministic stub composer in its place and runs everything else for
 * real: the objection matcher, the business's own objections, the strategy
 * block the model would be given (`buildStrategyBlock`, OBJECTION_HANDLING),
 * the outbound validator (claims, pressure, the human-style lint) and the
 * reply grader. So a business sees which playbook fires, what the assistant
 * is told, a reply in the shape the assistant uses, and whether anything in
 * its own answer would be refused (a price it has not published, a dash, an
 * emoji, pressure wording).
 *
 * The stub's reply is labelled as an example: the live assistant words it
 * afresh each time, from the same plan.
 */

import { matchObjection, OBJECTIONS } from "../sales-library/objections.ts";
import { pickResponsePattern } from "../sales-library/objection-responses.ts";
import { matchWorkspaceObjection, type WorkspaceObjectionSet } from "../sales-library/workspace-objections.ts";
import { buildStrategyBlock } from "./strategy.ts";
import { validateResponse } from "./validate.ts";
import { fixHumanStyle } from "./human-style.ts";
import { gradeReply } from "./reply-grader.ts";
import type { SalesMotion } from "../sales-library/types.ts";
import type { AgentChannel } from "./types.ts";

export type ObjectionPreview = {
  /** Which playbook fired. Null = nothing matched: the assistant asks what the concern is. */
  libraryKey: string | null;
  libraryLabel: string | null;
  /** The business's own objection used, by row key. */
  workspaceKey: string | null;
  source: "WORKSPACE" | "LIBRARY" | "NONE";
  /** What the assistant is told this turn (never shown to the lead). */
  strategyText: string;
  /** An example reply in the shape the assistant uses. */
  exampleReply: string;
  /** Validator findings on the example: what the assistant would be refused. */
  problems: { code: string; detail: string }[];
  grade: number;
  handsOver: boolean;
};

const ACKNOWLEDGE: Partial<Record<string, string>> = {
  PRICE: "Fair question.",
  BUDGET: "Budgets are real, so no problem.",
  TRUST: "Fair challenge.",
  COMPETITOR: "Sensible to compare.",
  EXISTING_PROVIDER: "Good to hear it's working.",
  NOT_NOW: "No pressure at all.",
  TIMING: "Makes sense.",
  JUST_LOOKING: "No pressure at all.",
  TOO_BUSY: "Totally get it.",
  AUTHORITY: "Of course.",
  SEND_INFORMATION: "Happy to.",
};

export function previewObjection(input: {
  message: string;
  channel?: AgentChannel;
  motion?: SalesMotion | null;
  businessName?: string;
  workspace: WorkspaceObjectionSet;
  publishedPriceText?: string[];
}): ObjectionPreview {
  const channel = input.channel ?? "sms";
  const matches = matchObjection(input.message);
  const primary = matches[0] ?? null;
  const strategy = buildStrategyBlock({
    mode: "OBJECTION_HANDLING",
    motion: input.motion ?? null,
    archetypeKey: null,
    channel,
    selection: { question: null, stopReason: null, known: [] },
    latestMessage: input.message,
    hasApprovedInsight: input.workspace.assets.length > 0,
    bookingAvailable: true,
    workspaceObjections: input.workspace,
  });
  const libraryKeys = primary && !strategy.objection?.handoverRequired && !strategy.objection?.respectAsRefusal ? [primary.key] : [];
  const workspace = matchWorkspaceObjection(input.message, input.workspace, libraryKeys);
  const handsOver = strategy.objection?.handoverRequired === true;

  let draft: string;
  if (handsOver) {
    draft = "Good question. I'll get someone from the team to pick that up with you.";
  } else if (strategy.objection?.respectAsRefusal) {
    draft = "No problem at all, thanks for letting me know. I won't message you about this again.";
  } else if (workspace) {
    const ack = ACKNOWLEDGE[workspace.objection.libraryKey ?? ""] ?? "Makes sense.";
    const asset = workspace.assets[0]?.text;
    draft = `${ack} ${workspace.objection.response}${asset && !workspace.objection.response.includes(asset) ? ` ${asset}.` : ""} Would a quick call to talk it through help?`;
  } else if (primary) {
    const entry = OBJECTIONS[primary.key];
    const pattern = pickResponsePattern(primary.key, { seenBefore: false });
    const ack = ACKNOWLEDGE[primary.key] ?? "Makes sense.";
    // The library's clarifying question often carries its own acknowledgement ("Makes sense. ...").
    const clarify = entry.clarifyingQuestion;
    const ownAck = /^[A-Z][^.?!]{0,30}\.\s/.test(clarify);
    draft = pattern.clarify && clarify ? (ownAck ? clarify : `${ack} ${clarify}`) : `${ack} Would a quick call to talk it through help?`;
  } else {
    draft = "Thanks for being straight with me. What's the main thing holding you back?";
  }
  draft = fixHumanStyle(draft.replace(/\s+/g, " ").replace(/\.\./g, ".").trim(), { channel });

  const check = validateResponse(draft, {
    channel,
    businessName: input.businessName ?? "",
    publishedPriceText: input.publishedPriceText ?? [],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [],
    serviceAreaConfirmed: false,
  });

  return {
    libraryKey: primary?.key ?? null,
    libraryLabel: primary ? OBJECTIONS[primary.key].label : null,
    workspaceKey: workspace?.objection.key ?? null,
    source: workspace ? "WORKSPACE" : primary ? "LIBRARY" : "NONE",
    strategyText: strategy.text,
    exampleReply: draft,
    problems: check.ok ? [] : check.failures.map((f) => ({ code: f.code, detail: f.detail })),
    grade: gradeReply(draft, {
      channel,
      inbound: input.message,
      objection: Boolean(primary),
      approvedClaims: workspace ? [workspace.objection.response, ...workspace.assets.map((a) => a.text)] : [],
    }).total,
    handsOver,
  };
}
