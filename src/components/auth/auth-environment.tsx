import { GrainOverlay } from "./grain-overlay";

/** Decorative lime "energy world" background shared by every auth page: a
 * large glowing orb with a visible limb-light ring bleeding in from the
 * top-left, plus a multi-layer SVG energy wave sweeping the lower portion of
 * the viewport. Pure CSS/SVG so the auth pages stay light and require no
 * raster assets. */
export function AuthEnvironment() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Soft green atmosphere, deliberately restrained so the page still
          reads as black rather than washed grey-green. */}
      <div
        className="ct-auth-orb absolute -top-[26%] -left-[14%] size-[64vw] max-w-[1000px] min-w-[580px] rounded-full opacity-70 blur-[110px]"
        style={{
          background:
            "radial-gradient(circle, rgba(168,255,31,0.16) 0%, rgba(110,200,18,0.07) 45%, transparent 70%)",
        }}
      />

      {/* The luminous world-edge: a very large circle whose stroke sweeps
          through the top-left of the frame, blurred underlay plus a crisp
          core, which is what reads as an "energy world" in the mockups. */}
      <svg
        className="absolute -top-[62%] -left-[34%] h-[190%] w-[130%]"
        viewBox="0 0 1000 1000"
        fill="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="ct-arc" x1="0.15" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#a8ff1f" stopOpacity="0" />
            <stop offset="26%" stopColor="#c8ff70" stopOpacity="0.85" />
            <stop offset="58%" stopColor="#a8ff1f" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#a8ff1f" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ct-arc-soft" x1="0.15" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#8fe61a" stopOpacity="0" />
            <stop offset="30%" stopColor="#8fe61a" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#8fe61a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle
          cx="500"
          cy="500"
          r="430"
          stroke="url(#ct-arc-soft)"
          strokeWidth="34"
          opacity="0.3"
          filter="blur(26px)"
        />
        <circle
          cx="500"
          cy="500"
          r="430"
          stroke="url(#ct-arc-soft)"
          strokeWidth="9"
          opacity="0.4"
          filter="blur(6px)"
        />
        <circle cx="500" cy="500" r="430" stroke="url(#ct-arc)" strokeWidth="1.6" opacity="0.9" />
      </svg>

      <svg
        className="ct-auth-wave absolute inset-x-0 bottom-0 h-[48%] min-h-[280px] w-full"
        viewBox="0 0 1600 420"
        preserveAspectRatio="none"
        fill="none"
      >
        <defs>
          <linearGradient id="ct-wave-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a8ff1f" stopOpacity="0" />
            <stop offset="32%" stopColor="#a8ff1f" stopOpacity="0.95" />
            <stop offset="68%" stopColor="#a8ff1f" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#a8ff1f" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ct-wave-fade-2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#eaffc0" stopOpacity="0" />
            <stop offset="40%" stopColor="#eaffc0" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#eaffc0" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* wide soft underlay */}
        <path
          d="M-100 340 C 220 250, 420 420, 700 320 S 1180 190, 1700 300"
          stroke="#8fe61a"
          strokeWidth="30"
          strokeLinecap="round"
          opacity="0.14"
          filter="blur(8px)"
        />
        {/* echo wave, offset and dimmer, for depth */}
        <path
          d="M-100 372 C 240 300, 440 440, 720 360 S 1200 250, 1700 340"
          stroke="#6fc914"
          strokeWidth="16"
          strokeLinecap="round"
          opacity="0.10"
          filter="blur(5px)"
        />
        {/* medium glow */}
        <path
          d="M-100 340 C 220 250, 420 420, 700 320 S 1180 190, 1700 300"
          stroke="#a8ff1f"
          strokeWidth="9"
          strokeLinecap="round"
          opacity="0.32"
        />
        {/* bright core */}
        <path
          d="M-100 340 C 220 250, 420 420, 700 320 S 1180 190, 1700 300"
          stroke="url(#ct-wave-fade)"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity="0.95"
        />
        {/* thin white-lime highlight riding the core */}
        <path
          d="M-100 338 C 220 248, 420 418, 700 318 S 1180 188, 1700 298"
          stroke="url(#ct-wave-fade-2)"
          strokeWidth="0.9"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,transparent_0%,rgba(3,6,9,0.35)_58%,var(--auth-bg)_100%)]" />
      <GrainOverlay />
    </div>
  );
}
