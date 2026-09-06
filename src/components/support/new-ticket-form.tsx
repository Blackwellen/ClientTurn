"use client";

import * as React from "react";
import { Lock, Paperclip, Send, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Switch, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  createAttachmentUploadUrl,
  createSupportTicket,
} from "@/lib/support/actions";
import {
  ATTACHMENT_HINT,
  MAX_DESCRIPTION_LENGTH,
  MAX_SUBJECT_LENGTH,
  TICKET_CATEGORIES,
  attachmentError,
  collectContext,
  type TicketCategory,
} from "@/lib/support/types";
import { BackLink } from "./help-view";

/**
 * Raising a ticket (V4 §23.6-§23.9).
 *
 * Two things here are deliberate and worth stating.
 *
 * **Context is opt-in and visible.** The toggle defaults on because it is what
 * makes a ticket answerable first time, but it is never hidden, the customer
 * can switch it off, and the panel beneath says plainly what is and is not
 * included. Nothing is collected that is not on the allow-list, and the server
 * re-validates against that same list rather than trusting the payload.
 *
 * **Files go straight to storage.** The browser asks for a short-lived signed
 * URL and uploads directly, so a large screenshot never travels through a
 * server action, and the object key is namespaced to this workspace.
 */
export function NewTicketForm({
  pathname,
  onBack,
  onCreated,
}: {
  pathname: string;
  onBack: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [category, setCategory] = React.useState<TicketCategory>("LEAD_MESSAGE");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [includeContext, setIncludeContext] = React.useState(true);
  const [files, setFiles] = React.useState<{ name: string; key: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const canSubmit =
    subject.trim().length >= 4 && description.trim().length >= 10 && !pending;

  async function upload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];

    const invalid = attachmentError(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (files.length >= 3) {
      setError("You can attach up to three files.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const prepared = await createAttachmentUploadUrl({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });

      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }

      const response = await fetch(prepared.data.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });

      if (!response.ok) {
        setError("That file could not be uploaded. Please try again.");
        return;
      }

      setFiles((current) => [...current, { name: file.name, key: prepared.data.key }]);
    } catch {
      setError("That file could not be uploaded. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await createSupportTicket({
        category,
        subject,
        description,
        includeContext,
        // Collected here, in the browser, only when the toggle is on.
        context: includeContext ? collectContext(pathname) : undefined,
        attachmentKeys: files.map((file) => file.key),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast({
        variant: "success",
        title: `Ticket ${result.data.reference} created`,
        description: "We'll reply here and by email.",
      });
      onCreated();
    } catch {
      setError("Your message could not be sent. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4 p-5">
      <BackLink label="Back" onClick={onBack} />

      <div>
        <h2 className="text-[24px] font-bold leading-tight text-content">
          New support ticket
        </h2>
        <p className="mt-1 text-[13.5px] text-content-muted">
          Send us a message and we&rsquo;ll get back to you as soon as possible.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ticket-category" required>
          Category
        </Label>
        <Select
          id="ticket-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as TicketCategory)}
        >
          {TICKET_CATEGORIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ticket-subject" required>
          Subject
        </Label>
        <Input
          id="ticket-subject"
          value={subject}
          maxLength={MAX_SUBJECT_LENGTH}
          placeholder="Short summary of your issue..."
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ticket-description" required>
          Description
        </Label>
        <Textarea
          id="ticket-description"
          rows={5}
          value={description}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder="Tell us more about the issue, what you were trying to do, and any error messages you saw..."
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      {/* ------------------------------------------------------ attachments */}
      <div className="space-y-1.5">
        <Label htmlFor="ticket-attachment">
          Attachment{" "}
          <span className="font-normal text-content-muted">(optional)</span>
        </Label>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(event.dataTransfer.files);
          }}
          className={cn(
            "rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            dragging
              ? "border-accent-500 bg-accent-50/40"
              : "border-line-strong bg-surface",
          )}
        >
          <Upload
            aria-hidden
            className="mx-auto size-5 text-content-muted"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || files.length >= 3}
            className={cn(
              "mt-2 block w-full text-[13px] font-medium text-content",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {uploading
              ? "Uploading…"
              : "Drag and drop a file here, or click to upload"}
          </button>
          <p className="mt-1 text-[11.5px] text-content-muted">{ATTACHMENT_HINT}</p>
          <input
            ref={inputRef}
            id="ticket-attachment"
            type="file"
            className="sr-only"
            accept=".png,.jpg,.jpeg,.pdf,.txt,.csv,.log"
            onChange={(event) => void upload(event.target.files)}
          />
        </div>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((file) => (
              <li
                key={file.key}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken/50 px-2.5 py-1.5"
              >
                <Paperclip
                  aria-hidden
                  className="size-3.5 shrink-0 text-content-muted"
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-content">
                  {file.name}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((row) => row.key !== file.key),
                    )
                  }
                  className="shrink-0 rounded p-0.5 text-content-subtle hover:text-danger-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------------------------------------------------------- context */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-content">
              Include context{" "}
              <span className="font-normal text-content-muted">(recommended)</span>
            </p>
            <p className="mt-0.5 text-[12.5px] leading-[1.45] text-content-muted">
              Allow ClientTurn to attach your current page, workspace and safe
              diagnostics to help us resolve this faster.
            </p>
          </div>
          <Switch
            checked={includeContext}
            onCheckedChange={setIncludeContext}
            tone="success"
            size="lg"
            label="Include diagnostic context with this ticket"
          />
        </div>

        {includeContext && (
          <div className="mt-2.5 flex gap-2.5 rounded-lg border border-success-100 bg-success-50/70 px-3 py-2.5">
            <Lock
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-success-700"
            />
            <p className="text-[12.5px] leading-[1.45] text-content-secondary">
              We only include information that is{" "}
              <strong className="font-semibold">safe and relevant</strong> to
              your support request — the page you were on, your browser, and
              your workspace reference. No message content, passwords or
              provider credentials are shared.
            </p>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-danger-600">
          {error}
        </p>
      )}

      <Button
        fullWidth
        size="lg"
        loading={pending}
        disabled={!canSubmit}
        onClick={submit}
      >
        <Send className="size-4" aria-hidden />
        Send ticket
      </Button>

      <p className="text-center text-[11.5px] text-content-muted">
        Tickets are answered by a person, usually within one working day.
      </p>
    </div>
  );
}
