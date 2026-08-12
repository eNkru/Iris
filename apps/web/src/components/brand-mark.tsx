/**
 * Simple monogram mark for Iris chrome (restrained slate / accent — not the
 * full rainbow angel illustration). Inline SVG keeps the app dependency-free.
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
      <circle
        cx="16"
        cy="16"
        r="15"
        className="fill-[var(--accent-muted)] stroke-[var(--accent)]"
        strokeWidth="1.5"
      />
      <circle
        cx="16"
        cy="16"
        r="6.5"
        className="stroke-[var(--accent)]"
        strokeWidth="1.75"
      />
      <circle cx="16" cy="16" r="2.25" className="fill-[var(--accent)]" />
      {/* Iris-like radial ticks */}
      <path
        d="M16 4.5v3.2M16 24.3v3.2M4.5 16h3.2M24.3 16h3.2M7.9 7.9l2.3 2.3M21.8 21.8l2.3 2.3M7.9 24.1l2.3-2.3M21.8 10.2l2.3-2.3"
        className="stroke-[var(--accent)]"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
