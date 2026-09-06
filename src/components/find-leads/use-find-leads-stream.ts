"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Live updates for the Find Leads surfaces (V4 §12.9).
 *
 * The shape of this is deliberate. It subscribes to `workspace_stream_events` —
 * a table that carries a workspace id, an entity type, an entity id and a verb,
 * and nothing else — and reacts by asking the server to re-render. It never
 * reads the changed record from the socket.
 *
 * That indirection is the security property, not an inefficiency. Realtime
 * delivers whole rows and enforces RLS, but it does not apply the column-level
 * SELECT grants that withhold `prospects.unsubscribe_token` from the browser.
 * Subscribing to `prospects` directly would hand that capability to every open
 * tab in the workspace. Re-reading through `router.refresh()` goes back through
 * the RSC path, where the grants still apply, so the client only ever sees
 * columns it is allowed to see.
 *
 * Everything else here is about not being annoying:
 *
 *   * events are coalesced on a trailing timer, because a sourcing run inserts
 *     prospects in bursts and one refresh per row would make the table unusable;
 *   * a refresh is skipped while the tab is hidden and run once on return, so a
 *     background tab is not re-rendering all day;
 *   * `router.refresh()` preserves scroll position and client state, so a row
 *     landing does not throw away an open drawer or a half-typed filter.
 */

/** Trailing window. Long enough to absorb a burst, short enough to feel live. */
const COALESCE_MS = 1200;

export type StreamEntity = "PROSPECT" | "INTENT_EVENT" | "CAMPAIGN" | "SOURCING_RUN";

export function useFindLeadsStream({
  businessId,
  entities,
  enabled = true,
  onEvent,
}: {
  businessId: string;
  /** Which entity types should trigger a refresh on this view. */
  entities: StreamEntity[];
  enabled?: boolean;
  /** Called for each event, before coalescing — for a "new prospects" pill. */
  onEvent?: (event: { entityType: StreamEntity; kind: string }) => void;
}) {
  const router = useRouter();

  // Kept in a ref so changing the callback or the entity list does not tear
  // down and re-establish the socket subscription.
  const entitiesRef = React.useRef(entities);

  const onEventRef = React.useRef(onEvent);
  React.useEffect(() => {
    entitiesRef.current = entities;
    onEventRef.current = onEvent;
  }, [entities, onEvent]);

  const [pendingCount, setPendingCount] = React.useState(0);

  React.useEffect(() => {
    if (!enabled || !businessId) return;

    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let queued = false;
    let cancelled = false;

    const flush = () => {
      timer = null;
      if (cancelled) return;

      // A hidden tab defers rather than refreshes. The queued flag survives, so
      // the update lands the moment someone comes back to it.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        queued = true;
        return;
      }

      queued = false;
      setPendingCount(0);
      router.refresh();
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, COALESCE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && queued) flush();
    };

    const channel = supabase
      .channel(`find-leads:${businessId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "workspace_stream_events",
          // Server-side filter. RLS would reject another workspace's rows
          // anyway; this keeps them off the wire in the first place.
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          const row = payload.new as { entity_type?: string; kind?: string } | null;
          const entityType = row?.entity_type as StreamEntity | undefined;
          if (!entityType || !entitiesRef.current.includes(entityType)) return;

          onEventRef.current?.({ entityType, kind: row?.kind ?? "changed" });
          setPendingCount((count) => count + 1);
          schedule();
        },
      )
      .subscribe();

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [businessId, enabled, router]);

  return { pendingCount };
}
