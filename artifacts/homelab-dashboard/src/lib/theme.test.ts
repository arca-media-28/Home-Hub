import { describe, it, expect, beforeEach } from "vitest";
import {
  readSavedTheme,
  wasSavedThemeDiscarded,
  DEFAULT_THEME,
  THEME_KEY,
} from "./theme";
import { CUSTOM_THEME_PREFIX, type CustomThemeMap } from "./customThemes";

// vitest runs in the "node" environment with no localStorage; provide an
// in-memory stand-in so persistence helpers behave like the browser.
function installLocalStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { localStorage: typeof mock }).localStorage = mock;
  return store;
}

const customId = `${CUSTOM_THEME_PREFIX}midnight-abc123`;
const resolvingMap: CustomThemeMap = {
  [customId]: {
    id: customId,
    format: "homehub-theme",
    version: 1,
    name: "Midnight",
    dark: true,
    colors: { primary: "#7c5cff", background: "#0b0a1a" },
    radius: "0.5rem",
    font: "'Inter', ui-sans-serif, system-ui, sans-serif",
    shadow: "glow",
    backgroundPattern: "gradient",
    uppercase: false,
    headingFont: "sans",
  },
};

describe("wasSavedThemeDiscarded", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("is false on a fresh load with no saved theme", () => {
    expect(wasSavedThemeDiscarded({})).toBe(false);
  });

  it("is false when the saved theme is a built-in", () => {
    localStorage.setItem(THEME_KEY, "nebula");
    expect(wasSavedThemeDiscarded({})).toBe(false);
  });

  it("is false when the saved custom theme still resolves", () => {
    localStorage.setItem(THEME_KEY, customId);
    expect(wasSavedThemeDiscarded(resolvingMap)).toBe(false);
  });

  it("is true when the saved custom theme was dropped from the validated map", () => {
    localStorage.setItem(THEME_KEY, customId);
    expect(wasSavedThemeDiscarded({})).toBe(true);
    // The matching read path falls back to the default built-in.
    expect(readSavedTheme({})).toBe(DEFAULT_THEME);
  });
});
