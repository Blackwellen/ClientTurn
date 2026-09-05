import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Section, SectionHeading } from "./section";

const FUNNEL = [
  { label: "Leads received", value: 133, share: 100 },
  { label: "Contacted", value: 133, share: 100 },
  { label: "Replied", value: 73, share: 55 },
  { label: "Qualified", value: 43, share: 32 },
  { label: "Booked", value: 26, share: 20 },
  { label: "Won", value: 11, share: 8 },
] as const;

const SOURCES = [
  { campaign: "Roof Replacement", leads: 82, replies: 47, qualified: 29, booked: 18 },
  { campaign: "Roof Repairs", leads: 51, replies: 26, qualified: 14, booked: 8 },
] as const;

export function AnalyticsPreview() {
  return (
    <Section id="results">
      <SectionHeading
        eyebrow="Results you can see"
        title="From campaign to booked job, in one view."
        description="Leads are only half the picture. ClientTurn reports what each campaign actually produced — replies, qualified enquiries, bookings and won work."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.25fr]">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-semibold text-content">
              Conversion funnel
            </h3>
            <Badge tone="neutral">Illustrative</Badge>
          </div>

          <ul className="mt-6 space-y-4">
            {FUNNEL.map((stage) => (
              <li key={stage.label}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-content-secondary">
                    {stage.label}
                  </span>
                  <span className="lr-tabular text-[13px] font-semibold text-content">
                    {stage.value}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
                  role="presentation"
                >
                  <div
                    className="h-full rounded-full bg-accent-500"
                    style={{ width: `${stage.share}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-baseline justify-between gap-3 border-t border-line-subtle pt-4">
            <span className="text-[13px] text-content-secondary">
              Estimated pipeline
            </span>
            <span className="lr-tabular text-[18px] font-semibold text-content">
              £96,200
            </span>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
          <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
            <h3 className="text-[15px] font-semibold text-content">
              Source performance
            </h3>
            <Badge tone="neutral">Illustrative</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Campaign</TableHead>
                <TableHead align="right" numeric>
                  Leads
                </TableHead>
                <TableHead align="right" numeric>
                  Replies
                </TableHead>
                <TableHead align="right" numeric>
                  Qualified
                </TableHead>
                <TableHead align="right" numeric>
                  Booked
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SOURCES.map((row) => (
                <TableRow key={row.campaign}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {row.campaign}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {row.leads}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {row.replies}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {row.qualified}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {row.booked}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p className="border-t border-line-subtle px-5 py-4 text-[12px] leading-relaxed text-content-muted">
            Figures on this page are sample data used to show the reporting
            layout. They are not customer results and are not a performance
            claim.
          </p>
        </div>
      </div>
    </Section>
  );
}
