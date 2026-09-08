import * as React from "react";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Data deletion · ClientTurn",
  description: "Check the status of a data deletion request.",
};

export const dynamic = "force-dynamic";

/**
 * The status page Meta's data-deletion callback points people at.
 *
 * Meta requires the callback to return a URL where somebody can check what
 * happened to their request, and it is checked at App Review.
 *
 * Public by necessity: the person arriving here has a confirmation code and no
 * account, so there is nobody to authenticate. That shapes everything about it:
 *
 *   * The code is the only credential, which is why it is 24 random hex
 *     characters rather than anything derived from a Meta id.
 *   * A wrong code and an expired code get the **same** answer. Distinguishing
 *     them would turn the page into an oracle for whether a given code exists.
 *   * It reports counts and a status, never contents. Somebody is entitled to
 *     know their data is gone; they are not entitled to a copy of what it was,
 *     and neither is anyone who guesses a code.
 */
export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  // Bounded and shape-checked before it reaches the database. The column is
  // indexed and unique, so anything that is not a plausible code cannot match
  // and should not become a query.
  const lookup = /^[0-9a-f]{24}$/.test(code ?? "") ? code! : null;

  const request = lookup ? await loadRequest(lookup) : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-[24px] font-semibold tracking-tight text-content">
        Data deletion
      </h1>

      {!lookup && (
        <div className="mt-6 space-y-4 text-[14px] leading-relaxed text-content-muted">
          <p>
            If you removed ClientTurn from your Facebook or Instagram account and
            asked for your data to be deleted, Facebook will have given you a
            confirmation code. Open the link they showed you, or add your code to
            the end of this page&rsquo;s address as{" "}
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 text-[13px]">
              ?code=…
            </code>
            .
          </p>
          <p>
            You can also ask us directly at{" "}
            <a
              className="text-content-accent underline-offset-4 hover:underline"
              href="mailto:privacy@clientturn.co.uk"
            >
              privacy@clientturn.co.uk
            </a>{" "}
            and we will handle it without a code.
          </p>
        </div>
      )}

      {lookup && !request && (
        /* Deliberately the same answer for "never existed" and "long gone".
           Two different answers would let somebody test codes. */
        <p className="mt-6 text-[14px] leading-relaxed text-content-muted">
          We have no record of that code. It may have been mistyped, or the
          request may be old enough that the record has been cleared. If you are
          not sure, email{" "}
          <a
            className="text-content-accent underline-offset-4 hover:underline"
            href="mailto:privacy@clientturn.co.uk"
          >
            privacy@clientturn.co.uk
          </a>
          .
        </p>
      )}

      {request && (
        <div className="mt-6 space-y-5">
          <p className="text-[14px] leading-relaxed text-content">
            {STATUS_COPY[request.status] ?? STATUS_COPY.RECEIVED}
          </p>

          <dl className="rounded-xl border border-line bg-surface p-5 text-[13.5px]">
            <div className="flex justify-between gap-4 border-b border-line-subtle pb-2.5">
              <dt className="text-content-muted">Requested</dt>
              <dd className="text-content">
                {new Date(request.requested_at).toLocaleString("en-GB")}
              </dd>
            </div>
            {request.completed_at && (
              <div className="flex justify-between gap-4 border-b border-line-subtle py-2.5">
                <dt className="text-content-muted">Completed</dt>
                <dd className="text-content">
                  {new Date(request.completed_at).toLocaleString("en-GB")}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-content-muted">Connections removed</dt>
              <dd className="text-content">{request.integrations_removed}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line-subtle py-2.5">
              <dt className="text-content-muted">Records removed</dt>
              <dd className="text-content">
                {request.prospects_removed + request.conversations_removed}
              </dd>
            </div>
          </dl>

          <p className="text-[13px] leading-relaxed text-content-muted">
            This covers the Facebook and Instagram connection and everything it
            brought in. It does not remove a ClientTurn account or the business
            records inside it &mdash; if that is what you want, email{" "}
            <a
              className="text-content-accent underline-offset-4 hover:underline"
              href="mailto:privacy@clientturn.co.uk"
            >
              privacy@clientturn.co.uk
            </a>{" "}
            and we will confirm before doing anything irreversible.
          </p>
        </div>
      )}
    </main>
  );
}

const STATUS_COPY: Record<string, string> = {
  RECEIVED:
    "We have your request and are working through it. Check back shortly.",
  COMPLETED:
    "Your request is complete. The Facebook and Instagram connection has been removed, along with everything that came in through it.",
  NOTHING_TO_DELETE:
    "Your request is complete. We held nothing connected to that account, so there was nothing to remove.",
  FAILED:
    "Something went wrong completing your request, and we have been alerted. Please email privacy@clientturn.co.uk so we can finish it by hand.",
};

type DeletionRequest = {
  status: string;
  requested_at: string;
  completed_at: string | null;
  integrations_removed: number;
  prospects_removed: number;
  conversations_removed: number;
};

/**
 * Reads one row by its code, with the service role.
 *
 * The service role because there is no session to scope by: the table is
 * readable by nobody through RLS, and this is the one path that may see it. The
 * query is a single equality on a unique indexed column, and returns a fixed
 * set of counts.
 */
async function loadRequest(code: string): Promise<DeletionRequest | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("meta_data_deletion_requests")
    .select(
      "status, requested_at, completed_at, integrations_removed, prospects_removed, conversations_removed",
    )
    .eq("confirmation_code", code)
    .maybeSingle();

  return data ?? null;
}
