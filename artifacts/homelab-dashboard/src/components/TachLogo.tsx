// Tachboard brand mark: "Tile T mosaic" — a T built from dashboard tiles
// (wide filled top bar, outlined middle tile, filled bottom tile).
// Uses currentColor so it follows text color across all 6 themes.
export function TachLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 180 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="26" y="30" width="128" height="40" rx="14" fill="currentColor" />
      <rect
        x="64"
        y="80"
        width="52"
        height="32"
        rx="10"
        stroke="currentColor"
        strokeWidth="9"
      />
      <rect x="64" y="120" width="52" height="32" rx="10" fill="currentColor" />
    </svg>
  );
}
