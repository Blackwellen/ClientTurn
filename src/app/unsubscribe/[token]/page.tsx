import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseEmail } from "@/lib/email/account";

export const metadata: Metadata = {
  title: "Unsubscribe · ClientTurn",
  // An unsubscribe page must never be indexed or followed.
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe, reached from the link and the `List-Unsubscribe`
 * header on every marketing email.
 *
 * The token is a per-lead random value, so knowing it proves the holder
 * received the mail. No login, no lookup by email address, and no way to
 * enumerate other leads. Acting on GET is deliberate here: RFC 8058 clients
 * and ordinary "click the link" behaviour both have to work, and the only
 * effect is to stop messages — the safe direction.
 */
async function unsubscribe(token: string): Promise<
  { ok: true; business: string } | { ok: false }
> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false };

  const admin = createAdminClient();

  // `unsubscribe_token` is added by migration 0039. `database.types.ts` is
  // generated from the deployed schema, so the column is absent from the
  // generated types until that migration has been applied and the types
  // regenerated. The filter column is narrowed here rather than casting the
  // whole query, so the selected columns stay fully typed.
  const { data: lead } = await admin
    .from("leads")
    .select("id, business_id, email, businesses ( name )")
    .eq("unsubscribe_token" as "id", token)
    .maybeSingle();

  if (!lead) return { ok: false };

  await admin
    .from("leads")
    .update({ opted_out: true, automation_active: false })
    .eq("id", lead.id);

  // Suppress the address itself as well as the lead, so a second lead record
  // with the same address cannot be mailed either.
  const email = normaliseEmail(lead.email);
  if (email) {
    await admin.from("contact_suppressions").upsert(
      {
        business_id: lead.business_id,
        normalized_contact: email,
        channel: "email",
        reason: "opt_out",
        source: "unsubscribe_link",
      },
      { onConflict: "business_id,normalized_contact,channel" },
    );
  }

  await admin
    .from("campaign_contacts")
    .update({ state: "stopped", stopped_reason: "opted_out" })
    .eq("lead_id", lead.id)
    .in("state", ["pending", "scheduled"]);

  const business = lead.businesses as { name?: string } | null;
  return { ok: true, business: business?.name ?? "this business" };
}

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await unsubscribe(token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F9FC] px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-[#E3E8EF] bg-white p-8 text-center shadow-sm">
        {result.ok ? (
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
        ) : (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#FEF3F2]">
              <XCircle className="size-6 text-[#F04438]" aria-hidden />
            </span>
            <h1 className="mt-4 text-[20px] font-semibold text-[#0B1020]">
              This link is no longer valid
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[#5B6B82]">
              It may already have been used, or it may have been copied
              incompletely. Replying &ldquo;STOP&rdquo; to any message from the
              business also stops all further messages.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
