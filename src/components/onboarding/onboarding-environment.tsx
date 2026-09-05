/** Decorative lime "energy world" background for the onboarding wizard — the
 * same brand world as the auth pages (`ct-auth` tokens), tuned so the energy
 * wave sweeps low and wide behind the dense wizard surface instead of the
 * auth card's tighter composition. Pure CSS/SVG, no raster assets. */
export function OnboardingEnvironment() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="ct-auth-orb absolute -top-[15%] -left-[10%] size-[50vw] max-w-[820px] min-w-[480px] rounded-full opacity-80 blur-[80px]"
        style={{
          background:
            "radial-gradient(circle, rgba(168,255,31,0.16) 0%, rgba(90,180,10,0.08) 45%, transparent 68%)",
        }}
      />
      <div
        className="absolute top-[30%] -right-[8%] size-[36vw] max-w-[620px] min-w-[360px] rounded-full opacity-60 blur-[100px]"
        style={{
          background:
            "radial-gradient(circle, rgba(168,255,31,0.10) 0%, transparent 70%)",
        }}
      />

      <svg
        className="ct-auth-wave absolute inset-x-0 bottom-0 h-[38%] min-h-[220px] w-full"
        viewBox="0 0 1920 380"
        preserveAspectRatio="none"
        fill="none"
      >
        <defs>
          <linearGradient id="ob-wave-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a8ff1f" stopOpacity="0" />
            <stop offset="30%" stopColor="#a8ff1f" stopOpacity="0.85" />
            <stop offset="72%" stopColor="#a8ff1f" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#a8ff1f" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M-120 300 C 260 210, 520 360, 860 270 S 1480 150, 2040 260"
          stroke="#8fe61a"
          strokeWidth="30"
          strokeLinecap="round"
          opacity="0.10"
          filter="blur(8px)"
        />
        <path
          d="M-120 300 C 260 210, 520 360, 860 270 S 1480 150, 2040 260"
          stroke="#a8ff1f"
          strokeWidth="8"
          strokeLinecap="round"
          opacity="0.22"
        />
        <path
          d="M-120 300 C 260 210, 520 360, 860 270 S 1480 150, 2040 260"
          stroke="url(#ob-wave-fade)"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,transparent_0%,rgba(3,6,9,0.35)_60%,var(--auth-bg)_100%)]" />
    </div>
  );
}
