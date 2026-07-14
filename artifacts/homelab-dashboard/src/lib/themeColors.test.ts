// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
  resolveVisualizerThemeDefaults,
  FALLBACK_VISUALIZER_PRIMARY,
  FALLBACK_VISUALIZER_BACKGROUND,
} from "./themeColors";

// jsdom doesn't cascade stylesheet custom properties, but it does surface
// inline custom properties via getComputedStyle — good enough to exercise the
// parsing/conversion logic end to end.
function setVars(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    document.documentElement.style.setProperty(k, v);
  }
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("resolveVisualizerThemeDefaults", () => {
  it("falls back to the hardcoded colors when no theme vars are readable", () => {
    const d = resolveVisualizerThemeDefaults();
    expect(d.primary).toBe(FALLBACK_VISUALIZER_PRIMARY);
    expect(d.background).toBe(FALLBACK_VISUALIZER_BACKGROUND);
  });

  it("converts the theme's HSL triples to hex", () => {
    // Rack-like: primary 41 100% 50% (amber), background 240 9% 6% (near-black).
    setVars({ "--primary": "41 100% 50%", "--background": "240 9% 6%" });
    const d = resolveVisualizerThemeDefaults();
    expect(d.primary).toBe("#ffae00");
    // Dark surface (L=6%) is kept as-is.
    expect(d.background).toBe("#0e0e11");
  });

  it("prefers --background over --card (per-theme overrides set --background)", () => {
    setVars({
      "--primary": "41 100% 50%",
      "--background": "200 50% 10%",
      "--card": "0 0% 6%",
    });
    const d = resolveVisualizerThemeDefaults();
    expect(d.background).toBe("#0d1e26"); // hsl(200 50% 10%)
  });

  it("keeps light-theme backgrounds light so the theme is genuinely reflected", () => {
    // Hearth-like: background is near-white — the tile must stay near-white.
    setVars({ "--primary": "24 66% 53%", "--background": "38 50% 97%" });
    const d = resolveVisualizerThemeDefaults();
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(d.background.slice(i, i + 2), 16));
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
    expect(d.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(d.primary).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("falls back to --card when --background is missing", () => {
    setVars({ "--primary": "255 95% 68%", "--card": "245 45% 7%" });
    const d = resolveVisualizerThemeDefaults();
    expect(d.background).not.toBe(FALLBACK_VISUALIZER_BACKGROUND);
    expect(d.background).toMatch(/^#[0-9a-f]{6}$/);
  });
});
