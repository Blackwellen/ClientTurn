import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activatePendingInvites } from "@/lib/auth/invites";

function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

/**
 * Which sign-in door a failed link should return to.
 *
 * Derived from the destination rather than carried as its own parameter: the
 * two can then never disagree. A partner sent to the customer login is being
 * told to sign in somewhere they may have no account.
 */
function doorFor(next: string | null): string {
  if (next?.startsWith("/affiliates")) return "/affiliates/login";
  if (next?.startsWith("/admin")) return "/admin/login";
  return "/login";
}

async function defaultDestination(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_members")
    .select("businesses(status)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.businesses?.status === "active" ? "/app" : "/onboarding";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  const errorDescription = searchParams.get("error_description");

  if (errorDescription || !code) {
    return NextResponse.redirect(
      `${origin}${doorFor(next)}?error=${encodeURIComponent("link_invalid")}`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(
      `${origin}${doorFor(next)}?error=${encodeURIComponent("link_invalid")}`,
    );
  }

  // An invite link lands here, so the membership is activated before the
  // destination is resolved — otherwise the invitee has no workspace yet.
  await activatePendingInvites(
    data.user.id,
    data.user.email,
    Boolean(data.user.email_confirmed_at),
  );

  const destination = next ?? (await defaultDestination(data.user.id));
  return NextResponse.redirect(`${origin}${destination}`);
}
