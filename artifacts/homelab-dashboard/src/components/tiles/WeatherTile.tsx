import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sun,
  Moon,
  Cloud,
  CloudSun,
  CloudMoon,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";

// Map a WMO weather code (Open-Meteo) to a human label and an icon. The icon
// branches on day/night for the clear and partly-cloudy codes.
function weatherInfo(code: number, isDay: boolean): { label: string; Icon: LucideIcon } {
  switch (code) {
    case 0:
      return { label: "Clear sky", Icon: isDay ? Sun : Moon };
    case 1:
      return { label: "Mainly clear", Icon: isDay ? CloudSun : CloudMoon };
    case 2:
      return { label: "Partly cloudy", Icon: isDay ? CloudSun : CloudMoon };
    case 3:
      return { label: "Overcast", Icon: Cloud };
    case 45:
    case 48:
      return { label: "Fog", Icon: CloudFog };
    case 51:
    case 53:
    case 55:
      return { label: "Drizzle", Icon: CloudDrizzle };
    case 56:
    case 57:
      return { label: "Freezing drizzle", Icon: CloudDrizzle };
    case 61:
    case 63:
    case 65:
      return { label: "Rain", Icon: CloudRain };
    case 66:
    case 67:
      return { label: "Freezing rain", Icon: CloudRain };
    case 71:
    case 73:
    case 75:
    case 77:
      return { label: "Snow", Icon: CloudSnow };
    case 80:
    case 81:
    case 82:
      return { label: "Rain showers", Icon: CloudRain };
    case 85:
    case 86:
      return { label: "Snow showers", Icon: CloudSnow };
    case 95:
      return { label: "Thunderstorm", Icon: CloudLightning };
    case 96:
    case 99:
      return { label: "Thunderstorm, hail", Icon: CloudLightning };
    default:
      return { label: "—", Icon: Cloud };
  }
}

interface DailyForecast {
  date: string;
  code: number;
  high: number | null;
  low: number | null;
}

interface WeatherData {
  name: string;
  temp: number;
  feels: number;
  code: number;
  isDay: boolean;
  high: number | null;
  low: number | null;
  forecast: DailyForecast[];
}

type Target =
  | { kind: "coords"; lat: number; lon: number }
  | { kind: "city"; name: string };

// Best-effort reverse geocode to name a browser-detected location. Falls back
// to a generic label so the tile never breaks when the lookup is unavailable.
async function reverseName(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    );
    if (res.ok) {
      const j = (await res.json()) as {
        city?: string;
        locality?: string;
        principalSubdivision?: string;
      };
      return j.city || j.locality || j.principalSubdivision || "Current location";
    }
  } catch {
    // Ignore — the name is a nicety, not essential.
  }
  return "Current location";
}

async function fetchWeather(target: Target, units: "c" | "f"): Promise<WeatherData> {
  let lat: number;
  let lon: number;
  let name: string;

  if (target.kind === "coords") {
    lat = target.lat;
    lon = target.lon;
    name = await reverseName(lat, lon);
  } else {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        target.name,
      )}&count=1&language=en&format=json`,
    );
    if (!res.ok) throw new Error("Could not look up that city");
    const j = (await res.json()) as {
      results?: Array<{
        latitude: number;
        longitude: number;
        name: string;
        country?: string;
        admin1?: string;
      }>;
    };
    const first = j.results?.[0];
    if (!first) throw new Error(`Couldn't find "${target.name}"`);
    lat = first.latitude;
    lon = first.longitude;
    name = [first.name, first.country].filter(Boolean).join(", ");
  }

  const tempUnit = units === "f" ? "fahrenheit" : "celsius";
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&forecast_days=6&temperature_unit=${tempUnit}&timezone=auto`,
  );
  if (!res.ok) throw new Error("Could not load weather");
  const j = (await res.json()) as {
    current?: {
      temperature_2m: number;
      apparent_temperature: number;
      weather_code: number;
      is_day: number;
    };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };
  if (!j.current) throw new Error("Could not load weather");

  const days = j.daily?.time ?? [];
  const forecast: DailyForecast[] = days.map((date, i) => ({
    date,
    code: j.daily?.weather_code?.[i] ?? 0,
    high: j.daily?.temperature_2m_max?.[i] ?? null,
    low: j.daily?.temperature_2m_min?.[i] ?? null,
  }));

  return {
    name,
    temp: j.current.temperature_2m,
    feels: j.current.apparent_temperature,
    code: j.current.weather_code,
    isDay: j.current.is_day === 1,
    high: j.daily?.temperature_2m_max?.[0] ?? null,
    low: j.daily?.temperature_2m_min?.[0] ?? null,
    forecast,
  };
}

// Short weekday label for a YYYY-MM-DD date string (parsed as local time).
function weekdayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center gap-1 px-3 text-muted-foreground text-sm">
      <MapPin className="w-5 h-5 opacity-50" />
      <span>{children}</span>
    </div>
  );
}

export default function WeatherTile({ density, tileSettings }: WidgetProps) {
  const autoLocate = tileSettings?.weatherAutoLocate ?? true;
  const typedLocation = (tileSettings?.weatherLocation ?? "").trim();
  const units = tileSettings?.weatherUnits ?? "c";

  // Browser geolocation (only when auto-detect is on). On denial/unavailability
  // we fall back to the typed city if one is set, otherwise prompt for one.
  const [browserCoords, setBrowserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [geoDenied, setGeoDenied] = useState(false);

  useEffect(() => {
    if (!autoLocate) {
      setBrowserCoords(null);
      setGeoDenied(false);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoDenied(true);
      return;
    }
    let cancelled = false;
    setGeoDenied(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!cancelled)
          setBrowserCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        if (!cancelled) setGeoDenied(true);
      },
      { timeout: 10_000, maximumAge: 600_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [autoLocate]);

  const cityAvailable = typedLocation.length > 0;

  let target: Target | null = null;
  if (autoLocate && browserCoords) {
    target = { kind: "coords", ...browserCoords };
  } else if (!autoLocate && cityAvailable) {
    target = { kind: "city", name: typedLocation };
  } else if (autoLocate && geoDenied && cityAvailable) {
    target = { kind: "city", name: typedLocation };
  }

  const detecting = autoLocate && !browserCoords && !geoDenied && !cityAvailable;
  const needCity =
    (!autoLocate && !cityAvailable) || (autoLocate && geoDenied && !cityAvailable);

  const query = useQuery({
    queryKey: ["weather", target, units],
    queryFn: () => fetchWeather(target!, units),
    enabled: target !== null,
    refetchInterval: 600_000,
    staleTime: 300_000,
    retry: 1,
  });

  if (needCity) {
    return (
      <Prompt>
        {autoLocate
          ? "Location unavailable — enter a city in this tile's settings."
          : "Enter a city in this tile's settings."}
      </Prompt>
    );
  }

  if (detecting || (query.isLoading && target !== null)) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        {detecting ? "Detecting location…" : "Loading…"}
      </div>
    );
  }

  if (query.isError || !query.data) {
    const msg = query.error instanceof Error ? query.error.message : "Weather unavailable";
    return <Prompt>{msg}</Prompt>;
  }

  const data = query.data;
  const { label, Icon } = weatherInfo(data.code, data.isDay);
  const unit = units === "f" ? "°F" : "°C";
  const round = (n: number) => Math.round(n);

  // The icon/temperature and city name always show; the extra "feels like / high
  // · low" line is revealed only when the measured body has room for it, so the
  // tile fills its space without ever overflowing.
  const showDetail = density.bodyHeight >= 122;

  // On larger tiles, show a multi-day outlook below the current conditions. The
  // number of days shown adapts to the tile's width (3–5 days), and the strip is
  // only revealed when there's enough height to fit it without overflowing.
  const upcoming = data.forecast.slice(1);
  const fitDays = Math.floor((density.bodyWidth - 8) / 54);
  const numDays = Math.max(3, Math.min(5, fitDays));
  const days = upcoming.slice(0, numDays);
  const showForecast =
    density.bodyHeight >= 210 && density.bodyWidth >= 200 && days.length >= 3;

  return (
    <div className="w-full h-full flex flex-col justify-center p-3 gap-1 text-foreground">
      <div className="flex items-center gap-3">
        <Icon className="w-9 h-9 flex-shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="text-3xl font-bold leading-none tabular-nums">
            {round(data.temp)}
            {unit}
          </div>
          <div className="text-xs text-muted-foreground truncate">{label}</div>
        </div>
      </div>

      <div className="text-sm font-medium truncate">{data.name}</div>

      {showDetail && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-0.5">
          <span className="tabular-nums">Feels {round(data.feels)}{unit}</span>
          {data.high != null && data.low != null && (
            <span className="tabular-nums">
              H {round(data.high)}° · L {round(data.low)}°
            </span>
          )}
        </div>
      )}

      {showForecast && (
        <div className="flex gap-1 pt-2 mt-1 border-t border-border/50">
          {days.map((day) => {
            const { Icon: DayIcon, label: dayLabel } = weatherInfo(day.code, true);
            return (
              <div
                key={day.date}
                className="flex-1 min-w-0 flex flex-col items-center gap-1 text-center"
              >
                <span className="text-[11px] font-medium text-muted-foreground">
                  {weekdayLabel(day.date)}
                </span>
                <DayIcon className="w-5 h-5 text-primary" aria-label={dayLabel} />
                <span className="text-[11px] tabular-nums leading-tight">
                  {day.high != null ? round(day.high) : "—"}°
                  <span className="text-muted-foreground">
                    {" "}
                    {day.low != null ? round(day.low) : "—"}°
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
