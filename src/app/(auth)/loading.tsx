import { Loader2 } from "lucide-react";

export default function AuthLoading() {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center gap-3 text-[var(--auth-text)]">
      <Loader2 aria-hidden className="size-5 animate-spin text-[var(--auth-lime)] motion-reduce:animate-none" />
      <p>Opening your account…</p>
    </div>
  );
}
