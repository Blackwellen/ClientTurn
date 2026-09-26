import * as React from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/dates";
import type { SenderHealth } from "@/lib/settings/ai-selling-queries";

/**
 * Channels: where the channel settings live, and the send caps in force today.
 * The caps are shown, not edited here; the sender's own settings own them.
 * Domain health (SPF, DKIM, DMARC) is summarised and lives in full under
 * Connections, beside the mailbox it belongs to.
 */
export function ChannelsCard({ health }: { health: SenderHealth }) {
  const unhealthy = health.domains.filter((row) => row.healthState !== "HEALTHY").length;
  return (
      <Card>
        <CardHeader>
          <SectionHeader
            icon={Send}
            title="Channels"
            description="Where channel settings live, and how many emails each sender may send today. Choose the assistant's channels in Workspace settings."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            <li className="rounded-lg border border-line px-3 py-2.5">
              <p className="text-[13px] font-medium text-content">Messaging, quiet hours and channels</p>
              <p className="text-[12px] text-content-muted">Default channel, fallback, quiet hours and which channels the assistant replies on.</p>
              <Link
                href="/app/settings?section=workspace"
                className="mt-1 inline-block text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Open workspace settings
              </Link>
            </li>
            <li className="rounded-lg border border-line px-3 py-2.5">
              <p className="text-[13px] font-medium text-content">Senders and mailboxes</p>
              <p className="text-[12px] text-content-muted">SMS, WhatsApp, email mailboxes and social accounts.</p>
              <Link
                href="/app/settings?section=connections"
                className="mt-1 inline-block text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Open connections
              </Link>
            </li>
          </ul>

          <div>
            <p className="mb-2 text-[13px] font-medium text-content">Email send caps today</p>
            {health.senders.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-content-muted">
                No email sender is set up yet.
              </p>
            ) : (
              <ul className="divide-y divide-line-subtle rounded-lg border border-line">
                {health.senders.map((sender) => {
                  const paused = sender.paused;
                  const full = sender.sentToday >= sender.dailySendCap;
                  return (
                    <li key={sender.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate text-[12.5px] text-content">{sender.email}</span>
                      <span className="flex items-center gap-2 text-[12px] tabular-nums text-content-secondary">
                        {sender.sentToday} of {sender.dailySendCap} sent
                        {paused ? (
                          <Badge tone="warning" dense>
                            Paused until {formatDateTime(sender.pausedUntil)}
                          </Badge>
                        ) : full ? (
                          <Badge tone="warning" dense>
                            Cap reached
                          </Badge>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-content-muted">
              {health.domains.length === 0
                ? "No sending domain has been checked yet."
                : unhealthy === 0
                  ? `All ${health.domains.length} sending ${health.domains.length === 1 ? "domain is" : "domains are"} healthy.`
                  : `${unhealthy} of ${health.domains.length} sending domains need attention.`}{" "}
              <Link
                href="/app/settings?section=connections"
                className="font-medium text-content-accent underline-offset-4 hover:underline"
              >
                See SPF, DKIM and DMARC
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
  );
}
