"use client";

import * as React from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { sanitizeEmailHtml } from "@/lib/email/rich-text";

/**
 * The email body editor: bold, italic, underline, both list kinds and a link,
 * plus the merge-field menu the texting composer also has.
 *
 * Everything the editor emits goes through `sanitizeEmailHtml` before it
 * reaches state, so the value held by the wizard is already reduced to the
 * allowlist. The server sanitises again on write — this pass is for what the
 * author sees, not for safety.
 */

type Command = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** `document.execCommand` name; `createLink` is handled separately. */
  command: string;
};

const COMMANDS: Command[] = [
  { id: "bold", label: "Bold", icon: Bold, command: "bold" },
  { id: "italic", label: "Italic", icon: Italic, command: "italic" },
  { id: "underline", label: "Underline", icon: Underline, command: "underline" },
  {
    id: "ul",
    label: "Bulleted list",
    icon: List,
    command: "insertUnorderedList",
  },
  {
    id: "ol",
    label: "Numbered list",
    icon: ListOrdered,
    command: "insertOrderedList",
  },
];

export function RichTextEditor({
  id,
  value,
  onChange,
  error,
  minHeight = 200,
  toolbarExtra,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  minHeight?: number;
  /** The "Insert variable" control, rendered at the right of the toolbar. */
  toolbarExtra?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  // The editable node owns the caret, so it is only written to when the value
  // genuinely differs from what it already shows. Assigning innerHTML on every
  // keystroke would move the caret to the start on each character.
  React.useEffect(() => {
    const node = ref.current;
    if (node && node.innerHTML !== value) node.innerHTML = value;
  }, [value]);

  function emit() {
    const node = ref.current;
    if (node) onChange(sanitizeEmailHtml(node.innerHTML));
  }

  function run(command: string) {
    ref.current?.focus();
    document.execCommand(command);
    emit();
  }

  function addLink() {
    const node = ref.current;
    if (!node) return;
    node.focus();

    const url = window.prompt("Link address", "https://");
    if (!url) return;
    // The sanitiser refuses anything but http/https/mailto/tel, so an unsafe
    // scheme typed here is dropped rather than stored.
    document.execCommand("createLink", false, url);
    emit();
  }

  return (
    <div>
      <div
        className={cn(
          "border-line-strong overflow-hidden rounded-md border shadow-xs",
          error && "border-danger-500",
        )}
      >
        <div className="border-line-subtle bg-surface-sunken/60 flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            {COMMANDS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                title={entry.label}
                aria-label={entry.label}
                // The editor loses focus on mousedown otherwise, and
                // execCommand would have no selection to act on.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(entry.command)}
                className="text-content-secondary hover:bg-surface hover:text-content flex size-7 items-center justify-center rounded transition-colors"
              >
                <entry.icon className="size-3.5" aria-hidden />
              </button>
            ))}
            <span className="bg-line mx-1 h-4 w-px" aria-hidden />
            <button
              type="button"
              title="Insert link"
              aria-label="Insert link"
              onMouseDown={(event) => event.preventDefault()}
              onClick={addLink}
              className="text-content-secondary hover:bg-surface hover:text-content flex size-7 items-center justify-center rounded transition-colors"
            >
              <Link2 className="size-3.5" aria-hidden />
            </button>
          </div>

          {toolbarExtra}
        </div>

        <div
          ref={ref}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          // A paste carries the source document's markup; taking the plain
          // text keeps the body inside the allowlist and out of the sanitiser.
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
            emit();
          }}
          style={{ minHeight }}
          className="lr-rich-text text-content w-full px-3 py-2.5 text-[13px] leading-relaxed focus:outline-none"
        />
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="text-danger-600 mt-1 text-[12px]">
          {error}
        </p>
      )}
    </div>
  );
}
