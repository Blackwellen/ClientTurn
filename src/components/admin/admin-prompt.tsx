"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/form";

/**
 * In-app replacements for `window.prompt` / `window.confirm` in the admin.
 *
 * The native dialogs were used for every "why?" question (suspend a partner,
 * reverse a commission, cancel a payout, place a deletion hold...): unstyled,
 * a single-line box for an audit reason, no length limit, blocked entirely by
 * some browsers, and invisible to automated tests. These keep the same
 * one-line call shape — `const reason = await askReason("Why…?")` — so each
 * call site stays readable, and render through the shared Modal.
 *
 * One host (<AdminPromptHost />) is mounted in the admin shell.
 */

type Request =
  | {
      kind: "reason";
      message: string;
      title: string;
      label: string;
      resolve: (value: string | null) => void;
    }
  | { kind: "confirm"; message: string; resolve: (value: boolean) => void };

let current: Request | null = null;
const listeners = new Set<() => void>();

function publish(next: Request | null) {
  current = next;
  for (const listener of listeners) listener();
}

/** Resolves to the trimmed reason, or null when cancelled. */
export function askReason(
  message: string,
  options: { title?: string; label?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    // A second request while one is open cancels the first rather than
    // stacking dialogs.
    if (current?.kind === "reason") current.resolve(null);
    if (current?.kind === "confirm") current.resolve(false);
    publish({
      kind: "reason",
      message,
      title: options.title ?? "Give a reason",
      label: options.label ?? "Reason",
      resolve,
    });
  });
}

/** Resolves true only when the operator confirms. */
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (current?.kind === "reason") current.resolve(null);
    if (current?.kind === "confirm") current.resolve(false);
    publish({ kind: "confirm", message, resolve });
  });
}

const MAX_REASON = 500;

export function AdminPromptHost() {
  const request = React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
  const [text, setText] = React.useState("");
  const fieldId = React.useId();

  function close(value: string | null | boolean) {
    const active = current;
    publish(null);
    setText("");
    if (!active) return;
    if (active.kind === "reason") active.resolve(typeof value === "string" ? value : null);
    else active.resolve(value === true);
  }

  if (!request) return null;

  if (request.kind === "confirm") {
    return (
      <Modal
        open
        onClose={() => close(false)}
        title="Please confirm"
        description={request.message}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button onClick={() => close(true)}>Confirm</Button>
          </>
        }
      />
    );
  }

  const trimmed = text.trim();
  return (
    <Modal
      open
      onClose={() => close(null)}
      title={request.title}
      description={request.message}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button disabled={trimmed.length < 5} onClick={() => close(trimmed)}>
            Continue
          </Button>
        </>
      }
    >
      <FormField
        label={request.label}
        htmlFor={fieldId}
        hint={`Recorded in the audit log. ${MAX_REASON - text.length} characters left.`}
        required
      >
        <Textarea
          id={fieldId}
          autoFocus
          rows={3}
          maxLength={MAX_REASON}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </FormField>
    </Modal>
  );
}
