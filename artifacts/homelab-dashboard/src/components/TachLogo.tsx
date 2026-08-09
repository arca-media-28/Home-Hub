// Tachboard brand mark from the official asset pack: a mosaic "T" of
// dashboard tiles on a navy field with a white keyline.
//
// Variants (per the pack README's size guidance):
// - "full"  — full-color primary mark (512 grid), for 64px and up.
// - "small" — simplified 3+1 tile glyph (favicon-tiny geometry), for the
//             16–24px range like the 20px app header. Full color; the navy
//             field carries its own contrast so it is NOT theme-tinted.
// - "mono"  — single-color silhouette filled with currentColor, for places
//             that need a tinted/monochrome logo.
//
// Default is "small" because every current in-app usage renders at ~20px.

type TachLogoVariant = "full" | "small" | "mono";

export function TachLogo({
  className,
  variant = "small",
}: {
  className?: string;
  variant?: TachLogoVariant;
}) {
  if (variant === "mono") {
    return (
      <svg
        viewBox="0 0 512 512"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
      >
        <g fill="currentColor">
          <path d="M136 28h240a108 108 0 0 1 108 108v240a108 108 0 0 1-108 108H136A108 108 0 0 1 28 376V136A108 108 0 0 1 136 28zm0 24a84 84 0 0 0-84 84v240a84 84 0 0 0 84 84h240a84 84 0 0 0 84-84V136a84 84 0 0 0-84-84z" />
          <rect x="88" y="88" width="104" height="76" rx="20" />
          <rect x="204" y="88" width="104" height="76" rx="20" />
          <rect x="320" y="88" width="104" height="76" rx="20" />
          <rect x="204" y="176" width="104" height="118" rx="20" />
          <rect x="204" y="306" width="104" height="118" rx="20" />
        </g>
      </svg>
    );
  }

  if (variant === "full") {
    return (
      <svg
        viewBox="0 0 512 512"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
      >
        <rect x="28" y="28" width="456" height="456" rx="108" fill="#16244A" stroke="#FFFFFF" strokeWidth="24" />
        <rect x="88" y="88" width="104" height="76" rx="20" fill="#E8ECF5" />
        <rect x="204" y="88" width="104" height="76" rx="20" fill="#E8ECF5" />
        <rect x="320" y="88" width="104" height="76" rx="20" fill="#D93A3A" />
        <rect x="204" y="176" width="104" height="118" rx="20" fill="#CDD6E8" />
        <rect x="204" y="306" width="104" height="118" rx="20" fill="#8FA1C8" />
      </svg>
    );
  }

  // "small": simplified tiny glyph, widened gutters, reads cleanly at 16–24px.
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="12" y="12" width="488" height="488" rx="112" fill="#16244A" stroke="#FFFFFF" strokeWidth="24" />
      <rect x="88" y="88" width="90" height="96" rx="14" fill="#E8ECF5" />
      <rect x="210" y="88" width="90" height="96" rx="14" fill="#E8ECF5" />
      <rect x="332" y="88" width="90" height="96" rx="14" fill="#D93A3A" />
      <rect x="210" y="216" width="90" height="208" rx="14" fill="#E8ECF5" />
    </svg>
  );
}
