"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "./button";
import { Input } from "./form";
import { Overlay, useBodyScrollLock, useEscape, useFocusTrap } from "./drawer";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
} as const;

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof SIZES;
  children?: React.ReactNode;
  footer?: React.ReactNode;
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
}: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  useBodyScrollLock(open);
  useFocusTrap(panelRef, open);
  useEscape(open, onClose, panelRef);

  // Portalled to the body, one level above drawers (z-50). A confirm dialog is
  // usually opened FROM a drawer (every connection's "Disconnect"), and
  // rendered in place it sat under the portalled drawer: invisible and
  // unclickable (owner report, 2026-09-28). Same SSR guard as the Drawer.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <Overlay onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-surface shadow-xl outline-none",
          "rounded-t-xl sm:rounded-xl border border-line",
          "max-h-[90vh] flex flex-col",
          "animate-[lr-slide-up_var(--lr-duration-base)_var(--lr-ease)]",
          SIZES[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line-subtle">
          <div className="min-w-0">
            <h2
              id={`${id}-title`}
              className="text-[15px] font-semibold text-content"
            >
              {title}
            </h2>
            {description && (
              <p
                id={`${id}-desc`}
                className="mt-0.5 text-[13px] text-content-muted"
              >
                {description}
              </p>
            )}
          </div>
          <IconButton size="sm" label="Close dialog" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>

        {children && (
          <div className="flex-1 overflow-y-auto px-5 py-4 text-[13px] text-content-secondary">
            {children}
          </div>
        )}

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line-subtle bg-surface-sunken/40 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

type ConfirmVariant = "danger" | "warning" | "default";

const CONFIRM_ICON: Record<ConfirmVariant, string> = {
  danger: "bg-danger-50 border-danger-100 text-danger-600",
  warning: "bg-warning-50 border-warning-100 text-warning-600",
  default: "bg-accent-50 border-accent-200/60 text-content-accent",
};

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  /** What the action touches — scope of the change. */
  scope: string;
  /** What happens afterwards, including anything irreversible. */
  consequence: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
  /** Optional controls under the text (a channel choice, an extra option). */
  children?: React.ReactNode;
  /**
   * For irreversible actions: the word the person must type before the
   * confirm button works (compared case-insensitively, trimmed).
   */
  confirmationPhrase?: string;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  scope,
  consequence,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  children,
  confirmationPhrase,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const pending = loading || busy;
  const phraseId = React.useId();
  const phraseMatches =
    !confirmationPhrase ||
    typed.trim().toLowerCase() === confirmationPhrase.trim().toLowerCase();
  const Icon = variant === "default" ? Info : AlertTriangle;

  async function handleConfirm() {
    if (!phraseMatches) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={pending ? () => {} : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            size="sm"
            loading={pending}
            disabled={!phraseMatches}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            CONFIRM_ICON[variant],
          )}
        >
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className="text-[13px] text-content">{scope}</p>
          <p className="text-[13px] text-content-muted">{consequence}</p>
          {children && <div className="pt-1.5">{children}</div>}
          {confirmationPhrase && (
            <div className="space-y-1.5 pt-1.5">
              <label htmlFor={phraseId} className="block text-[13px] text-content">
                Type <span className="font-semibold">{confirmationPhrase}</span> to confirm
              </label>
              <Input
                id={phraseId}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
