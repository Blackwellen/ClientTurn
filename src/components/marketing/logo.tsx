import { Logo as BrandLogo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

// The marketing site is a fixed dark/near-black surface, so it always uses
// the dark-background lockup regardless of the visitor's system theme.
export function Logo({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <BrandLogo
      href={href}
      height={72}
      className={cn("shrink-0", className)}
      imgClassName="max-w-none"
    />
  );
}
