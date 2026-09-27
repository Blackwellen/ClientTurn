import * as React from "react";
import { quoteDocumentSections } from "@/lib/quotes/document";
import type { QuoteRenderModel } from "@/lib/quotes/types";

/**
 * The quote as the customer sees it on /q/[token]. It renders the SAME
 * sections the PDF renders (quoteDocumentSections over the frozen render
 * model), so the page and the PDF cannot disagree on a figure or a word
 * (tests/quote-pdf.test.ts). Server component; no client JavaScript.
 *
 * Lines are a table from `sm` up and stacked cards on a phone, so a 360px
 * screen never scrolls sideways.
 */
export function PublicQuoteDocument({ model, documentHash, logoUrl }: { model: QuoteRenderModel; documentHash: string; logoUrl: string | null }) {
  const doc = quoteDocumentSections(model, { documentHash });
  const numericColumns = doc.lineColumns.slice(1);

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" aria-labelledby="quote-title">
      <header className="flex flex-col gap-5 border-b border-line-subtle px-5 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-8">
        <div className="flex min-w-0 items-start gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL from the workspace's own profile
            <img src={logoUrl} alt="" className="size-12 shrink-0 rounded-lg border border-line object-contain" />
          )}
          <div className="min-w-0">
            <p className="text-[17px] font-semibold text-content">{doc.seller.name}</p>
            {doc.seller.lines.map((line) => (
              <p key={line} className="text-[12.5px] leading-5 text-content-muted">{line}</p>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12.5px] sm:text-right">
          {doc.facts.map((fact) => (
            <React.Fragment key={fact.label}>
              <dt className="text-content-muted sm:text-left">{fact.label}</dt>
              <dd className="font-medium text-content">{fact.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </header>

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <h1 id="quote-title" className="text-[22px] font-semibold leading-tight text-content">{doc.title}</h1>
          <p className="mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-content-muted">{doc.buyer.heading}</p>
          {doc.buyer.lines.map((line) => (
            <p key={line} className="text-[13.5px] text-content-secondary">{line}</p>
          ))}
        </div>

        {doc.customerNote && <p className="rounded-lg bg-surface-sunken px-4 py-3 text-[13.5px] text-content-secondary">{doc.customerNote}</p>}

        <section aria-label="Quote lines">
          {/* Phone: cards */}
          <ul className="space-y-2 sm:hidden">
            {doc.lines.map((line) => (
              <li key={line.lineId} className={`rounded-lg border border-line-subtle p-3 ${line.isAddOn ? "ml-3" : ""}`}>
                {line.group && <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">{line.group}</p>}
                <p className="text-[13.5px] font-medium text-content">{line.description}</p>
                <p className="text-[11.5px] text-content-muted">{line.billing}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12.5px]">
                  {numericColumns.map((label, i) =>
                    line.cells[i + 1] ? (
                      <React.Fragment key={label}>
                        <dt className="text-content-muted">{label}</dt>
                        <dd className="text-right tabular-nums text-content">{line.cells[i + 1]}</dd>
                      </React.Fragment>
                    ) : null,
                  )}
                </dl>
              </li>
            ))}
          </ul>
          {/* Wider: a table */}
          <div className="hidden sm:block">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-content-muted">
                  {doc.lineColumns.map((label, i) => (
                    <th key={label} scope="col" className={`pb-2 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((line) => (
                  <tr key={line.lineId} className="border-b border-line-subtle align-top">
                    <td className={`py-2.5 pr-3 ${line.isAddOn ? "pl-4" : ""}`}>
                      {line.group && <span className="block text-[11px] font-semibold uppercase tracking-wide text-content-muted">{line.group}</span>}
                      <span className="text-content">{line.description}</span>
                      <span className="block text-[11.5px] text-content-muted">{line.billing}</span>
                    </td>
                    {line.cells.slice(1).map((cell, i) => (
                      <td key={i} className="whitespace-nowrap py-2.5 pl-2 text-right tabular-nums text-content-secondary">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          {doc.totals.map((group) => (
            <section key={group.heading} className="rounded-lg border border-line-subtle p-4" aria-label={group.heading}>
              <h2 className="text-[13px] font-semibold text-content">{group.heading}</h2>
              <dl className="mt-2 space-y-1 text-[13px]">
                {group.rows.map((row) => (
                  <div key={row.label} className="flex justify-between gap-3">
                    <dt className={row.strong ? "font-semibold text-content" : "text-content-muted"}>{row.label}</dt>
                    <dd className={`tabular-nums ${row.strong ? "font-semibold text-content" : "text-content"}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section className="rounded-lg border border-line-subtle p-4" aria-label={doc.payment.heading}>
            <h2 className="text-[13px] font-semibold text-content">{doc.payment.heading}</h2>
            <dl className="mt-2 space-y-1 text-[13px]">
              {doc.payment.rows.map((row) => (
                <div key={row.label} className="flex justify-between gap-3">
                  <dt className={row.strong ? "font-semibold text-content" : "text-content-muted"}>{row.label}</dt>
                  <dd className={`tabular-nums ${row.strong ? "font-semibold text-content" : "text-content"}`}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        {doc.usage && (
          <section className="rounded-lg border border-line-subtle p-4 text-[13px]" aria-label="Usage">
            <h2 className="font-semibold text-content">Usage (estimate)</h2>
            <p className="mt-1 text-content-muted">{doc.usage.explanation}</p>
            <ul className="mt-2 space-y-0.5 text-content-secondary">
              {doc.usage.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {doc.vatNotice && <p className="text-[12.5px] text-content-muted">{doc.vatNotice}</p>}

        {doc.terms && (
          <section aria-label="Terms">
            <h2 className="text-[13px] font-semibold text-content">Terms</h2>
            <p className="mt-1 whitespace-pre-line text-[12.5px] leading-5 text-content-secondary">{doc.terms}</p>
          </section>
        )}

        <p className="break-all text-[11px] text-content-subtle">{doc.fingerprintLabel}</p>
      </div>
    </article>
  );
}
