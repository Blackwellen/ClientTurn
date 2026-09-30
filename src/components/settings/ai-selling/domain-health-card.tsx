import * as React from "react";
import { Globe } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/dates";
import { formatMetric } from "@/lib/analytics/v4-metrics";
import type { DomainHealthRow, SenderLimitRow } from "@/lib/settings/ai-selling-queries";

/**
 * Sending-domain health: SPF, DKIM and DMARC as DNS actually says, from the
 * daily domain-health job (domain_health_snapshots), plus the bounce and
 * complaint rates that decide whether a domain keeps sending. A sending domain
 * with no snapshot yet says so; it is never shown as passing.
 */
export function DomainHealthCard({
  domains,
  senders,
}: {
  domains: DomainHealthRow[];
  senders: SenderLimitRow[];
}) {
  const known = new Set(domains.map((row) => row.domain));
  const unchecked = [
    ...new Set(senders.map((sender) => sender.domain).filter((d): d is string => Boolean(d) && !known.has(d!))),
  ];

  return (
    <Card id="sending-domains" className="scroll-mt-24">
      <CardHeader>
        <SectionHeader
          icon={Globe}
          title="Sending domain health"
          description="Whether your sending domains are set up so mail is trusted, checked daily against DNS."
        />
      </CardHeader>
      <CardContent>
        {domains.length === 0 && unchecked.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-content-muted">
            No sending domain yet. Connect a mailbox to send email from your own domain, and its SPF, DKIM and DMARC
            are checked here each day.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12.5px]">
              <thead className="text-[11.5px] text-content-subtle">
                <tr>
                  <th className="py-2 pr-3 font-medium">Domain</th>
                  <th className="py-2 pr-3 font-medium">Overall</th>
                  <th className="py-2 pr-3 font-medium">SPF</th>
                  <th className="py-2 pr-3 font-medium">DKIM</th>
                  <th className="py-2 pr-3 font-medium">DMARC</th>
                  <th className="py-2 pr-3 text-right font-medium">Bounces</th>
                  <th className="py-2 text-right font-medium">Complaints</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {domains.map((row) => (
                  <tr key={row.domain}>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-content">{row.domain}</span>
                      <span className="block text-[11px] text-content-subtle">Checked {formatDate(row.snapshotDate)}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge kind="deliverability" value={row.healthState} dense />
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge kind="dns_record" value={row.spf} dense />
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge kind="dns_record" value={row.dkim} dense />
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge kind="dns_record" value={row.dmarc} dense />
                      {row.dmarcPolicy && (
                        <span className="ml-1 text-[11px] text-content-subtle">p={row.dmarcPolicy}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMetric(row.bounceRate, "percent")}</td>
                    <td className="py-2 text-right tabular-nums">{formatMetric(row.complaintRate, "percent")}</td>
                  </tr>
                ))}
                {unchecked.map((domain) => (
                  <tr key={domain}>
                    <td className="py-2 pr-3 font-medium text-content">{domain}</td>
                    <td className="py-2 pr-3" colSpan={6}>
                      <StatusBadge kind="deliverability" value="NOT_CHECKED" dense />
                      <span className="ml-2 text-[11.5px] text-content-muted">
                        Not checked yet. The first check runs within a day of connecting.
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11.5px] text-content-subtle">
          DKIM can only be checked when the sender has a DKIM selector configured; otherwise it shows as not checked,
          which is not a failure.
        </p>
      </CardContent>
    </Card>
  );
}
