/** Small hand-drawn accent copy with an arrow, pointing at the product
 * preview. Decorative only — the handwritten font is never used for UI copy. */
const ARROW_TRANSFORM = {
  "down-right": "",
  "down-left": "-scale-x-100",
  "up-right": "-scale-y-100",
  "up-left": "-scale-x-100 -scale-y-100",
} as const;

export function Annotation({
  lines,
  className,
  arrow = "down-left",
}: {
  lines: string[];
  className?: string;
  /** Which way the hand-drawn arrow sweeps out of the text. */
  arrow?: keyof typeof ARROW_TRANSFORM;
}) {
  const pointsUp = arrow.startsWith("up");

  return (
    <div
      className={`relative flex flex-col font-[family-name:var(--font-caveat)] leading-tight text-[#e7f7be] ${
        pointsUp ? "flex-col-reverse" : ""
      } ${className ?? ""}`}
    >
      <p className="text-[24px] whitespace-nowrap min-[1700px]:text-[30px]">
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
        className={`text-[#e7f7be] ${pointsUp ? "mb-1" : "mt-1"} ${ARROW_TRANSFORM[arrow]}`}
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
