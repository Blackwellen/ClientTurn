"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, Check, Pencil, Send, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/dates";
import { HANDOVER_COPY } from "@/lib/leads/resume-rule";
import {
  acknowledgeHandoff,
  cancelHandoff,
  discardDraft,
  resolveHandoff,
  returnConversationToAi,
  sendDraft,
  takeOverConversation,
  updateDraft,
} from "@/lib/agent/actions";
import {
  HANDOFF_PRIORITY_LABEL,
  OWNER_LABEL,
  OWNER_TONE,
  type AgentActionResult,
  type ConversationAgentState,
  type HandoffLeadBriefView,
} from "@/lib/agent/views";

/**
 * The assistant strip above a conversation.
 *
 * Shows only outcomes and the actions a person can take on them: who owns the
 * conversation, an open handover with the factual summary the runtime wrote,
 * and any suggested reply waiting for approval. There is deliberately no view
 * of prompts, tool calls, confidence or model detail -- those are operational
 * internals and have no field in `ConversationAgentState` to travel in.
 *
 * Every mutation is a server action that re-checks permission and workspace
 * scope; nothing here is trusted because the button was rendered.
 */
export function AgentPanel({
  state,
  canManage,
}: {
  state: ConversationAgentState;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);

  async function run(key: string, action: () => Promise<AgentActionResult>) {
    setPending(key);
    const result = await action();
    setPending(null);

    if (result.ok) {
      router.refresh();
    } else {
      toast({ variant: "error", title: result.error });
    }
  }

  const busy = (key: string) => pending === key;
  const anyBusy = pending !== null;

  // Nothing to say: the assistant is off here, has never run, and there is no
  // handover or draft outstanding. Rendering an empty panel would be noise.
  if (
    !state.agentEnabledHere &&
    !state.openHandoff &&
    state.pendingDrafts.length === 0 &&
    state.recentRuns.length === 0
  ) {
    return null;
  }

  return (
    <section className="border-b border-line bg-surface-sunken/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-md border border-line bg-surface text-content-muted"
        >
          <Bot className="size-3.5" />
        </span>
        <Badge tone={OWNER_TONE[state.owner] as never}>{OWNER_LABEL[state.owner]}</Badge>

        {!state.agentEnabledHere && state.owner === "AI_ACTIVE" && (
          <span className="text-[11.5px] text-content-muted">
            The assistant is off for this channel.{" "}
            <Link
              href="/app/settings?section=workspace"
              className="text-content-accent underline-offset-4 hover:underline"
            >
              Settings
            </Link>
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canManage && state.owner === "AI_ACTIVE" && (
            <PanelButton
              icon={UserRound}
              label={HANDOVER_COPY.takeOver}
              help={HANDOVER_COPY.takeOverHelp}
              disabled={anyBusy}
              busy={busy("takeover")}
              onClick={() =>
                run("takeover", () =>
                  takeOverConversation({ conversationId: state.conversationId }),
                )
              }
            />
          )}
          {canManage && (state.owner === "HUMAN_ACTIVE" || state.owner === "HANDED_OVER") && (
            <PanelButton
              icon={Bot}
              label={HANDOVER_COPY.handBack}
              help={HANDOVER_COPY.handBackHelp}
              disabled={anyBusy}
              busy={busy("return")}
              onClick={() =>
                run("return", () =>
                  returnConversationToAi({ conversationId: state.conversationId }),
                )
              }
            />
          )}
        </div>
      </div>

      {state.openHandoff && (
        <HandoverCard
          handoff={state.openHandoff}
          canManage={canManage}
          anyBusy={anyBusy}
          busy={busy}
          run={run}
        />
      )}

      {state.pendingDrafts.map((draft) => (
        <DraftCard
          key={draft.id}
          draft={draft}
          canManage={canManage}
          anyBusy={anyBusy}
          busy={busy}
          run={run}
        />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------- handover */

function HandoverCard({
  handoff,
  canManage,
  anyBusy,
  busy,
  run,
}: {
  handoff: NonNullable<ConversationAgentState["openHandoff"]>;
  canManage: boolean;
  anyBusy: boolean;
  busy: (key: string) => boolean;
  run: (key: string, action: () => Promise<AgentActionResult>) => Promise<void>;
}) {
  const [note, setNote] = React.useState("");
  const [showNote, setShowNote] = React.useState(false);

  return (
    <div className="mt-3 rounded-lg border border-warning-300 bg-warning-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-content">{handoff.reasonLabel}</span>
        {handoff.kind === "ASSIST_REQUEST" && (
          <Badge tone="accent">Assistant still replying</Badge>
        )}
        <Badge tone={handoff.priority === "URGENT" ? "danger" : "warning"}>
          {HANDOFF_PRIORITY_LABEL[handoff.priority]}
        </Badge>
        <span className="text-[11.5px] text-content-muted">
          {formatRelative(handoff.createdAt)}
          {handoff.assigneeName ? ` · ${handoff.assigneeName}` : ""}
        </span>
      </div>

      {handoff.summary.quickBrief ? (
        <div className="mt-2 rounded-md border border-line bg-surface p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">
            30-second brief
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-content">
            {handoff.summary.quickBrief.text}
          </p>
        </div>
      ) : (
        handoff.summary.summary && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-content-muted">
            {handoff.summary.summary}
          </p>
        )
      )}

      {handoff.summary.leadBrief && <LeadBriefDetails brief={handoff.summary.leadBrief} />}

      {handoff.summary.keyAnswers.length > 0 && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {handoff.summary.keyAnswers.map((answer) => (
            <div key={answer.question} className="text-[11.5px]">
              <dt className="inline text-content-muted">{answer.question}: </dt>
              <dd className="inline font-medium text-content">{answer.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {canManage && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {handoff.status === "OPEN" && (
            <PanelButton
              icon={Check}
              label="I'll handle this"
              disabled={anyBusy}
              busy={busy("ack")}
              onClick={() => run("ack", () => acknowledgeHandoff({ handoffId: handoff.id }))}
            />
          )}
          <PanelButton
            icon={Check}
            label="Resolve"
            disabled={anyBusy}
            busy={busy("resolve")}
            onClick={() => setShowNote((open) => !open)}
          />
          <PanelButton
            icon={X}
            label="Not needed"
            disabled={anyBusy}
            busy={busy("cancel")}
            onClick={() => run("cancel", () => cancelHandoff({ handoffId: handoff.id }))}
          />
        </div>
      )}

      {showNote && canManage && (
        <div className="mt-2 space-y-2">
          <textarea
            rows={2}
            maxLength={500}
            value={note}
            placeholder="What was done? (optional)"
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px]"
          />
          <div className="flex flex-wrap gap-2">
            <PanelButton
              icon={Check}
              label="Resolve and keep it with me"
              disabled={anyBusy}
              busy={busy("resolve-keep")}
              onClick={() =>
                run("resolve-keep", () =>
                  resolveHandoff({ handoffId: handoff.id, note, returnToAi: false }),
                )
              }
            />
            <PanelButton
              icon={Bot}
              label="Resolve and hand back"
              disabled={anyBusy}
              busy={busy("resolve-return")}
              onClick={() =>
                run("resolve-return", () =>
                  resolveHandoff({ handoffId: handoff.id, note, returnToAi: true }),
                )
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The deterministic Lead Brief (Phase 3.4), collapsed by default so the card
 * stays scannable. Every line is a stored fact; evidence lines are the lead's
 * own words.
 */
function LeadBriefDetails({ brief }: { brief: HandoffLeadBriefView }) {
  const label = (text: string) => text.toLowerCase().replace(/_/g, " ");
  return (
    <details className="mt-2 text-[11.5px]">
      <summary className="cursor-pointer font-medium text-content">Lead brief</summary>
      <div className="mt-1.5 space-y-1.5 text-content-muted">
        {brief.score && (
          <p>
            <span className="font-medium text-content">Score {brief.score.total}</span> (grade{" "}
            {brief.score.grade}). {brief.score.why}
          </p>
        )}
        {brief.tags.length > 0 && <p>Tags: {brief.tags.map(label).join(", ")}</p>}
        {brief.answers.length > 0 && (
          <ul className="space-y-0.5">
            {brief.answers.map((answer) => (
              <li key={answer.question}>
                <span className="text-content">{answer.question}:</span> {answer.value}
                {!answer.known && <span className="italic"> (inferred)</span>}
                {answer.evidence && <span className="block pl-2 italic">“{answer.evidence}”</span>}
              </li>
            ))}
          </ul>
        )}
        {brief.objections.length > 0 && (
          <p>
            Raised: {brief.objections.map((objection) => label(objection.key)).join(", ")}
          </p>
        )}
        {brief.promises.length > 0 && <p>Promised: {brief.promises.join(" · ")}</p>}
        {brief.unanswered.length > 0 && <p>Still unknown: {brief.unanswered.join("; ")}</p>}
        {brief.meeting && (
          <p>
            Meeting: {brief.meeting.status}
            {brief.meeting.startsAt ? `, ${formatRelative(brief.meeting.startsAt)}` : ""}
          </p>
        )}
        {brief.nextStep && <p className="text-content">Next step: {brief.nextStep}</p>}
        {brief.approach && <p>Approach: {brief.approach.reason}</p>}
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------- draft */

function DraftCard({
  draft,
  canManage,
  anyBusy,
  busy,
  run,
}: {
  draft: ConversationAgentState["pendingDrafts"][number];
  canManage: boolean;
  anyBusy: boolean;
  busy: (key: string) => boolean;
  run: (key: string, action: () => Promise<AgentActionResult>) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(draft.body);

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Suggested reply</Badge>
        <span className="text-[11.5px] text-content-muted">
          {formatRelative(draft.createdAt)} · {draft.channel.toUpperCase()}
        </span>
      </div>

      {editing ? (
        <textarea
          rows={3}
          maxLength={1200}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="mt-2 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px]"
        />
      ) : (
        <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-content">
          {body}
        </p>
      )}

      {canManage && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <PanelButton
                icon={Check}
                label="Save"
                disabled={anyBusy || body.trim().length === 0}
                busy={busy("save")}
                onClick={async () => {
                  await run("save", () => updateDraft({ draftId: draft.id, body }));
                  setEditing(false);
                }}
              />
              <PanelButton
                icon={X}
                label="Cancel"
                disabled={anyBusy}
                busy={false}
                onClick={() => {
                  setBody(draft.body);
                  setEditing(false);
                }}
              />
            </>
          ) : (
            <>
              <PanelButton
                icon={Send}
                label="Send"
                disabled={anyBusy}
                busy={busy("send")}
                onClick={() => run("send", () => sendDraft({ draftId: draft.id }))}
              />
              <PanelButton
                icon={Pencil}
                label="Edit"
                disabled={anyBusy}
                busy={false}
                onClick={() => setEditing(true)}
              />
              <PanelButton
                icon={X}
                label="Discard"
                disabled={anyBusy}
                busy={busy("discard")}
                onClick={() => run("discard", () => discardDraft({ draftId: draft.id }))}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- button */

function PanelButton({
  icon: Icon,
  label,
  help,
  disabled,
  busy,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** What the button does, as its tooltip. */
  help?: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={help}
      className="border-line-strong bg-surface text-content hover:bg-surface-hover focus-visible:outline-content-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon className="size-3.5" />
      {busy ? "Working…" : label}
    </button>
  );
}
