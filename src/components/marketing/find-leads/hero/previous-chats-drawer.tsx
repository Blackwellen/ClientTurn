"use client";

import * as React from "react";
import { PREVIOUS_SEARCHES } from "../data";
import { Close, Search, ChevronRight } from "../pieces";
import { useBodyScrollLock, useEscape, useFocusTrap } from "@/components/ui/drawer";

/**
 * The search-history drawer behind the hero's "View all".
 *
 * It reuses the app's own drawer behaviour hooks — scroll lock, focus trap,
 * escape to close — rather than reimplementing them, so the marketing version
 * of this control is as keyboard-usable as the product one.
 */
export function PreviousChatsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => onClose(), [onClose]);

  useBodyScrollLock(open);
  useFocusTrap(panelRef, open);
  useEscape(open, close);

  if (!open) return null;

  return (
    <>
      <div aria-hidden className="fl-drawer-overlay" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fl-drawer-title"
        tabIndex={-1}
        className="fl-drawer"
      >
        <div className="fl-drawer-head">
          <div>
            <h2 id="fl-drawer-title">Previous searches</h2>
            <p>Every search session stays available to reopen and edit.</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="fl-icon-btn"
            aria-label="Close previous searches"
          >
            <Close size={15} />
          </button>
        </div>

        <div className="fl-drawer-body">
          <ul className="fl-recent-list">
            {PREVIOUS_SEARCHES.map((item) => (
              <li key={item.title}>
                <span className="fl-recent-row">
                  <Search size={14} />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </div>
                  <span className="fl-recent-age">{item.age}</span>
                  <ChevronRight size={13} className="shrink-0 text-[#5b6679]" />
                </span>
              </li>
            ))}
          </ul>
          <p className="fl-note-line">
            An illustration of the search history in the product. Nothing here
            is a real search, and no result counts are claimed.
          </p>
        </div>
      </div>
    </>
  );
}
