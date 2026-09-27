import type { Metadata } from "next";
import { FileX2, Download } from "lucide-react";
import { PoweredByBadge } from "@/components/public/powered-by-badge";
import { PublicQuoteDocument } from "@/components/quotes/public-quote-document";
import { SignPanel } from "@/components/quotes/sign-panel";
import { ViewBeacon } from "@/components/quotes/view-beacon";
import { formatDocumentDate } from "@/lib/quotes/document";
import { issueFormNonce } from "@/lib/quotes/public-sign";
import { TOKEN_PATTERN, TOKEN_UNAVAILABLE_MESSAGE } from "@/lib/quotes/tokens";
import { paymentNextStep, publicLogoUrl, publicView, quoteFormSecret, resolvePublicQuote } from "@/lib/quotes/public-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your quote",
  // A private document: never indexed, never followed, and the link (which
  // is the credential) is never sent on as a referrer.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

const SIGNED_STATES = ["SIGNED", "DEPOSIT_PAID", "PAID", "WON"];

/**
 * /q/[token]: the customer's view of one quote revision (gap map §1.2).
 *
 * Read through `quote_public_view` (0153), the only anonymous way in: a
 * wrong, expired, revoked or superseded link all show the same page, so a
 * visitor cannot tell which. The document is the frozen render model, drawn
 * by the same sections as the PDF. GET changes nothing a person did not do:
 * the "viewed" event is a script-sent POST once per session, and accepting
 * or signing is an explicit POST with CSRF protection (public-sign.ts).
 */
export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return <Unavailable />;

  const [view, context] = await Promise.all([publicView(token), resolvePublicQuote(token)]);
  if (!view || !context) return <Unavailable />;

  const [logoUrl, nextStep] = await Promise.all([
    publicLogoUrl(context.businessId),
    SIGNED_STATES.includes(view.status) || (view.status === "ACCEPTED" && !context.esignEnabled) ? paymentNextStep(context) : Promise.resolve(null),
  ]);
  const nonce = issueFormNonce(quoteFormSecret(), token, new Date());
  const signed = SIGNED_STATES.includes(view.status) || (view.status === "ACCEPTED" && !context.esignEnabled);
  const expired = view.status === "EXPIRED";
  const closed = ["DECLINED", "WITHDRAWN", "REVISED", "EXPIRED"].includes(view.status);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
      <ViewBeacon token={token} nonce={nonce} />

      {expired && (
        <p role="status" className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-[13.5px] text-warning-700">
          This quote expired on {formatDocumentDate(view.renderModel.quote.validUntil)}. Ask {view.renderModel.seller.name} for an updated one.
        </p>
      )}

      <PublicQuoteDocument model={view.renderModel} documentHash={view.renderHash} logoUrl={logoUrl} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href={`/q/${token}/pdf`}
          rel="nofollow noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </a>
        {view.renderModel.poweredBy && <PoweredByBadge />}
      </div>

      {(view.canSign || signed) && !closed && (
        <SignPanel
          token={token}
          nonce={nonce}
          esign={context.esignEnabled}
          requireDrawn={context.requireDrawnSignature}
          initialNextStep={nextStep}
          signedAlready={signed}
        />
      )}
    </main>
  );
}

/** One page for every link that does not work: wrong, expired, revoked or superseded. */
function Unavailable() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface">
        <FileX2 className="size-5 text-content-muted" aria-hidden />
      </span>
      <h1 className="mt-4 text-[18px] font-semibold text-content">Quote not available</h1>
      <p className="mt-1.5 text-[13.5px] text-content-muted">{TOKEN_UNAVAILABLE_MESSAGE}</p>
    </main>
  );
}
