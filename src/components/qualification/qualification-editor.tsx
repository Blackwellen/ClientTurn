"use client";

import * as React from "react";
import { CircleCheck, HelpCircle, ListChecks, Plus, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { QuestionRow } from "@/components/qualification/question-row";
import {
  QuestionTypesDialog,
  RoutingDialog,
} from "@/components/qualification/routing-dialog";
import { LeadPreview } from "@/components/qualification/lead-preview";
import { ServiceScopeCard } from "@/components/qualification/service-scope-card";
import { publishQualification } from "@/lib/qualification/publish";
import {
  MAX_QUALIFICATION_QUESTIONS,
  blankQuestion,
  newDraftKey,
  toPublishPayload,
  validateDraft,
  type DraftQuestion,
  type QualificationMeta,
} from "@/lib/qualification/draft";
import type {
  ServiceAreaSettings,
  ServiceRef,
} from "@/lib/qualification/types";
import { cn } from "@/lib/cn";

/**
 * The Qualification editor.
 *
 * Draft-then-publish, deliberately: everything typed here lives in local state
 * until "Publish qualification" succeeds, which is what makes "Discard
 * changes" honest and stops a half-finished edit from reaching live intake.
 * The preview beside it evaluates that same draft with the real engine.
 */
export function QualificationEditor({
  initialQuestions,
  services,
  serviceArea,
  meta,
  canEdit,
}: {
  initialQuestions: DraftQuestion[];
  services: ServiceRef[];
  serviceArea: ServiceAreaSettings;
  meta: QualificationMeta;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [questions, setQuestions] = React.useState(initialQuestions);
  const [publishing, setPublishing] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState<DraftQuestion | null>(
    null,
  );
  const [routingFor, setRoutingFor] = React.useState<string | null>(null);
  const [typesOpen, setTypesOpen] = React.useState(false);
  const [previewService, setPreviewService] = React.useState<string | null>(
    services[0]?.id ?? null,
  );
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({});
  const focusNext = React.useRef<string | null>(null);

  const baseline = React.useMemo(
    () => JSON.stringify(initialQuestions),
    [initialQuestions],
  );
  const dirty = JSON.stringify(questions) !== baseline;

  // Re-seed when the server sends a newer configuration (after a publish, or
  // when someone else's change is revalidated in).
  const [seeded, setSeeded] = React.useState(baseline);
  if (seeded !== baseline) {
    setSeeded(baseline);
    setQuestions(initialQuestions);
  }

  React.useEffect(() => {
    if (!focusNext.current) return;
    inputs.current[focusNext.current]?.focus();
    focusNext.current = null;
  });

  // Leaving with unsaved work loses it, so the browser asks first. Clean
  // state never prompts.
  React.useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const issues = validateDraft(questions, services);
  const issueKeys = new Set(issues.map((issue) => issue.key.split("-")[0]));

  function patch(key: string, next: Partial<DraftQuestion>) {
    setQuestions((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...next } : row)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    setQuestions((rows) => {
      const target = index + direction;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function add() {
    if (questions.length >= MAX_QUALIFICATION_QUESTIONS) {
      toast({
        variant: "error",
        title: `Qualification is limited to ${MAX_QUALIFICATION_QUESTIONS} questions.`,
      });
      return;
    }
    const question = blankQuestion();
    focusNext.current = question.key;
    setQuestions((rows) => [...rows, question]);
  }

  function duplicate(index: number) {
    const source = questions[index];
    const key = newDraftKey();
    focusNext.current = key;
    setQuestions((rows) => [
      ...rows.slice(0, index + 1),
      {
        ...source,
        key,
        // A copy is a new row: it must not claim the original's identity, or
        // publishing would overwrite the original instead of adding one.
        id: null,
        options: source.options.map((option) => ({
          ...option,
          key: newDraftKey("o"),
        })),
        rules: source.rules.map((rule) => ({
          ...rule,
          key: newDraftKey("r"),
          id: null,
        })),
      },
      ...rows.slice(index + 1),
    ]);
  }

  async function publish() {
    setPublishing(true);
    try {
      const result = await publishQualification(
        toPublishPayload(questions, meta.savedAt),
      );
      if (result.ok) {
        toast({ variant: "success", title: "Qualification published" });
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setPublishing(false);
    }
  }

  function discard() {
    setQuestions(initialQuestions);
    setConfirmDiscard(false);
    toast({ variant: "success", title: "Changes discarded" });
  }

  const routingQuestion =
    questions.find((question) => question.key === routingFor) ?? null;
  const routingIndex = questions.findIndex(
    (question) => question.key === routingFor,
  );

  const savedLabel = meta.savedAt
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(meta.savedAt))
    : "Never published";

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-start">
              <SectionHeader
                icon={ListChecks}
                tone="info"
                title="Qualification questions"
                description="Create the questions you want to ask new enquiries. Keep it simple — we'll handle the logic."
              />
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => setTypesOpen(true)}
              >
                <HelpCircle className="size-3.5" />
                View question types
              </Button>
            </CardHeader>

            <CardContent className="space-y-2.5 pt-4">
              {questions.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title="No qualification questions yet"
                  description="Ask a couple of simple questions and every new enquiry is routed for you. Nothing is asked of a lead until you publish."
                  action={
                    canEdit ? (
                      <Button size="sm" onClick={add}>
                        <Plus className="size-3.5" />
                        Create your first qualification question
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ol className="space-y-2.5">
                  {questions.map((question, index) => (
                    <QuestionRow
                      key={question.key}
                      question={question}
                      index={index}
                      total={questions.length}
                      services={services}
                      canEdit={canEdit}
                      invalid={issueKeys.has(question.key.split("-")[0])}
                      registerInput={(element) => {
                        inputs.current[question.key] = element;
                      }}
                      onPatch={(next) => patch(question.key, next)}
                      onMove={(direction) => move(index, direction)}
                      onDuplicate={() => duplicate(index)}
                      onRemove={() => setConfirmRemove(question)}
                      onConfigureRouting={() => setRoutingFor(question.key)}
                    />
                  ))}
                </ol>
              )}

              {canEdit && questions.length > 0 && (
                <button
                  type="button"
                  onClick={add}
                  className={cn(
                    "border-line-strong text-content-secondary hover:bg-surface-hover hover:text-content",
                    "flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-[13px] font-medium",
                    "transition-colors duration-[var(--lr-duration-fast)]",
                    "focus-visible:outline-content-accent focus-visible:outline-2 focus-visible:outline-offset-2",
                  )}
                >
                  <Plus className="size-4" aria-hidden />
                  Add another question
                </button>
              )}

              {questions.length > 0 && (
                <EditorFooter issues={issues} count={questions.length} />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <LeadPreview
            questions={questions}
            services={services}
            serviceArea={serviceArea}
            serviceId={previewService}
            onServiceChange={setPreviewService}
          />
          <ServiceScopeCard questions={questions} services={services} />
        </div>
      </div>

      {canEdit && (
        <div
          className={cn(
            "border-line bg-surface/95 sticky bottom-0 z-20 -mx-4 mt-4 border-t px-4 py-3 backdrop-blur",
            "sm:-mx-6 sm:px-6",
          )}
        >
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <div className="mr-auto min-w-0">
              <p className="text-content-subtle text-[12px]">Last saved</p>
              <p className="text-content-muted lr-tabular text-[12px]">
                {savedLabel}
                {meta.savedByInitials ? ` by ${meta.savedByInitials}` : ""}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => setConfirmDiscard(true)}
              disabled={!dirty || publishing}
            >
              Discard changes
            </Button>
            <Button
              onClick={publish}
              loading={publishing}
              disabled={!dirty || issues.length > 0}
            >
              Publish qualification
            </Button>
          </div>
        </div>
      )}

      <RoutingDialog
        question={routingQuestion}
        index={routingIndex}
        open={routingFor !== null}
        onClose={() => setRoutingFor(null)}
        onSave={(next) => routingFor && patch(routingFor, next)}
      />

      <QuestionTypesDialog open={typesOpen} onClose={() => setTypesOpen(false)} />

      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={discard}
        variant="warning"
        title="Discard your changes?"
        scope="Everything edited since the last publish"
        consequence="Your unpublished edits are thrown away and the editor goes back to the version currently running. This cannot be undone."
        confirmLabel="Discard changes"
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          setQuestions((rows) =>
            rows.filter((row) => row.key !== confirmRemove?.key),
          );
          setConfirmRemove(null);
        }}
        variant="danger"
        title="Delete this question?"
        scope={confirmRemove?.questionText || "Untitled question"}
        consequence={
          confirmRemove?.id
            ? "It is removed when you publish. If leads have already answered it, publishing is refused and you will be asked to switch it off instead, so their answers stay readable."
            : "It is removed from your draft. Nothing has been published yet, so nothing else changes."
        }
        confirmLabel="Delete question"
      />
    </>
  );
}

function EditorFooter({
  issues,
  count,
}: {
  issues: { key: string; message: string }[];
  count: number;
}) {
  const valid = issues.length === 0;

  return (
    <div
      className={cn(
        "mt-1 flex items-start gap-3 rounded-lg border px-4 py-3.5",
        valid ? "border-success-100 bg-success-50" : "border-danger-100 bg-danger-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-white",
          valid ? "bg-success-500" : "bg-danger-500",
        )}
      >
        {valid ? (
          <CircleCheck className="size-4" />
        ) : (
          <TriangleAlert className="size-4" />
        )}
      </span>
      <div className="min-w-0">
        {valid ? (
          <>
            <p className="text-content text-[13px] font-semibold">
              Your qualification looks good!
            </p>
            <p className="text-content-secondary mt-0.5 text-[13px]">
              {count} {count === 1 ? "question" : "questions"} configured. Don&apos;t
              forget to publish your changes when you&apos;re ready.
            </p>
          </>
        ) : (
          <>
            <p className="text-danger-700 text-[13px] font-semibold">
              {issues.length === 1
                ? "One thing to fix before publishing"
                : `${issues.length} things to fix before publishing`}
            </p>
            <ul className="text-content-secondary mt-1 space-y-0.5 text-[13px]">
              {issues.slice(0, 5).map((issue) => (
                <li key={issue.key}>{issue.message}</li>
              ))}
              {issues.length > 5 && (
                <li className="text-content-subtle">
                  and {issues.length - 5} more.
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
