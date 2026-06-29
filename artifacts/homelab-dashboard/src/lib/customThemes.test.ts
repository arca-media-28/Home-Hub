import { describe, it, expect, beforeEach } from "vitest";
import {
  validateCustomTheme,
  serializeTemplate,
  createCustomTheme,
  readCustomThemes,
  persistCustomThemes,
  customThemeMeta,
  isCustomThemeId,
  normalizeHexColor,
  shadeHex,
  CUSTOM_THEMES_KEY,
  type ThemeTemplateFile,
  type CustomThemeMap,
} from "./customThemes";

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

const validTemplate: ThemeTemplateFile = {
  format: "homehub-theme",
  version: 1,
  name: "Midnight",
  dark: true,
  colors: { primary: "#7c5cff", background: "#0b0a1a" },
  radius: "0.5rem",
  font: "'Inter', ui-sans-serif, system-ui, sans-serif",
  fontUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
  shadow: "glow",
  backgroundPattern: "gradient",
  uppercase: false,
  headingFont: "serif",
};

describe("validateCustomTheme — valid input", () => {
  it("accepts a fully-populated valid template", () => {
    const result = validateCustomTheme(validTemplate);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Midnight");
      expect(result.value.colors.primary).toBe("#7c5cff");
      expect(result.value.fontUrl).toBe(validTemplate.fontUrl);
    }
  });

  it("accepts a template without the optional fontUrl", () => {
    const { fontUrl: _omit, ...noUrl } = validTemplate;
    void _omit;
    const result = validateCustomTheme(noUrl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fontUrl).toBeUndefined();
  });

  it("normalizes hex colors and trims the name", () => {
    const result = validateCustomTheme({
      ...validTemplate,
      name: "  Padded  ",
      colors: { primary: "#ABC", background: "#0B0A1A" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Padded");
      expect(result.value.colors.primary).toBe("#aabbcc");
      expect(result.value.colors.background).toBe("#0b0a1a");
    }
  });

  it("ignores unknown fields rather than applying them", () => {
    const result = validateCustomTheme({
      ...validTemplate,
      evilCss: "body { display: none }",
      extra: 123,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("evilCss" in result.value).toBe(false);
      expect("extra" in result.value).toBe(false);
    }
  });
});

describe("validateCustomTheme — rejection modes", () => {
  function expectError(raw: unknown, snippet: string) {
    const result = validateCustomTheme(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain(snippet.toLowerCase());
  }

  it("rejects non-objects", () => {
    expectError(null, "json object");
    expectError("a string", "json object");
    expectError([1, 2], "json object");
  });

  it("rejects the wrong format/version", () => {
    expectError({ ...validTemplate, format: "something-else" }, "format");
    expectError({ ...validTemplate, version: 2 }, "version");
  });

  it("rejects a missing or empty name", () => {
    const { name: _n, ...noName } = validTemplate;
    void _n;
    expectError(noName, "name");
    expectError({ ...validTemplate, name: "   " }, "name");
  });

  it("rejects a non-boolean dark flag", () => {
    expectError({ ...validTemplate, dark: "yes" }, "dark");
  });

  it("rejects missing colors and invalid color values", () => {
    const { colors: _c, ...noColors } = validTemplate;
    void _c;
    expectError(noColors, "colors");
    expectError({ ...validTemplate, colors: { primary: "nope", background: "#0b0a1a" } }, "primary");
    expectError({ ...validTemplate, colors: { primary: "#7c5cff", background: "#xyz999" } }, "background");
  });

  it("rejects invalid or too-large radius values", () => {
    expectError({ ...validTemplate, radius: "10" }, "radius");
    expectError({ ...validTemplate, radius: "5vw" }, "radius");
    expectError({ ...validTemplate, radius: "999px" }, "radius");
    expectError({ ...validTemplate, radius: "9rem" }, "radius");
  });

  it("rejects missing or unsafe font values", () => {
    const { font: _f, ...noFont } = validTemplate;
    void _f;
    expectError(noFont, "font");
    expectError({ ...validTemplate, font: "Inter; } body{display:none}" }, "font");
  });

  it("rejects fontUrls that are not https font hosts", () => {
    expectError({ ...validTemplate, fontUrl: "http://fonts.googleapis.com/x" }, "https");
    expectError({ ...validTemplate, fontUrl: "https://evil.example.com/font.css" }, "host");
    expectError({ ...validTemplate, fontUrl: "not a url" }, "valid");
  });

  it("rejects invalid enum values", () => {
    expectError({ ...validTemplate, shadow: "fluffy" }, "shadow");
    expectError({ ...validTemplate, backgroundPattern: "swirl" }, "backgroundpattern");
    expectError({ ...validTemplate, headingFont: "comic" }, "headingfont");
    expectError({ ...validTemplate, uppercase: "true" }, "uppercase");
  });
});

describe("export -> import round trip", () => {
  it("re-imports a serialized template cleanly", () => {
    const json = serializeTemplate(validTemplate);
    const reparsed = JSON.parse(json);
    const result = validateCustomTheme(reparsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(validTemplate);
  });

  it("omits fontUrl from the serialized output when absent", () => {
    const { fontUrl: _omit, ...noUrl } = validTemplate;
    void _omit;
    const json = serializeTemplate(noUrl);
    expect(json).not.toContain("fontUrl");
    const result = validateCustomTheme(JSON.parse(json));
    expect(result.ok).toBe(true);
  });
});

describe("persistence across reload", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("round-trips custom themes through localStorage", () => {
    const def = createCustomTheme(validTemplate);
    const map: CustomThemeMap = { [def.id]: def };
    persistCustomThemes(map);

    // Simulate a reload: read fresh from storage.
    const loaded = readCustomThemes();
    expect(loaded[def.id]).toEqual(def);
  });

  it("drops malformed or non-custom entries when reading", () => {
    const def = createCustomTheme(validTemplate);
    localStorage.setItem(
      CUSTOM_THEMES_KEY,
      JSON.stringify({
        [def.id]: def,
        "custom:broken": { format: "homehub-theme", version: 1, name: "X" },
        "not-a-custom-id": def,
      }),
    );
    const loaded = readCustomThemes();
    expect(Object.keys(loaded)).toEqual([def.id]);
  });

  it("returns an empty map when storage is empty or corrupt", () => {
    expect(readCustomThemes()).toEqual({});
    localStorage.setItem(CUSTOM_THEMES_KEY, "}{not json");
    expect(readCustomThemes()).toEqual({});
  });
});

describe("custom theme identity + metadata", () => {
  it("discriminates custom ids from built-in ids", () => {
    expect(isCustomThemeId("custom:midnight-abc123")).toBe(true);
    expect(isCustomThemeId("rack")).toBe(false);
    expect(isCustomThemeId("friction")).toBe(false);
    expect(isCustomThemeId(null)).toBe(false);
  });

  it("generates unique prefixed ids that avoid collisions", () => {
    const a = createCustomTheme(validTemplate);
    const existing: CustomThemeMap = { [a.id]: a };
    const b = createCustomTheme(validTemplate, existing);
    expect(a.id.startsWith("custom:")).toBe(true);
    expect(b.id).not.toBe(a.id);
  });

  it("derives picker metadata that reflects the definition", () => {
    const def = createCustomTheme(validTemplate);
    const meta = customThemeMeta(def);
    expect(meta.id).toBe(def.id);
    expect(meta.name).toBe("Midnight");
    expect(meta.dark).toBe(true);
    expect(meta.radius).toBe("0.5rem");
    expect(meta.swatch.background).toBe("#0b0a1a");
    expect(meta.swatch.primary).toBe("#7c5cff");
    expect(meta.defaults.primary).toBe("#7c5cff");
  });
});

describe("color helpers", () => {
  it("normalizes 3- and 6-digit hex, rejects junk", () => {
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor("123456")).toBe("#123456");
    expect(normalizeHexColor("#12")).toBeNull();
    expect(normalizeHexColor("blue")).toBeNull();
    expect(normalizeHexColor(42)).toBeNull();
  });

  it("lightens and darkens within range", () => {
    expect(shadeHex("#000000", 1)).toBe("#ffffff");
    expect(shadeHex("#ffffff", -1)).toBe("#000000");
    expect(shadeHex("#808080", 0)).toBe("#808080");
  });
});
