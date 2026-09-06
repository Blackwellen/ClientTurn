import * as React from "react";
import type { Metadata } from "next";
import { z } from "zod";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  parseChannel,
  type ConversationRow,
  type ThreadMessage,
} from "@/lib/inbox/types";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata: Metadata = { title: "Inbox · ClientTurn" };
export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [workspace, params] = await Promise.all([requireWorkspace(), searchParams]);

  const channel = parseChannel(params.channel);
  const archived = params.archive === "1";
  const search = (params.q ?? "").slice(0, 100).trim();

  const supabase = await createClient();

  let query = supabase
    .from("conversations")
    .select(
      `id, channel, counterparty_name, counterparty_handle, lead_id, unread_count,
       last_message_at, is_archived,
       leads ( first_name, last_name, email )`,
    )
    .eq("business_id", workspace.businessId)
    .eq("is_archived", archived)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (channel !== "all") query = query.eq("channel", channel);

  const { data, error } = await query;
  if (error) throw new Error("Could not load the inbox.");

  const conversations: ConversationRow[] = (data ?? []).map((row) => ({
    id: row.id,
    channel: row.channel,
    displayName:
      row.counterparty_name ||
      [row.leads?.first_name, row.leads?.last_name].filter(Boolean).join(" ") ||
      row.counterparty_handle ||
      row.leads?.email ||
      "Conversation",
    handle: row.counterparty_handle,
    leadId: row.lead_id,
    unreadCount: row.unread_count,
    lastMessageAt: row.last_message_at,
  }));

  // Filtering here rather than in SQL: the searchable label is composed from
  // three nullable columns and a joined lead, which PostgREST cannot express as
  // one predicate. Bounded by the 100-row page above.
  const needle = search.toLowerCase();
  const filtered = needle
    ? conversations.filter((row) =>
        `${row.displayName} ${row.handle ?? ""}`.toLowerCase().includes(needle),
      )
    : conversations;

  // An explicit ?thread= wins; otherwise the first conversation opens, so the
  // pane is never empty when there is something to read.
  const selected =
    filtered.find((row) => row.id === params.thread) ??
    (params.thread ? null : (filtered[0] ?? null));

  let messages: ThreadMessage[] = [];
  if (selected && z.uuid().safeParse(selected.id).success) {
    const { data: rows, error: messageError } = await supabase
      .from("messages")
      .select("id, direction, body, status, created_at")
      .eq("business_id", workspace.businessId)
      .eq("conversation_id", selected.id)
      .order("created_at", { ascending: true })
      .limit(100);

    if (messageError) throw new Error("Could not load the conversation.");

    messages = (rows ?? []).map((row) => ({
      id: row.id,
      direction: row.direction,
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  const hrefFor = (conversationId: string) => {
    const next = new URLSearchParams({
      channel,
      archive: archived ? "1" : "0",
      thread: conversationId,
    });
    if (search) next.set("q", search);
    return `/app/inbox?${next.toString()}`;
  };

  return (
    <InboxView
      channel={channel}
      archived={archived}
      search={search}
      conversations={filtered}
      selected={selected}
      messages={messages}
      canManage={hasRole(workspace.role, "member")}
      hrefFor={hrefFor}
    />
  );
}
