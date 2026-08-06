// Tachboard brand mark: T-shaped glyph matching public/favicon.svg
// (top bar with dot endpoints, stem down to a third dot, hub at the junction).
// Strokes/fills use currentColor so it follows text color like a lucide icon.
export function TachLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 180 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g
        stroke="currentColor"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="42" y1="48" x2="138" y2="48" />
        <line x1="90" y1="48" x2="90" y2="136" />
      </g>
      <g fill="currentColor">
        <circle cx="42" cy="48" r="18" />
        <circle cx="138" cy="48" r="18" />
        <circle cx="90" cy="136" r="18" />
      </g>
      <circle cx="90" cy="48" r="27" fill="var(--background, #fff)" />
      <circle cx="90" cy="48" r="22" fill="currentColor" />
    </svg>
  );
}
