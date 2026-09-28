"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { Skeleton, FormError } from "@/components/ui/feedback";
import { getQuestionMapping, saveQuestionMapping } from "@/lib/qualification/actions";
import { dimensionLabel } from "@/lib/qualification-intelligence/explain";
import { QI_DIMENSION_KEYS, type QiDimensionKey } from "@/lib/qualification-intelligence/types";

/**
 * Maps one published question to the qualification detail it answers
 * (`dimension_key`) and, optionally, the library question intent it is
 * (`question_intent_key`). Saved straight away, not through the draft: the
 * mapping changes nothing the rules decide, only how the answer counts toward
 * the lead's picture of what is known.
 */
export function QuestionMappingDialog({
  open,
  onClose,
  questionId,
  questionText,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  questionId: string;
  questionText: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [dimension, setDimension] = React.useState("");
  const [intentKey, setIntentKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [options, setOptions] = React.useState<{ key: string; dimension: string; label: string }[]>([]);
  // Only the library questions about the chosen detail (all of them when none is chosen).
  const choices = options.filter((o) => !dimension || o.dimension === dimension);

  React.useEffect(() => {
    // Mounted fresh each time it opens (the row renders it only while open),
    // so it starts in "loading" and only the async result sets state here.
    if (!open) return;
    let live = true;
    getQuestionMapping({ questionId }).then(
      (result) => {
        if (!live) return;
        if (result.ok) {
          setDimension(result.mapping.dimensionKey ?? "");
          setIntentKey(result.mapping.questionIntentKey ?? "");
          setOptions(result.intentOptions);
          setState("ready");
        } else {
          setLoadError(result.error);
          setState("error");
        }
      },
      () => {
        if (!live) return;
        setLoadError("The mapping could not be read.");
        setState("error");
      },
    );
    return () => {
      live = false;
    };
  }, [open, questionId]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await saveQuestionMapping({
        questionId,
        dimensionKey: (dimension || null) as QiDimensionKey | null,
        questionIntentKey: intentKey || null,
      });
      if (result.ok) {
        toast({ variant: "success", title: "Mapping saved. Leads pick it up on their next assessment." });
        router.refresh();
        onClose();
      } else {
        setError(result.error);
      }
    } catch {
      setError("That could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Which detail does this question answer?"
      description={questionText || "This question"}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={saving}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button size="sm" loading={saving} disabled={state !== "ready"} onClick={submit}>
              Save mapping
            </Button>
          )}
        </>
      }
    >
      {state === "loading" ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the mapping">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : state === "error" ? (
        <p role="alert" className="text-[13px] text-danger-700">
          {loadError}
        </p>
      ) : (
        <div className="space-y-3">
          <FormField
            label="Qualification detail"
            htmlFor="mapping-dimension"
            hint="The answer counts toward this detail on the lead page, in completeness and in the next best action. Your rules still decide qualified or not."
          >
            <Select
              id="mapping-dimension"
              value={dimension}
              disabled={!canEdit}
              onChange={(event) => {
                setDimension(event.target.value);
                // A library question about another detail no longer fits.
                if (intentKey && !options.some((o) => o.key === intentKey && o.dimension === event.target.value)) setIntentKey("");
              }}
            >
              <option value="">Not mapped (a custom question)</option>
              {QI_DIMENSION_KEYS.map((key) => (
                <option key={key} value={key}>
                  {dimensionLabel(key)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Same as a library question (optional)"
            htmlFor="mapping-intent"
            hint="When your question asks the same thing as one in the library. Your wording is always kept."
          >
            <Select
              id="mapping-intent"
              value={intentKey}
              disabled={!canEdit || choices.length === 0}
              onChange={(event) => setIntentKey(event.target.value)}
            >
              <option value="">None</option>
              {choices.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label} ({o.key})
                </option>
              ))}
            </Select>
          </FormField>
          <FormError message={error} />
        </div>
      )}
    </Modal>
  );
}
