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

interface ThemeContextValue {
  theme: ThemeId;
  themes: ThemeMeta[];
  meta: ThemeMeta;
  /** Whether the active appearance (incl. custom background) reads as dark. */
  isDark: boolean;
  /** Custom color overrides for the currently selected theme. */
  colors: CustomColors;
  setTheme: (theme: ThemeId) => void;
  setPrimaryColor: (hex: string | null) => void;
  setBackgroundColor: (hex: string | null) => void;
  resetColors: () => void;
  hasCustomColors: boolean;
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
  const [theme, setThemeState] = useState<ThemeId>(() => readSavedTheme());
  const [overrides, setOverrides] = useState<ColorOverrides>(() => readSavedColors());

  // The inline script already applied the saved theme before first paint; keep
  // the DOM in sync on any state change here.
  useEffect(() => {
    applyThemeToDom(theme, overrides[theme]);
  }, [theme, overrides]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    persistTheme(next);
  }, []);

  const updateColor = useCallback(
    (key: keyof CustomColors, hex: string | null) => {
      setOverrides((prev) => {
        const current: CustomColors = { ...(prev[theme] ?? {}) };
        if (hex) current[key] = hex;
        else delete current[key];
        const nextThemeColors: CustomColors | undefined =
          Object.keys(current).length > 0 ? current : undefined;
        const next: ColorOverrides = { ...prev };
        if (nextThemeColors) next[theme] = nextThemeColors;
        else delete next[theme];
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
      delete next[theme];
      persistColors(next);
      return next;
    });
  }, [theme]);

  const colors = overrides[theme] ?? {};
  const meta = getThemeMeta(theme);

  const isDark = colors.background ? isHexDark(colors.background) : meta.dark;

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themes: THEMES,
      meta,
      isDark,
      colors,
      setTheme,
      setPrimaryColor,
      setBackgroundColor,
      resetColors,
      hasCustomColors: Boolean(colors.primary || colors.background),
    }),
    [theme, meta, isDark, colors, setTheme, setPrimaryColor, setBackgroundColor, resetColors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

export { DEFAULT_THEME };
