/** Very faint film-grain texture laid over the whole auth surface — the
 * difference between a flat dark background and one that feels like premium
 * printed/rendered material. Pure SVG turbulence, no image asset. */
export function GrainOverlay() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1] size-full opacity-[0.05] mix-blend-overlay"
    >
      <filter id="ct-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#ct-grain)" />
    </svg>
  );
}
