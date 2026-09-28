import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

/**
 * The root 404: unknown URLs, and every `notFound()` without a closer
 * not-found.tsx (agents/[id], help articles). Plain and self-contained so it
 * renders the same inside any group.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0B1020] px-6 text-[#F7F9FC]">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold tracking-wide text-[#B7F34A]">404</p>
        <h1 className="mt-3 text-2xl font-semibold">This page does not exist</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#F7F9FC]/75">
          The link may be old, or the record may have been removed.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/"
            className="rounded-[10px] bg-[#B7F34A] px-4 py-2.5 text-sm font-semibold text-[#0B1020]"
          >
            Home page
          </Link>
          <Link
            href="/app"
            className="rounded-[10px] border border-white/25 px-4 py-2.5 text-sm text-[#F7F9FC]"
          >
            Open the app
          </Link>
        </div>
      </div>
    </main>
  );
}
