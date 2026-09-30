import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "./database.types";

/**
 * The browser's User-Agent, forwarded to Supabase Auth. Sign-in runs on the
 * server, so without this every session recorded the server's own agent and
 * Settings, Security listed each one as "Browser on an unknown system".
 * Display-only: nothing trusts this value for a security decision.
 */
async function browserUserAgent(): Promise<string | null> {
  try {
    const agent = (await headers()).get("user-agent");
    return agent ? agent.slice(0, 512) : null;
  } catch {
    return null; // outside a request (build, scripts)
  }
}

export async function createClient() {
  const cookieStore = await cookies();
  const userAgent = await browserUserAgent();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
      ...(userAgent ? { global: { headers: { "User-Agent": userAgent } } } : {}),
    },
  );
}
