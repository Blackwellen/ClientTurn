import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function AuthCard({
  children,
  className,
  width = "md",
}: {
  children: ReactNode;
  className?: string;
  width?: "sm" | "md" | "lg";
}) {
  const maxWidth =
    width === "sm" ? "max-w-[560px]" : width === "lg" ? "max-w-[620px]" : "max-w-[600px]";

  return (
    <div className={cn("relative w-full", maxWidth)}>
      {/* Ambient lime bloom sitting behind the card — the "important
          decorative edge" glow the design language reserves for the CTA and
          the card itself, never scattered onto every surface. */}
      <div
        aria-hidden
        className="ct-auth-glow-breathe pointer-events-none absolute -inset-6 -z-10 rounded-[32px] blur-2xl"
        style={{
          background:
            "radial-gradient(60% 55% at 30% 0%, rgba(168,255,31,0.14), transparent 70%)",
        }}
      />
      <div
        className={cn(
          "ct-auth-card-in relative overflow-hidden rounded-[var(--auth-radius-card)] p-6 backdrop-blur-xl sm:p-9 lg:p-12",
          className,
        )}
        style={{
          background: "linear-gradient(180deg, var(--auth-card-from), var(--auth-card-to))",
          border: "1px solid var(--auth-card-border)",
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.45), 0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        {/* Gloss highlight tracing the top edge, like light catching glass. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-80"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(168,255,31,0.55) 22%, rgba(255,255,255,0.7) 50%, rgba(168,255,31,0.55) 78%, transparent)",
          }}
        />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

export function AuthCardEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12.5px] font-bold tracking-[0.2em] text-[var(--auth-lime)] uppercase">
      {children}
    </p>
  );
}

export function AuthCardTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="mt-3 text-[30px] leading-[1.06] font-bold tracking-[-0.025em] text-[var(--auth-text)] text-balance sm:text-[36px] lg:text-[38px]">
      {children}
    </h1>
  );
}

export function AuthCardDescription({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3.5 text-[15.5px] leading-relaxed text-[var(--auth-text-muted)]">
      {children}
    </p>
  );
}

export function AuthCardHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-8">
      <AuthCardEyebrow>{eyebrow}</AuthCardEyebrow>
      <AuthCardTitle>{title}</AuthCardTitle>
      <AuthCardDescription>{description}</AuthCardDescription>
    </div>
  );
}

export function AuthSwitchLine({ children }: { children: ReactNode }) {
  return (
    <p className="text-center text-[13.5px] text-[var(--auth-text-muted)]">{children}</p>
  );
}
