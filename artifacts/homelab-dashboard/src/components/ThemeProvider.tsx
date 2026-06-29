import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  THEMES,
  DEFAULT_THEME,
  getThemeMeta,
  readSavedTheme,
  readSavedColors,
  persistTheme,
  persistColors,
  applyThemeToDom,
  type ThemeId,
  type CustomColors,
  type ColorOverrides,
  type ThemeMeta,
} from "@/lib/theme";
import {
  readCustomThemes,
  persistCustomThemes,
  createCustomTheme,
  customThemeMeta,
  serializeTemplate,
  isCustomThemeId,
  type CustomThemeMap,
  type CustomThemeDefinition,
  type ThemeTemplateFile,
} from "@/lib/customThemes";

interface ThemeContextValue {
  /** Active theme id — a built-in ThemeId or a "custom:" id. */
  theme: string;
  /** Built-in theme metadata for the picker. */
  themes: ThemeMeta[];
  /** Custom (user-uploaded) theme metadata for the picker. */
  customThemeMetas: ThemeMeta[];
  /** Raw custom theme definitions, keyed by id. */
  customThemes: CustomThemeMap;
  /** Resolved metadata for the active theme (built-in or custom). */
  meta: ThemeMeta;
  /** Whether the active theme is a user-uploaded custom theme. */
  isCustom: boolean;
  /** Whether the active appearance (incl. custom background) reads as dark. */
  isDark: boolean;
  /** Custom color overrides for the currently selected built-in theme. */
  colors: CustomColors;
  setTheme: (theme: string) => void;
  setPrimaryColor: (hex: string | null) => void;
  setBackgroundColor: (hex: string | null) => void;
  resetColors: () => void;
  hasCustomColors: boolean;
  /** Imports a validated template as a new custom theme, returns its id. */
  addCustomTheme: (template: ThemeTemplateFile) => string;
  /** Renames a custom theme. */
  renameCustomTheme: (id: string, name: string) => void;
  /** Deletes a custom theme; falls back to default if it was active. */
  deleteCustomTheme: (id: string) => void;
  /** Serializes the active theme into a downloadable template string. */
  exportActiveTemplate: () => string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isHexDark(hex: string): boolean {
  const m = hex.trim().replace(/^#/, "");
  const full = m.length === 3 ? m[0] + m[0] + m[1] + m[1] + m[2] + m[2] : m;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Perceived luminance — below the midpoint reads as a dark surface.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [customThemes, setCustomThemes] = useState<CustomThemeMap>(() => readCustomThemes());
  const [theme, setThemeState] = useState<string>(() => readSavedTheme(readCustomThemes()));
  const [overrides, setOverrides] = useState<ColorOverrides>(() => readSavedColors());

  const activeCustom: CustomThemeDefinition | undefined = isCustomThemeId(theme)
    ? customThemes[theme]
    : undefined;

  // The inline script already applied the saved theme before first paint; keep
  // the DOM in sync on any state change here. Custom themes carry their own
  // colors in the definition, so per-theme overrides only apply to built-ins.
  useEffect(() => {
    applyThemeToDom(theme, activeCustom ? undefined : overrides[theme as ThemeId], customThemes);
  }, [theme, overrides, customThemes, activeCustom]);

  const setTheme = useCallback((next: string) => {
    setThemeState(next);
    persistTheme(next);
  }, []);

  const updateColor = useCallback(
    (key: keyof CustomColors, hex: string | null) => {
      // Color overrides only make sense for built-in themes.
      if (isCustomThemeId(theme)) return;
      setOverrides((prev) => {
        const current: CustomColors = { ...(prev[theme as ThemeId] ?? {}) };
        if (hex) current[key] = hex;
        else delete current[key];
        const nextThemeColors: CustomColors | undefined =
          Object.keys(current).length > 0 ? current : undefined;
        const next: ColorOverrides = { ...prev };
        if (nextThemeColors) next[theme as ThemeId] = nextThemeColors;
        else delete next[theme as ThemeId];
        persistColors(next);
        return next;
      });
    },
    [theme],
  );

  const setPrimaryColor = useCallback(
    (hex: string | null) => updateColor("primary", hex),
    [updateColor],
  );
  const setBackgroundColor = useCallback(
    (hex: string | null) => updateColor("background", hex),
    [updateColor],
  );

  const resetColors = useCallback(() => {
    setOverrides((prev) => {
      const next: ColorOverrides = { ...prev };
      delete next[theme as ThemeId];
      persistColors(next);
      return next;
    });
  }, [theme]);

  const addCustomTheme = useCallback(
    (template: ThemeTemplateFile): string => {
      let newId = "";
      setCustomThemes((prev) => {
        const def = createCustomTheme(template, prev);
        newId = def.id;
        const next: CustomThemeMap = { ...prev, [def.id]: def };
        persistCustomThemes(next);
        return next;
      });
      return newId;
    },
    [],
  );

  const renameCustomTheme = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCustomThemes((prev) => {
      const existing = prev[id];
      if (!existing) return prev;
      const next: CustomThemeMap = { ...prev, [id]: { ...existing, name: trimmed.slice(0, 40) } };
      persistCustomThemes(next);
      return next;
    });
  }, []);

  const deleteCustomTheme = useCallback(
    (id: string) => {
      setCustomThemes((prev) => {
        if (!prev[id]) return prev;
        const next: CustomThemeMap = { ...prev };
        delete next[id];
        persistCustomThemes(next);
        return next;
      });
      // If the deleted theme was active, fall back to the default built-in.
      setThemeState((current) => {
        if (current === id) {
          persistTheme(DEFAULT_THEME);
          return DEFAULT_THEME;
        }
        return current;
      });
    },
    [],
  );

  const colors = activeCustom ? {} : overrides[theme as ThemeId] ?? {};

  const meta: ThemeMeta = activeCustom
    ? customThemeMeta(activeCustom)
    : getThemeMeta(theme as ThemeId);

  const customThemeMetas = useMemo(
    () => Object.values(customThemes).map(customThemeMeta),
    [customThemes],
  );

  const exportActiveTemplate = useCallback((): string => {
    if (activeCustom) {
      const { id: _id, ...template } = activeCustom;
      void _id;
      return serializeTemplate(template);
    }
    const t = getThemeMeta(theme as ThemeId);
    const tpl = t.template;
    const template: ThemeTemplateFile = {
      format: "homehub-theme",
      version: 1,
      name: t.name,
      dark: t.dark,
      colors: {
        primary: colors.primary ?? t.defaults.primary,
        background: colors.background ?? t.defaults.background,
      },
      radius: t.radius,
      font: t.font,
      shadow: tpl?.shadow ?? "soft",
      backgroundPattern: tpl?.backgroundPattern ?? "none",
      uppercase: tpl?.uppercase ?? false,
      headingFont: tpl?.headingFont ?? "sans",
    };
    if (tpl?.fontUrl) template.fontUrl = tpl.fontUrl;
    return serializeTemplate(template);
  }, [activeCustom, theme, colors]);

  const isDark = activeCustom
    ? activeCustom.dark
    : colors.background
      ? isHexDark(colors.background)
      : meta.dark;

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themes: THEMES,
      customThemeMetas,
      customThemes,
      meta,
      isCustom: Boolean(activeCustom),
      isDark,
      colors,
      setTheme,
      setPrimaryColor,
      setBackgroundColor,
      resetColors,
      hasCustomColors: Boolean(colors.primary || colors.background),
      addCustomTheme,
      renameCustomTheme,
      deleteCustomTheme,
      exportActiveTemplate,
    }),
    [
      theme,
      customThemeMetas,
      customThemes,
      meta,
      activeCustom,
      isDark,
      colors,
      setTheme,
      setPrimaryColor,
      setBackgroundColor,
      resetColors,
      addCustomTheme,
      renameCustomTheme,
      deleteCustomTheme,
      exportActiveTemplate,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

export { DEFAULT_THEME };
