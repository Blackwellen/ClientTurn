import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

// Source lockups are 2172x724 (3:1) — keep every rendered size on that ratio.
const LOGO_RATIO = 2172 / 724;

function LogoImage({
  src,
  height,
  className,
}: {
  src: string;
  height: number;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt="ClientTurn"
      width={Math.round(height * LOGO_RATIO)}
      height={height}
      priority
      className={cn("w-auto", className)}
      style={{ height }}
    />
  );
}

/**
 * ClientTurn wordmark. ClientTurn has no dark/light content theme — every
 * shell (app, admin, auth, onboarding, marketing) is a fixed surface, and
 * the sidebar/marketing chrome that hosts this logo is always dark, so it
 * always renders the dark-background lockup.
 */
export function Logo({
  href = "/",
  height = 26,
  className,
  imgClassName,
}: {
  href?: string | null;
  height?: number;
  className?: string;
  imgClassName?: string;
}) {
  const content = <LogoImage src="/dark_background_logo.png" height={height} className={imgClassName} />;

  if (!href) {
    return <span className={cn("inline-flex items-center", className)}>{content}</span>;
  }

  return (
    <Link
      href={href}
      aria-label="ClientTurn home"
      className={cn("inline-flex items-center", className)}
    >
      {content}
    </Link>
  );
}
