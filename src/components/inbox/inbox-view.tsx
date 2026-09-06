import * as React from "react";
import Link from "next/link";
import {
  Briefcase,
  Camera,
  Inbox as InboxIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Search,
  Smartphone,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { AgentPanel } from "./agent-panel";
import type { ConversationAgentState } from "@/lib/agent/views";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  CHANNEL_DEFINITIONS,
  INBOX_CHANNELS,
  channelLabel,
  type ConversationRow,
  type InboxChannel,
  type ThreadMessage,
} from "@/lib/inbox/types";
import { InboxControls } from "./inbox-controls";

/**
 * The unified inbox.
 *
 * Three panes: channels, conversations, thread. The layout collapses to a
 * stack below `lg`, where a phone shows the list and the open thread in
 * sequence rather than side by side.
 *
 * Presentational — every query lives in the page, so this renders identically
 * in a dev harness and in production.
 */
export function InboxView({
  channel,
  archived,
  search,
  conversations,
  selected,
  messages,
  agentState,
  canManage,
  hrefFor,
}: {
  channel: InboxChannel;
  archived: boolean;
  search: string;
  conversations: ConversationRow[];
  selected: ConversationRow | null;
  messages: ThreadMessage[];
  agentState: ConversationAgentState | null;
  canManage: boolean;
  hrefFor: (conversationId: string) => string;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Inbox"
          description="Email, WhatsApp, SMS and social conversations in one place."
          size="lg"
        />
        <Link
          href="/app/settings?view=connections"
          className="border-line-strong bg-surface text-content hover:bg-surface-hover focus-visible:outline-content-accent inline-flex h-9 shrink-0 items-center rounded-md border px-3.5 text-[13px] font-medium shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Manage channels
        </Link>
      </div>

      <div className="grid min-h-[600px] overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-[190px_320px_1fr]">
        <ChannelRail channel={channel} archived={archived} />
        <ConversationList
          conversations={conversations}
          selectedId={selected?.id ?? null}
          channel={channel}
          archived={archived}
          search={search}
          hrefFor={hrefFor}
        />
        <ThreadPane
          channel={channel}
          selected={selected}
          messages={messages}
          agentState={agentState}
          archived={archived}
          canManage={canManage}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ channel rail */

const CHANNEL_ICONS: Record<InboxChannel, React.ComponentType<{ className?: string }>> = {
  all: InboxIcon,
  email: Mail,
  whatsapp: MessageCircle,
  sms: Smartphone,
  messenger: MessageSquare,
  // This lucide build no longer ships brand marks. The Connections page uses
  // the official assets in `public/brands/`; a 16px nav rail uses neutral
  // glyphs instead, which also sidesteps any brand-usage question here.
  instagram: Camera,
  linkedin: Briefcase,
};

function ChannelRail({ channel, archived }: { channel: InboxChannel; archived: boolean }) {
  return (
    <aside className="border-b border-line bg-surface-sunken/50 p-3 lg:border-b-0 lg:border-r">
      <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
        Channels
      </p>

      <nav aria-label="Inbox channels" className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
        {INBOX_CHANNELS.map((key) => {
          const Icon = CHANNEL_ICONS[key];
          const definition = CHANNEL_DEFINITIONS[key];
          const active = channel === key && !archived;

          return (
            <Link
              key={key}
              href={`/app/inbox?channel=${key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px]",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
                active
                  ? "bg-surface font-semibold text-content shadow-xs"
                  : "text-content-muted hover:bg-surface hover:text-content",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{definition.label}</span>
              {/* A channel we cannot read is marked here rather than only
                  discovered after clicking into an empty list. */}
              {!definition.canRead && (
                <span className="ml-auto text-[10px] text-content-subtle">n/a</span>
              )}
            </Link>
          );
        })}
      </nav>

      <Link
        href={`/app/inbox?channel=${channel}&archive=1`}
        aria-current={archived ? "page" : undefined}
        className={cn(
          "mt-3 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px]",
          archived
            ? "bg-surface font-semibold text-content shadow-xs"
            : "text-content-muted hover:bg-surface hover:text-content",
        )}
      >
        Archived
      </Link>
    </aside>
  );
}

/* -------------------------------------------------------- conversation list */

function ConversationList({
  conversations,
  selectedId,
  channel,
  archived,
  search,
  hrefFor,
}: {
  conversations: ConversationRow[];
  selectedId: string | null;
  channel: InboxChannel;
  archived: boolean;
  search: string;
  hrefFor: (id: string) => string;
}) {
  return (
    <section className="flex min-w-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
      <form className="relative border-b border-line p-3">
        {/* Preserved so searching does not silently drop the active filters. */}
        <input type="hidden" name="channel" value={channel} />
        <input type="hidden" name="archive" value={archived ? "1" : "0"} />
        <Search
          className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
          aria-hidden
        />
        <input
          name="q"
          type="search"
          defaultValue={search}
          aria-label="Search conversations"
          placeholder="Search conversations"
          className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-[13px] text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
        />
      </form>

      <div className="max-h-72 flex-1 overflow-y-auto lg:max-h-[600px]">
        {conversations.length === 0 ? (
          <p className="p-6 text-[12.5px] text-content-muted">
            No {archived ? "archived " : ""}conversations
            {search ? " match this search" : " yet"}.
          </p>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={hrefFor(conversation.id)}
                  aria-current={selectedId === conversation.id ? "true" : undefined}
                  className={cn(
                    "block border-b border-line-subtle px-4 py-3",
                    selectedId === conversation.id
                      ? "bg-accent-50/50"
                      : "hover:bg-surface-hover",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-content">
                      {conversation.displayName}
                    </span>
                    {conversation.unreadCount > 0 && (
                      <Badge tone="accent" dense>
                        {conversation.unreadCount}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11.5px] text-content-muted">
                    {channelLabel(conversation.channel)}
                    {conversation.lastMessageAt
                      ? ` · ${new Date(conversation.lastMessageAt).toLocaleDateString("en-GB")}`
                      : " · No messages"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- thread */

function ThreadPane({
  channel,
  selected,
  messages,
  agentState,
  archived,
  canManage,
}: {
  channel: InboxChannel;
  selected: ConversationRow | null;
  messages: ThreadMessage[];
  agentState: ConversationAgentState | null;
  archived: boolean;
  canManage: boolean;
}) {
  if (!selected) {
    const definition = CHANNEL_DEFINITIONS[channel];
    return (
      <section className="flex flex-1 flex-col items-center justify-center p-10 text-center">
        <span
          aria-hidden
          className="mb-4 flex size-11 items-center justify-center rounded-xl border border-line bg-surface-sunken text-content-muted"
        >
          <InboxIcon className="size-5" />
        </span>
        <h2 className="text-[15px] font-semibold text-content">
          {definition.canRead ? "Your conversations, together" : `${definition.label} cannot be synced`}
        </h2>
        <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-content-muted">
          {definition.emptyExplanation}
        </p>
        {definition.canRead && (
          <Link
            href="/app/settings?view=connections"
            className="mt-4 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            View connections
          </Link>
        )}
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-content">
            {selected.displayName}
          </h2>
          <p className="mt-0.5 text-[11.5px] text-content-muted">
            {channelLabel(selected.channel)}
            {selected.handle ? ` · ${selected.handle}` : ""}
          </p>
        </div>
        {selected.leadId && (
          <Link
            href={`/app/leads?lead=${selected.leadId}`}
            className="shrink-0 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            View lead
          </Link>
        )}
      </header>

      {agentState && <AgentPanel state={agentState} canManage={canManage} />}

      <div className="flex-1 space-y-3 overflow-y-auto p-4 lg:max-h-[440px]">
        {messages.length === 0 ? (
          <p className="text-[12.5px] text-content-muted">No messages in this conversation.</p>
        ) : (
          messages.map((message) => {
            const outbound = message.direction === "outbound";
            return (
              <div
                key={message.id}
                className={cn(
                  "max-w-[85%] rounded-xl px-3.5 py-2.5",
                  outbound
                    ? "ml-auto bg-accent-50 text-content"
                    : "border border-line bg-surface",
                )}
              >
                <p className="whitespace-pre-wrap break-words text-[13px]">{message.body}</p>
                <p className="mt-1.5 text-[11px] text-content-subtle">
                  {new Date(message.createdAt).toLocaleString("en-GB")} · {message.status}
                </p>
              </div>
            );
          })
        )}
      </div>

      {canManage && (
        <InboxControls
          id={selected.id}
          channel={selected.channel}
          hasLead={Boolean(selected.leadId)}
          archived={archived}
        />
      )}
    </section>
  );
}
