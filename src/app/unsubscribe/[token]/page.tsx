import type { Metadata } from "next";
import { CheckCircle2, MailX, XCircle } from "lucide-react";
import { redirect } from "next/navigation";
import {
  findUnsubscribeSubject,
  performUnsubscribe,
} from "@/lib/email/unsubscribe";
import { isUnsubscribeToken } from "@/lib/email/unsubscribe-links";

export const metadata: Metadata = {
  title: "Unsubscribe",
  // An unsubscribe page must never be indexed or followed.
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * The page the footer link opens.
 *
 * GET only *confirms*: link scanners, mail-client previews and security
 * gateways fetch every link in a message without anyone clicking, so acting on
 * GET would unsubscribe people who never asked. The button POSTs (a server
 * action) and the work happens there. Mail clients' own one-click button uses
 * the RFC 8058 route at `/api/unsubscribe/[token]` instead.
 */
async function confirmUnsubscribe(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!isUnsubscribeToken(token)) redirect("/");
  const result = await performUnsubscribe(token);
  const status = result.ok ? "done" : result.reason;
  // Redirect rather than render: the result is read fresh on the next request.
  redirect(`/unsubscribe/${token}?status=${status}`);
}

type View =
  | { kind: "confirm"; business: string; token: string }
  | { kind: "done"; business: string }
  | { kind: "invalid" }
  | { kind: "error" };

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { token } = await params;
  const { status } = await searchParams;

  const subject = await findUnsubscribeSubject(token);
  const result: View =
    subject === "error" || status === "error"
      ? { kind: "error" }
      : !subject
        ? { kind: "invalid" }
        : status === "done"
          ? { kind: "done", business: subject.business }
          : { kind: "confirm", business: subject.business, token };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F9FC] px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-[#E3E8EF] bg-white p-8 text-center shadow-sm">
        {result.kind === "confirm" && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#F7F9FC]">
              <MailX className="size-6 text-[#0B1020]" aria-hidden />
            </span>
            <h1 className="mt-4 text-[20px] font-semibold text-[#0B1020]">
              Unsubscribe from {result.business}?
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[#5B6B82]">
              You will stop receiving marketing messages from {result.business}.
            </p>
            <form action={confirmUnsubscribe} className="mt-6">
              <input type="hidden" name="token" value={result.token} />
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#0B1020] px-4 text-[14px] font-medium text-white hover:bg-[#1A2236] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B1020]"
              >
                Unsubscribe
              </button>
            </form>
          </>
        )}

        {result.kind === "done" && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#ECFDF3]">
              <CheckCircle2 className="size-6 text-[#12B76A]" aria-hidden />
            </span>
            <h1 className="mt-4 text-[20px] font-semibold text-[#0B1020]">
              You&rsquo;ve been unsubscribed
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[#5B6B82]">
              You will not receive any more marketing messages from{" "}
              {result.business}. If you are in the middle of arranging work with
              them, they can still reply to you directly.
            </p>
          </>
        )}

        {result.kind === "invalid" && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#FEF3F2]">
              <XCircle className="size-6 text-[#F04438]" aria-hidden />
            </span>
            <h1 className="mt-4 text-[20px] font-semibold text-[#0B1020]">
              This link is no longer valid
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[#5B6B82]">
              It may have been copied incompletely. The unsubscribe link in
              any other email from the business works too, and stops all
              their marketing. Replying &ldquo;STOP&rdquo; to a text message
              stops their text messages only.
            </p>
          </>
        )}

        {result.kind === "error" && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#FEF3F2]">
              <XCircle className="size-6 text-[#F04438]" aria-hidden />
            </span>
            <h1 className="mt-4 text-[20px] font-semibold text-[#0B1020]">
              We couldn&rsquo;t complete that just now
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[#5B6B82]">
              Nothing has changed yet. Please open the link again in a minute.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
