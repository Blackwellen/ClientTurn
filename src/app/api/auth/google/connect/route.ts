import { safeRelativePath } from "@/lib/security/safe-redirect";
import { NextResponse, type NextRequest } from "next/server";
import {
  GOOGLE_LOGIN_COOKIE,
  startGoogleLogin,
  type GoogleLoginAudience,
} from "@/lib/auth/google-login";

/**
 * Step 1 of native Google sign-in: redirects the browser to Google's own
 * consent screen. The browser never touches `supabase.co` here -- only this
 * app's own domain, then `accounts.google.com`, then this app's own
 * `/callback` route (see that file for the rest of the flow).
 */

function audienceFrom(value: string | null): GoogleLoginAudience {
  return value === "affiliate" ? "affiliate" : "customer";
}

/** Same shape as the sanitisation the login pages already apply to `?redirect=`. Full re-validation happens again at the callback -- this is only what gets carried in the cookie. */
function rawNext(value: string | null): string | null {
  return safeRelativePath(value);
}

export function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const audience = audienceFrom(searchParams.get("aud"));
  const next = rawNext(searchParams.get("redirect"));
  const loginDoor = audience === "affiliate" ? "/affiliates/login" : "/login";

  const started = startGoogleLogin({ audience, next, origin });
  if (!started) {
    return NextResponse.redirect(
      `${origin}${loginDoor}?error=${encodeURIComponent("google_unavailable")}`,
    );
  }

  const response = NextResponse.redirect(started.url);
  response.cookies.set(GOOGLE_LOGIN_COOKIE, started.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: started.maxAgeSeconds,
  });
  return response;
}
