/*
 * Generates public/opengraph.jpg — the social-share / Open Graph card.
 * Uses the Friction brand palette so the preview matches the favicon and the
 * default theme: royal-blue field (#11264f), red accent (#d23f30), white text,
 * echoing the logo's blue/red/white identity and the Friction bg-dot-pattern
 * (red corner flare + faint steel grid).
 *
 * Run:  node scripts/build-opengraph.mjs
 * (requires ImageMagick + librsvg, available in the Replit environment)
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "opengraph.jpg");
const tmpSvg = join(here, "..", "public", ".opengraph.tmp.svg");

const W = 1280;
const H = 720;

// Brand tokens (match favicon.svg + Friction theme in src/index.css)
const FIELD = "#11264f"; // royal blue (favicon tile + task-cited background)
const CARD = "#17223f"; // Friction --card (224 46% 17%), logo tile surface
const RED = "#d23f30"; // favicon red / Friction --primary
const WHITE = "#f5f5f5"; // Friction --foreground (0 0% 96%)
const MUTED = "#b3bacb"; // Friction --muted-foreground (220 18% 72%)

// Centered logo tile
const TILE = 168;
const tileX = (W - TILE) / 2;
const tileY = 150;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="redFlare" cx="100%" cy="-12%" r="62%">
      <stop offset="0%" stop-color="${RED}" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="${RED}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blueFlare" cx="-6%" cy="110%" r="60%">
      <stop offset="0%" stop-color="#4f8fe0" stop-opacity="0.16"/>
      <stop offset="55%" stop-color="#4f8fe0" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.4" fill="#7fa6dd" fill-opacity="0.10"/>
    </pattern>
  </defs>

  <!-- royal-blue field + faint steel grid -->
  <rect width="${W}" height="${H}" fill="${FIELD}"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#redFlare)"/>
  <rect width="${W}" height="${H}" fill="url(#blueFlare)"/>

  <!-- logo tile (reuses favicon glyph) -->
  <svg x="${tileX}" y="${tileY}" width="${TILE}" height="${TILE}" viewBox="0 0 180 180">
    <rect width="180" height="180" rx="40" fill="${CARD}"/>
    <g stroke="${RED}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <line x1="56" y1="56" x2="124" y2="124"/>
      <line x1="124" y1="56" x2="56" y2="124"/>
    </g>
    <g fill="${RED}">
      <circle cx="56" cy="56" r="15"/>
      <circle cx="124" cy="56" r="15"/>
      <circle cx="56" cy="124" r="15"/>
      <circle cx="124" cy="124" r="15"/>
    </g>
    <circle cx="90" cy="90" r="22" fill="${CARD}"/>
    <circle cx="90" cy="90" r="19" fill="${RED}"/>
  </svg>

  <!-- wordmark -->
  <text x="${W / 2}" y="430" text-anchor="middle"
        font-family="DejaVu Sans" font-weight="bold" font-size="108"
        letter-spacing="-2" fill="${WHITE}">HomeHub</text>

  <!-- red accent divider -->
  <rect x="${W / 2 - 48}" y="468" width="96" height="6" rx="3" fill="${RED}"/>

  <!-- tagline -->
  <text x="${W / 2}" y="528" text-anchor="middle"
        font-family="DejaVu Sans" font-size="30" fill="${MUTED}">One calm dashboard for every service on your home network.</text>
</svg>
`;

writeFileSync(tmpSvg, svg);
execFileSync(
  "magick",
  [
    "-background",
    "none",
    "-density",
    "144",
    tmpSvg,
    "-resize",
    `${W}x${H}`,
    "-quality",
    "88",
    out,
  ],
  { stdio: "inherit" },
);
execFileSync("rm", ["-f", tmpSvg]);
console.log("wrote", out);
