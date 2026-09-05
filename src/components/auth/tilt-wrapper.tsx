"use client";

import * as React from "react";

/** Restrained pointer-driven parallax for the product preview — a couple of
 * degrees of extra tilt that track the cursor, layered on top of the static
 * angle. Disabled for touch input and reduced-motion preference. */
export function TiltWrapper({
  children,
  baseTransform,
}: {
  children: React.ReactNode;
  baseTransform: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  const handleMove = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--tilt-x", `${(-py * 3).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(px * 4).toFixed(2)}deg`);
  }, []);

  const handleLeave = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      style={{
        transform: `${baseTransform} rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))`,
        transition: "transform 400ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {children}
    </div>
  );
}
