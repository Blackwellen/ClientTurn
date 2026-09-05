/** Small hand-drawn accent copy with an arrow, pointing at the product
 * preview. Decorative only — the handwritten font is never used for UI copy. */
export function Annotation({
  lines,
  className,
  align = "left",
}: {
  lines: string[];
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`relative font-[family-name:var(--font-caveat)] leading-tight text-[#e7f7be] ${className ?? ""}`}>
      <p className="text-[27px]">
        {lines.map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </p>
      <svg
        aria-hidden
        width="52"
        height="34"
        viewBox="0 0 52 34"
        fill="none"
        className={`mt-1 text-[#e7f7be] ${align === "right" ? "-scale-x-100" : ""}`}
      >
        <path
          d="M2 4C16 6 34 12 44 24"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M34 22L45 25.5L41.5 14"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
      </svg>
    </div>
  );
}
