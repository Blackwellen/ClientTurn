import * as React from "react";
import { Puzzle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProviderType } from "@/lib/integrations/catalog";
import { brandMarkSrc } from "@/lib/integrations/brand-marks";

/**
 * Provider brand marks, served from `public/brands/`. Each identifies its own
 * connection card — nominative use, as in any integrations directory — and
 * each mark stays the trademark of its owner. All are official assets; see
 * `public/brands/README.md` for provenance.
 *
 * The files keep their own viewBoxes (Meta is 256×171, ZOHO 1024×450), so the
 * mark is capped on both axes and centred rather than re-cropped by hand.
 */
export function ProviderIcon({
  provider,
  className,
}: {
  provider: ProviderType;
  className?: string;
}) {
  const src = brandMarkSrc(provider);

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
        "border border-line bg-surface",
        className,
      )}
    >
      {src ? (
        // A plain <img>: these are static, already-optimised SVGs, so
        // next/image would add a pipeline without shrinking them. The card
        // states the provider name in text, so the mark itself is decorative.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          // Capped on both axes rather than forced square: several marks are
          // wide lockups (ZOHO is 2.3:1, Meta 1.5:1) and a fixed 22px box
          // would shrink them to fit their width, not their height.
          className="max-h-[22px] max-w-[28px] object-contain"
        />
      ) : (
        <Puzzle className="size-[18px] text-content-muted" aria-hidden />
      )}
    </span>
  );
}
