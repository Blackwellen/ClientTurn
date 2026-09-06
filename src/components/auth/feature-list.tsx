import type { LucideIcon } from "lucide-react";

export type AuthFeature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export function FeatureItem({ icon: Icon, title, description }: AuthFeature) {
  return (
    <li className="group flex items-start gap-4.5">
      <span
        className="relative flex size-14 shrink-0 items-center justify-center rounded-[14px] text-[var(--auth-lime)] shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition-transform duration-300 group-hover:-translate-y-0.5"
        style={{
          background:
            "linear-gradient(155deg, rgba(168,255,31,0.14), rgba(168,255,31,0.03) 60%, rgba(255,255,255,0.02))",
          border: "1px solid rgba(168,255,31,0.18)",
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-[14px] opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-60"
          style={{ background: "rgba(168,255,31,0.35)" }}
        />
        <Icon className="relative size-5.5" strokeWidth={2.2} aria-hidden />
      </span>
      <span className="pt-1.5">
        <span className="block text-[15.5px] font-semibold text-[var(--auth-text)]">
          {title}
        </span>
        <span className="mt-0.5 block text-[13.5px] leading-snug text-[var(--auth-text-muted)]">
          {description}
        </span>
      </span>
    </li>
  );
}

export function FeatureList({ items }: { items: AuthFeature[] }) {
  return (
    <ul className="flex flex-col gap-7">
      {items.map((item) => (
        <FeatureItem key={item.title} {...item} />
      ))}
    </ul>
  );
}
