/*
 * Generates public/opengraph.jpg — the social-share / Open Graph card.
 * Uses the Tachboard mosaic-T brand mark (public/brand/tachboard-mark.svg):
 * navy field (#16244A), accent red (#D93A3A), white text, with a faint steel
 * grid + subtle corner flares echoing the dashboard's dot pattern.
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

// Brand tokens (match public/brand/tachboard-mark.svg)
const FIELD = "#16244A"; // navy (mosaic-T mark field)
const RED = "#D93A3A"; // accent red (mosaic-T accent block)
const WHITE = "#f5f5f5"; // wordmark
const MUTED = "#b3bacb"; // tagline

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

  <!-- mosaic-T brand mark (mirrors public/brand/tachboard-mark.svg) -->
  <svg x="${tileX}" y="${tileY}" width="${TILE}" height="${TILE}" viewBox="0 0 512 512">
    <rect x="28" y="28" width="456" height="456" rx="108" fill="${FIELD}" stroke="#FFFFFF" stroke-width="24"/>
    <rect x="88" y="88" width="104" height="76" rx="20" fill="#E8ECF5"/>
    <rect x="204" y="88" width="104" height="76" rx="20" fill="#E8ECF5"/>
    <rect x="320" y="88" width="104" height="76" rx="20" fill="${RED}"/>
    <rect x="204" y="176" width="104" height="118" rx="20" fill="#CDD6E8"/>
    <rect x="204" y="306" width="104" height="118" rx="20" fill="#8FA1C8"/>
  </svg>

  <!-- wordmark -->
  <text x="${W / 2}" y="430" text-anchor="middle"
        font-family="DejaVu Sans" font-weight="bold" font-size="108"
        letter-spacing="-2" fill="${WHITE}">Tachboard</text>

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
