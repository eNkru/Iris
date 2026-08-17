/**
 * Iris brand mark — a geometric rainbow arc + gold sun. References Iris (Ἶρις),
 * Greek goddess of the rainbow and golden-winged messenger; the arc form also
 * echoes a rising price curve. Inline SVG keeps the app dependency-free.
 *
 * Pass `decorative` when the mark sits next to a visible wordmark so screen
 * readers do not announce "Iris" twice.
 */
export function BrandMark({
  className = "h-7 w-7",
  title = "Iris",
  decorative = false,
}: {
  className?: string;
  title?: string;
  /** Hide from assistive tech when adjacent text already names the brand. */
  decorative?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      {decorative ? null : <title>{title}</title>}
      {/* Rainbow arc — Iris, goddess of the rainbow. Five concentric bands
          rising from a shared baseline, muted -400 palette. */}
      <path d="M3 27A13 13 0 0 1 29 27" stroke="#f87171" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 27A11 11 0 0 1 27 27" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 27A9 9 0 0 1 25 27" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 27A7 7 0 0 1 23 27" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 27A5 5 0 0 1 21 27" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
      {/* Gold sun — golden wings / rising price peak */}
      <circle cx="16" cy="12" r="1.6" fill="#fbbf24" />
    </svg>
  );
}
